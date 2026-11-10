import { describe, expect, it } from 'vitest'
import { parseAuthRedirect } from './authRedirect'

describe('parseAuthRedirect', () => {
  it('reads invite tokens from the hash without exposing them elsewhere', () => {
    const result = parseAuthRedirect(
      '#access_token=access-token-value&refresh_token=refresh-token-value&type=invite',
    )
    expect(result).toEqual({
      type: 'session',
      purpose: 'invite',
      accessToken: 'access-token-value',
      refreshToken: 'refresh-token-value',
    })
  })

  it('supports token_hash links and recovery links', () => {
    expect(parseAuthRedirect('?token_hash=hash-value&type=invite')).toEqual({
      type: 'token_hash',
      purpose: 'invite',
      tokenHash: 'hash-value',
    })
    expect(
      parseAuthRedirect('#access_token=a&refresh_token=b&type=recovery'),
    ).toEqual({
      type: 'session',
      purpose: 'recovery',
      accessToken: 'a',
      refreshToken: 'b',
    })
  })

  it('turns expired links into a friendly message without echoing tokens', () => {
    const result = parseAuthRedirect(
      '#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired&type=invite',
    )
    expect(result).toEqual({
      type: 'error',
      purpose: 'invite',
      message:
        'Der Einladungslink ist abgelaufen. Bitte den Betreiber um eine neue Einladung.',
    })
    expect(JSON.stringify(result)).not.toContain('access_token')
  })

  it('recognizes signup confirmation parameters', () => {
    expect(
      parseAuthRedirect('#access_token=a&refresh_token=b&type=signup'),
    ).toEqual({
      type: 'session',
      purpose: 'signup',
      accessToken: 'a',
      refreshToken: 'b',
    })
  })

  it('ignores ordinary app hashes and incomplete links', () => {
    expect(parseAuthRedirect('#/plan')).toBeNull()
    expect(parseAuthRedirect('')).toBeNull()
    expect(parseAuthRedirect('#type=invite')).toEqual({
      type: 'error',
      purpose: 'invite',
      message:
        'Der Einladungslink ist ungültig. Bitte den Betreiber um eine neue Einladung.',
    })
  })
})
