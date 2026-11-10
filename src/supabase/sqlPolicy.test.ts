/*
 * Statische Prüfung der SQL-Migration. Ersetzt keinen Live-Test gegen ein
 * echtes Supabase-Projekt, verhindert aber, dass zentrale RLS-/Rechte-Zusagen
 * beim Bearbeiten der Migration versehentlich verloren gehen.
 */

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  CLOUD_RECIPE_IMAGE_MIME_TYPES,
  MAX_RECIPE_IMAGE_BYTES,
} from '../import/image-mime'

const sql = readFileSync(
  new URL('../../supabase/migrations/20261110134755_cloud.sql', import.meta.url),
  'utf8',
)

const withoutComments = sql
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/--[^\n]*/g, ' ')
const normalized = withoutComments.replace(/\s+/g, ' ').trim().toLowerCase()

describe('Supabase-Migration: Struktur und Rechte', () => {
  it('legt genau die zwei Kerntabellen an', () => {
    expect(normalized).toContain('create table if not exists public.household_members')
    expect(normalized).toContain('create table if not exists public.records')
  })

  it('aktiviert RLS auf beiden Tabellen', () => {
    expect(normalized).toContain(
      'alter table public.household_members enable row level security',
    )
    expect(normalized).toContain('alter table public.records enable row level security')
  })

  it('verhindert Selbstaufnahme in den Haushalt', () => {
    expect(normalized).toContain(
      'revoke all on table public.household_members from public',
    )
    expect(normalized).toContain(
      'revoke insert, update, delete on table public.household_members from authenticated',
    )
    expect(normalized).toContain(
      'grant select on table public.household_members to authenticated',
    )
    const policies = normalized.match(
      /create policy [^;]+ on public\.household_members[^;]*/g,
    )
    expect(policies).toHaveLength(1)
    expect(policies?.[0]).toContain('for select')
    expect(policies?.[0]).not.toMatch(/for (insert|update|delete)/)
    expect(normalized).not.toMatch(
      /create policy [^;]+ on public\.household_members[^;]* for (insert|update|delete)/,
    )
  })

  it('beschränkt die Mitgliedersicht auf die eigene Zeile', () => {
    expect(normalized).toContain('using (user_id = auth.uid())')
  })

  it('schützt records über die Mitgliedschaft', () => {
    expect(normalized).toContain('create policy records_member_all on public.records')
    expect(normalized).toContain('using (public.is_household_member())')
    expect(normalized).toContain('with check (public.is_household_member())')
    expect(normalized).toContain('revoke all on table public.records from public')
    expect(normalized).toContain('revoke all on table public.records from anon')
  })

  it('verwendet ausschließlich SECURITY INVOKER', () => {
    expect(normalized).not.toContain('security definer')
    for (const name of [
      'is_household_member',
      'bump_records_rev',
      'apply_ops',
      'snapshot',
    ]) {
      const index = normalized.indexOf(`function public.${name}`)
      expect(index).toBeGreaterThan(-1)
      expect(normalized.slice(index, index + 320)).toContain('security invoker')
    }
  })

  it('entzieht RPC-Funktionen anon und PUBLIC', () => {
    for (const signature of [
      'public.is_household_member()',
      'public.apply_ops(jsonb)',
      'public.snapshot()',
    ]) {
      expect(normalized).toContain(`revoke all on function ${signature} from public`)
      expect(normalized).toContain(`revoke all on function ${signature} from anon`)
      expect(normalized).toContain(`grant execute on function ${signature} to authenticated`)
    }
    expect(normalized).not.toMatch(/grant[^;]*to anon/)
  })

  it('verlangt für Schreibvorgänge eine Mitgliedschaft', () => {
    const index = normalized.indexOf('function public.apply_ops')
    expect(index).toBeGreaterThan(-1)
    const body = normalized.slice(index)
    expect(body).toContain('if not public.is_household_member()')
    expect(body).toContain("errcode = '42501'")
  })

  it('nutzt Compare-and-Swap statt stillem Überschreiben', () => {
    const index = normalized.indexOf('function public.apply_ops')
    const body = normalized.slice(index)
    expect(body).toContain('expected_rev')
    expect(body).toContain('rev = u.expected_rev')
    expect(body).toContain("errcode = 'pt409'")
    expect(body).toContain('record changed')
    expect(body).toContain('record changed before delete')
    expect(body).toContain('delete from public.records')
  })

  it('liefert die Revision im Snapshot und in Schreibbestätigungen', () => {
    expect(normalized).toContain('create or replace function public.snapshot()')
    const start = normalized.indexOf('function public.snapshot')
    const end = normalized.indexOf('revoke all on function public.snapshot', start)
    const snapshot = normalized.slice(start, end)
    expect(snapshot).toContain("'rev', rev")
    expect(snapshot).toContain('if not public.is_household_member()')
    expect(snapshot).toContain("errcode = '42501'")
    const apply = normalized.slice(normalized.indexOf('function public.apply_ops'))
    expect(apply).toContain("'rev', v_rev")
  })

  it('behandelt Löschungen mit Revision und Realtime-Identität', () => {
    expect(normalized).toContain('alter table public.records replica identity full')
    expect(normalized).toContain('deleted')
  })

  it('legt einen privaten Bild-Bucket mit Größen- und Typgrenzen an', () => {
    expect(normalized).toContain('insert into storage.buckets')
    expect(normalized).toContain('false')
    expect(normalized).toContain('file_size_limit')
    expect(normalized).toContain('allowed_mime_types')
    const storagePolicies = normalized.match(/create policy recipe_images_/g)
    expect(storagePolicies).toHaveLength(4)
    expect(normalized).toContain("bucket_id = 'recipe-images'")
    expect(normalized).toContain('public.is_household_member()')
  })

  it('stimmt bei Bildgröße und MIME-Typen mit dem Frontend überein', () => {
    expect(normalized).toContain(String(MAX_RECIPE_IMAGE_BYTES))
    for (const mimeType of CLOUD_RECIPE_IMAGE_MIME_TYPES) {
      expect(normalized).toContain(`'${mimeType}'`)
    }
  })

  it('aktiviert Realtime für records', () => {
    expect(normalized).toContain('alter publication supabase_realtime add table public.records')
  })

  it('hält die Rezept-importId eindeutig', () => {
    expect(normalized).toContain('create unique index if not exists records_recipe_import_id_idx')
    expect(normalized).toContain("data ->> 'importid'")
  })

  it('hat keine offenen Policy-Lücken', () => {
    expect(normalized).not.toContain('using (true)')
    expect(normalized).not.toContain('with check (true)')
    expect(normalized).not.toContain('service_role')
  })

  it('definiert den Revisionszähler und den Trigger', () => {
    expect(normalized).toContain('rev bigint not null default 1')
    expect(normalized).toContain('create trigger records_bump_rev')
    expect(normalized).toContain('before update on public.records')
    expect(normalized).toContain('new.rev := old.rev + 1')
  })
})

