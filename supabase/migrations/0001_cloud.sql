-- Küchenrunde – Cloud-Grundlage (Etappe A1)
-- Im Supabase-SQL-Editor als postgres ausführen. Nicht für eine nackte
-- PostgreSQL-Instanz gedacht: auth.*, storage.* und die Realtime-Publication
-- werden von Supabase bereitgestellt.
--
-- Grundsätze:
--  * Genau ein gemeinsamer Haushalt; keine Mandanten, Rollen oder Einladungen.
--  * Mitgliedschaft wird ausschließlich vom Betreiber im Dashboard gepflegt.
--    Authentifizierte Nutzer dürfen sich nicht selbst aufnehmen.
--  * Alle App-Daten liegen in public.records(collection, id, data).
--  * Schreiben laufen über apply_ops(): atomar, mit Compare-and-Swap über rev.
--  * Alle Funktionen sind SECURITY INVOKER; RLS bleibt die letzte Instanz.
--  * Keine Service-Role-Verwendung im Client.

begin;

/* ------------------------------------------------------------------ */
/* 1. Haushalt und Mitgliedschaft                                      */
/* ------------------------------------------------------------------ */

create table if not exists public.household_members (
  user_id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default '',
  created_at timestamptz not null default now()
);

alter table public.household_members enable row level security;

-- Kein Selbstbeitritt, keine Selbständerung, keine Selbstlöschung.
-- Anlegen/Entfernen erfolgt bewusst nur über den Betreiber (postgres).
revoke all on table public.household_members from public;
revoke all on table public.household_members from anon;
revoke insert, update, delete on table public.household_members from authenticated;
grant select on table public.household_members to authenticated;

-- SECURITY INVOKER: liest household_members mit den Rechten des Aufrufers.
-- Die SELECT-Policy unten beschränkt die Sicht auf die eigene Zeile.
-- Dadurch gibt es keinen Definer-Pfad, der RLS umgehen könnte.
create or replace function public.is_household_member()
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
  );
$$;

revoke all on function public.is_household_member() from public;
revoke all on function public.is_household_member() from anon;
grant execute on function public.is_household_member() to authenticated;

drop policy if exists household_members_read_self on public.household_members;
create policy household_members_read_self on public.household_members
  for select
  to authenticated
  using (user_id = auth.uid());

/* ------------------------------------------------------------------ */
/* 2. Gemeinsame Datenspeicherung                                      */
/* ------------------------------------------------------------------ */

create table if not exists public.records (
  collection text not null,
  id text not null,
  updated_at bigint not null default (extract(epoch from clock_timestamp()) * 1000)::bigint,
  -- Serverseitiger Revisionszähler für Compare-and-Swap. Client-Timestamps
  -- taugen nicht als Konflikttoken (Uhren können auseinanderlaufen).
  rev bigint not null default 1,
  data jsonb not null,
  primary key (collection, id),
  constraint records_id_not_empty check (length(id) > 0),
  constraint records_data_is_object check (jsonb_typeof(data) = 'object'),
  constraint records_rev_positive check (rev > 0)
);

alter table public.records enable row level security;
-- DELETE-Events sollen die vollständige alte Zeile enthalten, damit der
-- Client Löschungen eindeutig zuordnen kann.
alter table public.records replica identity full;

drop policy if exists records_member_all on public.records;
create policy records_member_all on public.records
  for all
  to authenticated
  using (public.is_household_member())
  with check (public.is_household_member());

revoke all on table public.records from public;
revoke all on table public.records from anon;
grant select, insert, update, delete on table public.records to authenticated;

create index if not exists records_collection_idx
  on public.records (collection);

-- Erhält die bisherige &importId-Eindeutigkeit der Rezeptbibliothek.
create unique index if not exists records_recipe_import_id_idx
  on public.records ((data ->> 'importId'))
  where collection = 'recipes';

-- Jede Aktualisierung erhöht rev serverseitig. Der Client kann damit
-- erkennen, ob seine geladene Fassung noch aktuell ist.
create or replace function public.bump_records_rev()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  new.rev := old.rev + 1;
  return new;
end;
$$;

-- Triggerfunktionen sind nicht per RPC aufrufbar. Das EXECUTE-Privileg wird
-- bei CREATE TRIGGER geprüft, nicht bei jedem Feuern.
revoke all on function public.bump_records_rev() from public;
revoke all on function public.bump_records_rev() from anon;
revoke all on function public.bump_records_rev() from authenticated;

drop trigger if exists records_bump_rev on public.records;
create trigger records_bump_rev
  before update on public.records
  for each row
  execute function public.bump_records_rev();

/* ------------------------------------------------------------------ */
/* 3. Atomare Mehrzeilen-Schreiboperationen                            */
/* ------------------------------------------------------------------ */

