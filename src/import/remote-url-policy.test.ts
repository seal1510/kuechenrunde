import { describe, expect, it } from 'vitest'
import {
  contentTypeMime,
  decodeHtmlBytes,
  ipVersion,
  isHtmlContentType,
  isImageContentType,
  isPublicIp,
  REMOTE_FETCH_LIMITS,
  resolveRemoteRedirect,
  UrlSafetyError,
  validateRemoteTarget,
} from './remote-url-policy'

const CLOUD = { rejectIpLiterals: true, requireDefaultPortForScheme: true }

describe('shared remote URL policy', () => {
  it('classifies public and local IP addresses without Node APIs', () => {
    expect(ipVersion('8.8.8.8')).toBe(4)
    expect(ipVersion('2606:4700:4700::1111')).toBe(6)
    expect(ipVersion('example.com')).toBe(0)
    expect(isPublicIp('8.8.8.8')).toBe(true)
    expect(isPublicIp('2606:4700:4700::1111')).toBe(true)
    for (const address of [
      '127.0.0.1',
      '10.0.0.1',
      '169.254.169.254',
      '192.168.1.1',
      '0.0.0.0',
      '::1',
      'fe80::1',
      'fc00::1',
      '::ffff:127.0.0.1',
      '2002:7f00:1::1',
    ]) {
      expect(isPublicIp(address), address).toBe(false)
    }
  })

  it('accepts normal public HTTP(S) targets on the expected ports', () => {
    expect(validateRemoteTarget('https://example.com/rezept?x=1').url.toString()).toBe(
      'https://example.com/rezept?x=1',
    )
    expect(validateRemoteTarget('http://example.com:80/x').port).toBe(80)
    expect(validateRemoteTarget('https://example.com:443/x').port).toBe(443)
    expect(validateRemoteTarget('https://example.com/#fragment').url.hash).toBe('')
  })

  it('keeps public IP literals working for the local Node path', () => {
    expect(validateRemoteTarget('https://8.8.8.8/x').isIpLiteral).toBe(true)
    expect(validateRemoteTarget('http://[2606:4700:4700::1111]/x').isIpLiteral).toBe(true)
  })

  it('rejects all IP literals and non-default ports in the cloud policy', () => {
    expect(() => validateRemoteTarget('https://8.8.8.8/x', CLOUD)).toThrow(UrlSafetyError)
    expect(() => validateRemoteTarget('http://[2606:4700:4700::1111]/x', CLOUD)).toThrow(
      UrlSafetyError,
    )
    expect(() => validateRemoteTarget('http://example.com:443/x', CLOUD)).toThrow(UrlSafetyError)
    expect(() => validateRemoteTarget('https://example.com:80/x', CLOUD)).toThrow(UrlSafetyError)
    expect(() => validateRemoteTarget('https://example.com:8080/x', CLOUD)).toThrow(UrlSafetyError)
  })

  it('rejects protocols, credentials, local names and wildcard DNS services', () => {
    for (const url of [
      'javascript:alert(1)',
      'file:///etc/passwd',
      'ftp://example.com/x',
      'https://user:pass@example.com/',
      'http://localhost/',
      'http://foo.localhost/',
      'http://router.local/',
      'http://metadata.google.internal/',
      'http://intranet/',
      'http://127.0.0.1/',
      'http://[::1]/',
      'http://169.254.169.254/latest/meta-data/',
      'http://2130706433/',
      'http://0x7f000001/',
      'http://0177.0.0.1/',
      'http://127.0.0.1.nip.io/',
      'https://foo.sslip.io/',
      'https://localtest.me/',
      'http://service.home.arpa/',
      'http://printer.lan/',
    ]) {
      expect(() => validateRemoteTarget(url, CLOUD), url).toThrow(UrlSafetyError)
    }
  })

  it('rejects malformed host labels and oversized URLs', () => {
    expect(() => validateRemoteTarget('https://exa_mple.com/')).toThrow(UrlSafetyError)
    expect(() => validateRemoteTarget(`https://example.com/${'a'.repeat(3000)}`)).toThrow(
      UrlSafetyError,
    )
  })

  it('revalidates every redirect target with the full cloud policy', () => {
    const current = new URL('https://example.com/start')
    expect(resolveRemoteRedirect(current, '/next', CLOUD).toString()).toBe(
      'https://example.com/next',
    )
    expect(resolveRemoteRedirect(current, 'https://other.example.org/x', CLOUD).toString()).toBe(
      'https://other.example.org/x',
    )
    for (const target of [
      'http://127.0.0.1/secret',
      'http://169.254.169.254/latest',
      'javascript:alert(1)',
      'https://user:pass@other.example.org/',
      'http://other.example.org:8080/',
      'http://localhost/',
      'https://1.1.1.1/',
    ]) {
      expect(() => resolveRemoteRedirect(current, target, CLOUD), target).toThrow(UrlSafetyError)
    }
  })

  it('enforces the shared response limits', () => {
    expect(REMOTE_FETCH_LIMITS.htmlBytes).toBeLessThanOrEqual(8 * 1024 * 1024)
    expect(REMOTE_FETCH_LIMITS.imageBytes).toBeLessThanOrEqual(10 * 1024 * 1024)
    expect(REMOTE_FETCH_LIMITS.maxRedirects).toBeLessThanOrEqual(5)
    expect(REMOTE_FETCH_LIMITS.maxImageRedirects).toBeLessThanOrEqual(3)
    expect(REMOTE_FETCH_LIMITS.timeoutMs).toBeLessThanOrEqual(20_000)
    expect(REMOTE_FETCH_LIMITS.maxRequestBodyBytes).toBeLessThanOrEqual(32 * 1024)
  })

  it('uses the same content-type rules and decodes legacy charsets', () => {
    expect(isHtmlContentType('text/html; charset=utf-8')).toBe(true)
    expect(isHtmlContentType('application/xhtml+xml')).toBe(true)
    expect(isHtmlContentType('application/json')).toBe(false)
    expect(isImageContentType('image/png')).toBe(true)
    expect(isImageContentType('application/octet-stream')).toBe(true)
    expect(isImageContentType('text/html')).toBe(false)
    expect(contentTypeMime('text/html; charset=UTF-8')).toBe('text/html')

    const utf8 = new TextEncoder().encode('<html><body>Grüße</body></html>')
    expect(decodeHtmlBytes(utf8, 'text/html; charset=utf-8')).toContain('Grüße')

    const latin1 = new Uint8Array([
      ...new TextEncoder().encode('<html><head><meta charset="iso-8859-1"></head><body>Gr'),
      0xfc,
      0xdf,
      ...new TextEncoder().encode('e</body></html>'),
    ])
    expect(decodeHtmlBytes(latin1, 'text/html')).toContain('Grüße')
  })
})
