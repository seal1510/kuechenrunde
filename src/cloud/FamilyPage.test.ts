import { describe, expect, it } from 'vitest'
import { inviteStatus } from './FamilyPage'
import type { HouseholdInvite } from '../family/familyInvites'

const base: HouseholdInvite = {
  id: 'invite-1',
  createdAt: '2026-11-10T10:00:00.000Z',
  expiresAt: '2026-11-17T10:00:00.000Z',
  redeemedAt: null,
  revokedAt: null,
}

describe('family invite status', () => {
  it('distinguishes open, redeemed, revoked and expired links', () => {
    const now = Date.parse('2026-11-12T10:00:00.000Z')
    expect(inviteStatus(base, now)).toBe('open')
    expect(inviteStatus({ ...base, redeemedAt: '2026-11-11T10:00:00.000Z' }, now)).toBe(
      'redeemed',
    )
    expect(inviteStatus({ ...base, revokedAt: '2026-11-11T10:00:00.000Z' }, now)).toBe(
      'revoked',
    )
    expect(inviteStatus(base, Date.parse('2026-11-18T10:00:00.000Z'))).toBe('expired')
  })
})
