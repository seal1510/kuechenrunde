import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const sql = readFileSync(
  new URL(
    '../../supabase/migrations/20261110234500_shared_family_invites.sql',
    import.meta.url,
  ),
  'utf8',
)
const normalized = sql
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/--[^\n]*/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()
  .toLowerCase()

describe('shared family invite migration', () => {
  it('removes the single-use state and keeps only active/revoked expiry data', () => {
    expect(normalized).toContain('drop column if exists redeemed_at')
    expect(normalized).toContain('drop column if exists redeemed_by')
    expect(normalized).not.toContain('redeemed_at = now()')
    expect(normalized).toContain('where revoked_at is null')
  })

  it('lists only active state fields without a redeemed status', () => {
    expect(normalized).toContain('drop function if exists public.list_household_invites()')
    const start = normalized.indexOf('function public.list_household_invites')
    const body = normalized.slice(start, start + 900)
    expect(body).toContain('select i.id, i.created_at, i.expires_at, i.revoked_at')
    expect(body).not.toContain('redeemed_at')
  })

  it('lets a reusable link be validated without consuming it', () => {
    const start = normalized.indexOf('function public.redeem_household_invite')
    expect(start).toBeGreaterThan(-1)
    const body = normalized.slice(start)
    expect(body).toContain('from public.household_invites')
    expect(body).toContain('revoked_at is null')
    expect(body).toContain('expires_at > now()')
    expect(body).toContain('for share')
    expect(body).not.toContain('update public.household_invites')
    expect(body).not.toContain('redeemed')
  })

  it('adds each account at most once and never grants admin rights', () => {
    const start = normalized.indexOf('function public.redeem_household_invite')
    const body = normalized.slice(start)
    expect(body).toContain('insert into public.household_members')
    expect(body).toContain('on conflict (user_id) do nothing')
    expect(body).toContain('returning user_id into v_inserted')
    expect(body).toContain('false')
    expect(body).toContain("return jsonb_build_object('status', 'joined')")
    expect(body).toContain("return jsonb_build_object('status', 'already_member')")
  })

  it('keeps administrator-only management and authenticated-only RPC grants', () => {
    for (const signature of [
      'public.list_household_invites()',
      'public.revoke_household_invite(uuid)',
      'public.redeem_household_invite(text)',
    ]) {
      expect(normalized).toContain(`grant execute on function ${signature} to authenticated`)
    }
    for (const name of ['list_household_invites', 'revoke_household_invite']) {
      const start = normalized.indexOf(`function public.${name}`)
      expect(start).toBeGreaterThan(-1)
      const body = normalized.slice(start, start + 900)
      expect(body).toContain('where user_id = auth.uid() and is_admin')
    }
  })

  it('revokes an active link regardless of how many members already joined', () => {
    const start = normalized.indexOf('function public.revoke_household_invite')
    const body = normalized.slice(start, start + 900)
    expect(body).toContain('where id = p_id')
    expect(body).toContain('revoked_at is null')
    expect(body).not.toContain('redeemed_at')
  })
})
