import { Readable } from 'node:stream'
import { describe, expect, it } from 'vitest'
import {
  contentTypeMime,
  decodeHtmlBuffer,
  FETCH_LIMITS,
  isHtmlContentType,
  isImageContentType,
  readLimited,
  RemoteFetchError,
  resolveRedirect,
} from './recipe-fetcher'

describe('fetch content rules', () => {
  it('accepts only HTML/XHTML for pages and image types for images', () => {
    expect(isHtmlContentType('text/html; charset=UTF-8')).toBe(true)
    expect(isHtmlContentType('application/xhtml+xml')).toBe(true)
    expect(isHtmlContentType('application/json')).toBe(false)
    expect(isHtmlContentType(undefined)).toBe(false)

    expect(isImageContentType('image/jpeg')).toBe(true)
    expect(isImageContentType('application/octet-stream')).toBe(true)
    expect(isImageContentType('text/html')).toBe(false)
    expect(contentTypeMime('text/html; charset=UTF-8')).toBe('text/html')
  })

  it('has conservative size, redirect and time limits', () => {
    expect(FETCH_LIMITS.htmlBytes).toBeLessThanOrEqual(8 * 1024 * 1024)
    expect(FETCH_LIMITS.imageBytes).toBeLessThanOrEqual(10 * 1024 * 1024)
    expect(FETCH_LIMITS.maxRedirects).toBeLessThanOrEqual(5)
    expect(FETCH_LIMITS.timeoutMs).toBeLessThanOrEqual(20_000)
  })

  it('rejects too many redirects to private destinations', () => {
    const current = new URL('https://example.com/start')
    expect(resolveRedirect(current, '/next').toString()).toBe('https://example.com/next')
    expect(() => resolveRedirect(current, 'http://127.0.0.1/secret')).toThrow()
    expect(() => resolveRedirect(current, 'http://169.254.169.254/latest')).toThrow()
    expect(() => resolveRedirect(current, 'javascript:alert(1)')).toThrow()
  })

  it('decodes charset from the header or meta tag', () => {
    const utf8 = Buffer.from('<html><body>Grüße</body></html>', 'utf8')
    expect(decodeHtmlBuffer(utf8, 'text/html; charset=utf-8')).toContain('Grüße')

    const latin1 = Buffer.from(
      '<html><head><meta charset="iso-8859-1"></head><body>Gr\xfc\xdfe</body></html>',
      'latin1',
    )
    expect(decodeHtmlBuffer(latin1, 'text/html')).toContain('Grüße')
  })

  it('enforces a hard body limit and guards decompression output', async () => {
    const ok = await readLimited(Readable.from([Buffer.from('abc'), Buffer.from('def')]), 10)
    expect(ok.toString()).toBe('abcdef')

    await expect(
      readLimited(Readable.from([Buffer.alloc(8), Buffer.alloc(8)]), 10),
    ).rejects.toMatchObject({ code: 'too-large' })

    const error = await readLimited(Readable.from([Buffer.alloc(11)]), 10).catch(
      (cause: unknown) => cause,
    )
    expect(error).toBeInstanceOf(RemoteFetchError)
  })
})
