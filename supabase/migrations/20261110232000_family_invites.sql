-- Küchenrunde – Einladungslinks für den Familienhaushalt
--
-- Kleinste Lösung:
--  * ein Boolean `is_admin` auf household_members (kein Rollenmanagement),
--  * eine Tabelle für Einladungen mit ausschließlich gehashten Tokens,
--  * SECURITY-DEFINER-RPCs für Erzeugen, Auflisten, Widerrufen und Einlösen.
--
-- Direkter Tabellenzugriff bleibt gesperrt. Die RLS-Regeln für records und
-- household_members werden nicht verändert.

/* ------------------------------------------------------------------ */
/* 1. Haushaltsadministrator                                           */
/* ------------------------------------------------------------------ */

alter table public.household_members
  add column if not exists is_admin boolean not null default false;

-- Der älteste bestehende Haushaltseintrag wird einmalig Administrator.
-- Neue Mitglieder werden ausschließlich mit is_admin = false angelegt.
update public.household_members m
set is_admin = true
where m.user_id = (
  select user_id
  from public.household_members
  order by created_at asc, user_id asc
  limit 1
)
and not exists (
  select 1 from public.household_members where is_admin
);

create or replace function public.is_household_admin()
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  select exists (
    select 1
    from public.household_members
    where user_id = auth.uid()
      and is_admin
  );
$$;

revoke all on function public.is_household_admin() from public;
revoke all on function public.is_household_admin() from anon;
grant execute on function public.is_household_admin() to authenticated;

/* ------------------------------------------------------------------ */
/* 2. Einladungen                                                      */
/* ------------------------------------------------------------------ */

create table if not exists public.household_invites (
  id uuid primary key default gen_random_uuid(),
  -- Nur der SHA-256-Hash des Tokens wird gespeichert, niemals der Klartext.
  token_hash text not null unique,
  created_by uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  redeemed_at timestamptz,
  redeemed_by uuid references auth.users (id) on delete set null,
  revoked_at timestamptz,
  constraint household_invites_token_hash_format
    check (token_hash ~ '^[0-9a-f]{64}$'),
  constraint household_invites_expiry_after_creation
    check (expires_at > created_at)
);

alter table public.household_invites enable row level security;

-- Kein direkter Zugriff für Clients. Die RPCs unten sind der einzige Weg.
revoke all on table public.household_invites from public;
revoke all on table public.household_invites from anon;
revoke all on table public.household_invites from authenticated;

create index if not exists household_invites_open_idx
  on public.household_invites (expires_at)
  where redeemed_at is null and revoked_at is null;

/* ------------------------------------------------------------------ */
/* 3. RPCs                                                             */
/* ------------------------------------------------------------------ */

create or replace function public.create_household_invite(p_days integer default 7)
returns table (token text, expires_at timestamptz)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_token text;
  v_expires timestamptz;
  v_days integer;
begin
  if auth.uid() is null or not exists (
    select 1
    from public.household_members
    where user_id = auth.uid() and is_admin
  ) then
    raise exception 'not a household admin' using errcode = '42501';
  end if;

  v_days := least(greatest(coalesce(p_days, 7), 1), 30);
  v_expires := now() + make_interval(days => v_days);
  -- 32 Bytes aus zwei UUIDv4-Werten; URL-sicher als Hex.
  v_token := replace(gen_random_uuid()::text, '-', '')
          || replace(gen_random_uuid()::text, '-', '');

  insert into public.household_invites (token_hash, created_by, expires_at)
  values (
    encode(sha256(convert_to(v_token, 'UTF8')), 'hex'),
    auth.uid(),
    v_expires
  );

  return query select v_token, v_expires;
end;
$$;

revoke all on function public.create_household_invite(integer) from public;
revoke all on function public.create_household_invite(integer) from anon;
grant execute on function public.create_household_invite(integer) to authenticated;

create or replace function public.list_household_invites()
returns table (
  id uuid,
  created_at timestamptz,
  expires_at timestamptz,
  redeemed_at timestamptz,
  revoked_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null or not exists (
    select 1
    from public.household_members
    where user_id = auth.uid() and is_admin
  ) then
    raise exception 'not a household admin' using errcode = '42501';
  end if;

  return query
    select i.id, i.created_at, i.expires_at, i.redeemed_at, i.revoked_at
    from public.household_invites i
    order by i.created_at desc
    limit 100;
end;
$$;

revoke all on function public.list_household_invites() from public;
revoke all on function public.list_household_invites() from anon;
grant execute on function public.list_household_invites() to authenticated;

create or replace function public.revoke_household_invite(p_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null or not exists (
    select 1
    from public.household_members
    where user_id = auth.uid() and is_admin
  ) then
    raise exception 'not a household admin' using errcode = '42501';
  end if;

  update public.household_invites
  set revoked_at = now()
  where id = p_id
    and redeemed_at is null
    and revoked_at is null;

  return found;
end;
$$;

revoke all on function public.revoke_household_invite(uuid) from public;
revoke all on function public.revoke_household_invite(uuid) from anon;
grant execute on function public.revoke_household_invite(uuid) to authenticated;

create or replace function public.redeem_household_invite(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_hash text;
  v_invite_id uuid;
  v_email text;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  -- Ein bereits freigeschaltetes Mitglied braucht keinen zweiten Eintrag und
  -- verbraucht den Link nicht.
  if exists (
    select 1 from public.household_members where user_id = v_uid
  ) then
    return jsonb_build_object('status', 'already_member');
  end if;

  v_hash := encode(sha256(convert_to(trim(p_token), 'UTF8')), 'hex');

  -- Atomare Einlösung: Nur genau eine Transaktion kann die Zeile von
  -- "offen" auf "eingelöst" setzen. Ein zweiter Aufruf findet keine Zeile.
  update public.household_invites
  set redeemed_at = now(),
      redeemed_by = v_uid
  where token_hash = v_hash
    and redeemed_at is null
    and revoked_at is null
    and expires_at > now()
  returning id into v_invite_id;

  if v_invite_id is null then
    raise exception 'invite invalid, expired, revoked or already used'
      using errcode = 'P0002';
  end if;

  select email into v_email from auth.users where id = v_uid;

  insert into public.household_members (user_id, display_name, is_admin)
  values (
    v_uid,
    coalesce(nullif(split_part(coalesce(v_email, ''), '@', 1), ''), 'Familienmitglied'),
    false
  )
  on conflict (user_id) do nothing;

  return jsonb_build_object('status', 'joined');
end;
$$;

revoke all on function public.redeem_household_invite(text) from public;
revoke all on function public.redeem_household_invite(text) from anon;
grant execute on function public.redeem_household_invite(text) to authenticated;