const hardening = readFileSync(
  new URL(
    '../../supabase/migrations/20261110150500_harden_grants.sql',
    import.meta.url,
  ),
  'utf8',
)
const hardeningNormalized = hardening
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/--[^\n]*/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()
  .toLowerCase()

describe('Supabase-Migration: Rechte-Härtung', () => {
  it('entzieht authenticated alle Tabellenrechte und vergibt nur die benötigten neu', () => {
    expect(hardeningNormalized).toContain(
      'revoke all on table public.household_members from authenticated',
    )
    expect(hardeningNormalized).toContain(
      'grant select on table public.household_members to authenticated',
    )
    expect(hardeningNormalized).toContain(
      'revoke all on table public.records from authenticated',
    )
    expect(hardeningNormalized).toContain(
      'grant select, insert, update, delete on table public.records to authenticated',
    )
  })

  it('vergibt kein TRUNCATE, REFERENCES oder TRIGGER an authenticated', () => {
    expect(hardeningNormalized).not.toMatch(
      /grant[^;]*\b(truncate|references|trigger)\b/,
    )
  })

  it('hält PUBLIC und anon weiterhin vollständig ausgeschlossen', () => {
    for (const table of ['household_members', 'records']) {
      expect(hardeningNormalized).toContain(
        `revoke all on table public.${table} from public`,
      )
      expect(hardeningNormalized).toContain(
        `revoke all on table public.${table} from anon`,
      )
    }
  })
})
