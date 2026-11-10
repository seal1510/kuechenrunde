import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const sql = readFileSync(
  new URL('../../supabase/migrations/20261110232000_family_invites.sql', import.meta.url),
  'utf8',
)
const normalized = sql
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/--[^\n]*/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()
  .toLowerCase()

describe('family invite migration', () => {
  it('adds a minimal admin flag without changing existing members access', () => {
    expect(normalized).toContain(
      'add column if not exists is_admin boolean not null default false',
    )
    expect(normalized).toContain('update public.household_members')
    expect(normalized).toContain('is_admin = true')
    expect(normalized).not.toContain('drop policy')
    expect(normalized).not.toContain('alter policy')
  })

  it('stores only a hash, never a plaintext invitation token', () => {
    expect(normalized).toContain('create table if not exists public.household_invites')
    expect(normalized).toContain('token_hash text not null unique')
    expect(normalized).not.toMatch(/^\s*token text/)
    expect(normalized).toContain('encode(sha256(convert_to(v_token')
    expect(normalized).toContain("token_hash ~ '^[0-9a-f]{64}$'")
  })

  it('blocks direct table access and keeps functions authenticated-only', () => {
    expect(normalized).toContain(
      'alter table public.household_invites enable row level security',
    )
    for (const grant of [
      'revoke all on table public.household_invites from public',
      'revoke all on table public.household_invites from anon',
      'revoke all on table public.household_invites from authenticated',
    ]) {
      expect(normalized).toContain(grant)
    }
    expect(normalized).not.toMatch(/grant[^;]*on table public\.household_invites to authenticated/)
    for (const signature of [
      'public.is_household_admin()',
      'public.create_household_invite(integer)',
      'public.list_household_invites()',
      'public.revoke_household_invite(uuid)',
      'public.redeem_household_invite(text)',
    ]) {
      expect(normalized).toContain(`grant execute on function ${signature} to authenticated`)
    }
  })

  it('authorizes creation, listing and revocation only for household admins', () => {
    for (const name of [
      'create_household_invite',
      'list_household_invites',
      'revoke_household_invite',
    ]) {
      const start = normalized.indexOf(`function public.${name}`)
      expect(start).toBeGreaterThan(-1)
      const body = normalized.slice(start, start + 900)
      expect(body).toContain('where user_id = auth.uid() and is_admin')
    }
  })

  it('redeems atomically and only for an open, unexpired link', () => {
    const start = normalized.indexOf('function public.redeem_household_invite')
    expect(start).toBeGreaterThan(-1)
    const body = normalized.slice(start)
    expect(body).toContain('update public.household_invites')
    expect(body).toContain('redeemed_at is null')
    expect(body).toContain('revoked_at is null')
    expect(body).toContain('expires_at > now()')
    expect(body).toContain('returning id into v_invite_id')
    expect(body).toContain("using errcode = 'p0002'")
    expect(body).toContain('insert into public.household_members')
    expect(body).toContain('false')
  })

  it('does not consume a link for an existing member', () => {
    const start = normalized.indexOf('function public.redeem_household_invite')
    const body = normalized.slice(start)
    expect(body).toContain("return jsonb_build_object('status', 'already_member')")
  })
})
