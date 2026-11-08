import { describe, expect, it } from 'vitest'
import { normalizeHttpUrl, resolveHttpUrl, sourceHost } from './url'

describe('URL normalisation for imports', () => {
  it('adds https to bare host input and removes fragments/default ports', () => {
    expect(normalizeHttpUrl('example.com/rezept')).toBe('https://example.com/rezept')
    expect(normalizeHttpUrl('HTTPS://Example.COM:443/rezept#abschnitt')).toBe(
      'https://example.com/rezept',
    )
    expect(normalizeHttpUrl('http://example.com:80/rezept')).toBe('http://example.com/rezept')
  })

  it('keeps path and query intact so different recipes are not merged', () => {
    const first = normalizeHttpUrl('https://example.com/rezept?nr=1')
    const second = normalizeHttpUrl('https://example.com/rezept?nr=2')
    expect(first).not.toBe(second)
    expect(normalizeHttpUrl('https://www.example.com/rezept')).not.toBe(
      normalizeHttpUrl('https://example.com/rezept'),
    )
  })

  it('rejects non-http schemes, credentials and malformed URLs', () => {
    expect(normalizeHttpUrl('javascript:alert(1)')).toBeNull()
    expect(normalizeHttpUrl('data:text/html,<h1>x</h1>')).toBeNull()
    expect(normalizeHttpUrl('file:///etc/passwd')).toBeNull()
    expect(normalizeHttpUrl('https://user:pass@example.com/')).toBeNull()
    expect(normalizeHttpUrl('https://')).toBeNull()
    expect(normalizeHttpUrl('')).toBeNull()
  })

  it('resolves relative image URLs and rejects unsafe ones', () => {
    expect(resolveHttpUrl('/bild.jpg', 'https://example.com/recipes/x')).toBe(
      'https://example.com/bild.jpg',
    )
    expect(resolveHttpUrl('//cdn.example.com/bild.jpg', 'https://example.com/x')).toBe(
      'https://cdn.example.com/bild.jpg',
    )
    expect(resolveHttpUrl('data:image/png;base64,AA', 'https://example.com/')).toBeNull()
    expect(resolveHttpUrl('javascript:alert(1)', 'https://example.com/')).toBeNull()
  })

  it('formats a host for user-facing warnings', () => {
    expect(sourceHost('https://www.example.com/rezept')).toBe('example.com')
    expect(sourceHost('nicht-url')).toBe('nicht-url')
  })
})