-- p_ops = {
--   "clear":   ["collection", ...],
--   "upserts": [{collection,id,data,updated_at,expected_rev}, ...],
--   "deletes": [{collection,id,expected_rev}, ...]
-- }
--
-- expected_rev = 0  -> reines Anlegen; existiert die Zeile bereits: Konflikt.
-- expected_rev > 0  -> Update nur, wenn rev noch übereinstimmt.
-- deletes.expected_rev = null -> unbedingt löschen (explizite Bereinigung).
--
-- Reihenfolge: clear -> upserts -> deletes. Dadurch ist "Collection ersetzen"
-- in einem Aufruf möglich. Der gesamte Aufruf ist eine Transaktion: entweder
-- alle Operationen greifen oder keine.
create or replace function public.apply_ops(p_ops jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  u record;
  v_rev bigint;
  v_applied jsonb := '[]'::jsonb;
  v_deleted jsonb := '[]'::jsonb;
begin
  if not public.is_household_member() then
    raise exception 'not a household member' using errcode = '42501';
  end if;

  if jsonb_typeof(coalesce(p_ops -> 'clear', '[]'::jsonb)) <> 'array' then
    raise exception 'invalid clear list' using errcode = '22023';
  end if;

  delete from public.records r
  using jsonb_array_elements_text(coalesce(p_ops -> 'clear', '[]'::jsonb)) as c(collection)
  where r.collection = c.collection;

  for u in
    select *
    from jsonb_to_recordset(coalesce(p_ops -> 'upserts', '[]'::jsonb))
      as x(collection text, id text, updated_at bigint, data jsonb, expected_rev bigint)
  loop
    if u.collection is null or u.id is null or u.data is null then
      raise exception 'invalid upsert' using errcode = '22023';
    end if;
    if u.expected_rev is null or u.expected_rev < 0 then
      raise exception 'invalid expected_rev' using errcode = '22023';
    end if;

    v_rev := null;
    if u.expected_rev = 0 then
      insert into public.records (collection, id, updated_at, data)
      values (
        u.collection,
        u.id,
        coalesce(u.updated_at, (extract(epoch from clock_timestamp()) * 1000)::bigint),
        u.data
      )
      on conflict (collection, id) do nothing
      returning rev into v_rev;

      if v_rev is null then
        raise exception 'record already exists: %.%', u.collection, u.id
          using errcode = 'PT409';
      end if;
    else
      update public.records
      set data = u.data,
          updated_at = coalesce(
            u.updated_at,
            (extract(epoch from clock_timestamp()) * 1000)::bigint
          )
      where collection = u.collection
        and id = u.id
        and rev = u.expected_rev
      returning rev into v_rev;

      if v_rev is null then
        raise exception 'record changed: %.%', u.collection, u.id
          using errcode = 'PT409';
      end if;
    end if;

    v_applied := v_applied || jsonb_build_object(
      'collection', u.collection,
      'id', u.id,
      'rev', v_rev
    );
  end loop;

  for u in
    select *
    from jsonb_to_recordset(coalesce(p_ops -> 'deletes', '[]'::jsonb))
      as x(collection text, id text, expected_rev bigint)
  loop
    if u.collection is null or u.id is null then
      raise exception 'invalid delete' using errcode = '22023';
    end if;

    v_rev := null;
    delete from public.records
    where collection = u.collection
      and id = u.id
      and (u.expected_rev is null or rev = u.expected_rev)
    returning rev into v_rev;

    -- Bereits gelöscht ist in Ordnung (idempotent). Existiert die Zeile
    -- jedoch mit einer anderen Revision, wurde sie zwischenzeitlich geändert.
    if v_rev is null
       and u.expected_rev is not null
       and exists (
         select 1
         from public.records
         where collection = u.collection and id = u.id
       ) then
      raise exception 'record changed before delete: %.%', u.collection, u.id
        using errcode = 'PT409';
    end if;

    v_deleted := v_deleted || jsonb_build_object(
      'collection', u.collection,
      'id', u.id
    );
  end loop;

  return jsonb_build_object('applied', v_applied, 'deleted', v_deleted);
end;
$$;

revoke all on function public.apply_ops(jsonb) from public;
revoke all on function public.apply_ops(jsonb) from anon;
grant execute on function public.apply_ops(jsonb) to authenticated;

-- Ein einziger Lesevorgang für den Start. Umgeht das PostgREST-Zeilenlimit
-- und liefert die Revision für spätere Compare-and-Swap-Schreibvorgänge.
create or replace function public.snapshot()
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
begin
  -- Explizit statt eines leeren Ergebnisses: Ein Nicht-Mitglied soll klar
  -- scheitern und nicht den Eindruck eines leeren Haushalts bekommen.
  if not public.is_household_member() then
    raise exception 'not a household member' using errcode = '42501';
  end if;

  return (
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'collection', collection,
          'id', id,
          'rev', rev,
          'data', data
        )
        order by collection, id
      ),
      '[]'::jsonb
    )
    from public.records
  );
end;
$$;

revoke all on function public.snapshot() from public;
revoke all on function public.snapshot() from anon;
grant execute on function public.snapshot() to authenticated;

/* ------------------------------------------------------------------ */
/* 4. Privater Speicher für Rezeptbilder                               */
/* ------------------------------------------------------------------ */

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'recipe-images',
  'recipe-images',
  false,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif']
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists recipe_images_read on storage.objects;
create policy recipe_images_read on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'recipe-images'
    and public.is_household_member()
  );

drop policy if exists recipe_images_insert on storage.objects;
create policy recipe_images_insert on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'recipe-images'
    and public.is_household_member()
  );

drop policy if exists recipe_images_update on storage.objects;
create policy recipe_images_update on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'recipe-images'
    and public.is_household_member()
  )
  with check (
    bucket_id = 'recipe-images'
    and public.is_household_member()
  );

drop policy if exists recipe_images_delete on storage.objects;
create policy recipe_images_delete on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'recipe-images'
    and public.is_household_member()
  );

/* ------------------------------------------------------------------ */
/* 5. Realtime                                                         */
/* ------------------------------------------------------------------ */

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin
      alter publication supabase_realtime add table public.records;
    exception
      when duplicate_object then null;
    end;
  end if;
end;
$$;

commit;
