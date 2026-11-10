import { describe, expect, it } from 'vitest'
import { buildJoinUrl, readJoinToken } from './joinLink'

describe('invitation link helpers', () => {
  it('uses the current origin and removes old auth/query/hash state', () => {
    expect(
      buildJoinUrl(
        'https://kuechenrunde.pages.dev/?join=old#access_token=secret',
        'abc123',
      ),
    ).toBe('https://kuechenrunde.pages.dev/?join=abc123')
  })

  it('works with a later custom domain without a hard-coded host', () => {
    expect(buildJoinUrl('https://familie.example.org/#/family', 'token-1')).toBe(
      'https://familie.example.org/?join=token-1',
    )
  })

  it('reads only a non-empty join parameter', () => {
    expect(readJoinToken('?join=abc123')).toBe('abc123')
    expect(readJoinToken('join=abc123')).toBe('abc123')
    expect(readJoinToken('?join=')).toBeNull()
    expect(readJoinToken('?other=1')).toBeNull()
    expect(readJoinToken('')).toBeNull()
  })
})
