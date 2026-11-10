-- Küchenrunde – gemeinsamer Einladungslink für die Familiengruppe
--
-- Der Link wird nicht mehr durch die erste Einlösung verbraucht. Er bleibt
-- gültig, bis er abläuft oder der Administrator ihn widerruft. Die Aufnahme in
-- den Haushalt bleibt serverseitig, atomar und ohne Administratorrechte.

/* ------------------------------------------------------------------ */
/* 1. Einmal verwendete Spalten entfernen                              */
/* ------------------------------------------------------------------ */

drop index if exists public.household_invites_open_idx;

alter table public.household_invites
  drop column if exists redeemed_at;

alter table public.household_invites
  drop column if exists redeemed_by;

create index if not exists household_invites_open_idx
  on public.household_invites (expires_at)
  where revoked_at is null;

/* ------------------------------------------------------------------ */
/* 2. Auflisten ohne Einlöse-Status                                    */
/* ------------------------------------------------------------------ */

drop function if exists public.list_household_invites();

create function public.list_household_invites()
returns table (
  id uuid,
  created_at timestamptz,
  expires_at timestamptz,
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
    select i.id, i.created_at, i.expires_at, i.revoked_at
    from public.household_invites i
    order by i.created_at desc
    limit 100;
end;
$$;

revoke all on function public.list_household_invites() from public;
revoke all on function public.list_household_invites() from anon;
grant execute on function public.list_household_invites() to authenticated;

/* ------------------------------------------------------------------ */
/* 3. Widerrufen                                                       */
/* ------------------------------------------------------------------ */

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
    and revoked_at is null;

  return found;
end;
$$;

revoke all on function public.revoke_household_invite(uuid) from public;
revoke all on function public.revoke_household_invite(uuid) from anon;
grant execute on function public.revoke_household_invite(uuid) to authenticated;

/* ------------------------------------------------------------------ */
/* 4. Mehrfache, atomare Einlösung                                     */
/* ------------------------------------------------------------------ */

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
  v_inserted uuid;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  -- Bestehende Mitglieder werden nie verändert; der Link bleibt für andere
  -- Familienmitglieder weiterhin gültig.
  if exists (
    select 1 from public.household_members where user_id = v_uid
  ) then
    return jsonb_build_object('status', 'already_member');
  end if;

  v_hash := encode(sha256(convert_to(trim(p_token), 'UTF8')), 'hex');

  -- FOR SHARE serialisiert die Prüfung gegen einen gleichzeitigen Widerruf,
  -- erlaubt aber vielen Familienmitgliedern die gleichzeitige Einlösung.
  select i.id
  into v_invite_id
  from public.household_invites i
  where i.token_hash = v_hash
    and i.revoked_at is null
    and i.expires_at > now()
  for share;

  if v_invite_id is null then
    raise exception 'invite invalid, expired or revoked'
      using errcode = 'P0002';
  end if;

  select email into v_email from auth.users where id = v_uid;

  insert into public.household_members (user_id, display_name, is_admin)
  values (
    v_uid,
    coalesce(nullif(split_part(coalesce(v_email, ''), '@', 1), ''), 'Familienmitglied'),
    false
  )
  on conflict (user_id) do nothing
  returning user_id into v_inserted;

  if v_inserted is null then
    return jsonb_build_object('status', 'already_member');
  end if;

  return jsonb_build_object('status', 'joined');
end;
$$;

revoke all on function public.redeem_household_invite(text) from public;
revoke all on function public.redeem_household_invite(text) from anon;
grant execute on function public.redeem_household_invite(text) to authenticated;
