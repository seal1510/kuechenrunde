import { describe, expect, it } from 'vitest'
import {
  isPublicIp,
  resolvePublicAddresses,
  UrlSafetyError,
  validateTargetUrl,
} from './url-safety'

describe('SSRF address classification', () => {
  it('accepts public IPv4 and IPv6 addresses', () => {
    expect(isPublicIp('8.8.8.8')).toBe(true)
    expect(isPublicIp('1.1.1.1')).toBe(true)
    expect(isPublicIp('2606:4700:4700::1111')).toBe(true)
  })

  it('rejects loopback, private, link-local, multicast and documentation ranges', () => {
    for (const address of [
      '127.0.0.1',
      '10.0.0.1',
      '172.16.0.1',
      '192.168.1.1',
      '169.254.169.254',
      '100.64.0.1',
      '0.0.0.0',
      '224.0.0.1',
      '198.51.100.1',
      '::1',
      '::',
      'fe80::1',
      'fc00::1',
      'ff02::1',
      '2001:db8::1',
      '::ffff:127.0.0.1',
      '::ffff:10.0.0.1',
      '2002:7f00:1::1',
      '2001:0:4136:e378:8000:63bf:3fff:fdd2',
    ]) {
      expect(isPublicIp(address), address).toBe(false)
    }
    // An IPv4-mapped *public* address is not an internal target.
    expect(isPublicIp('::ffff:8.8.8.8')).toBe(true)
  })
})

describe('target URL validation', () => {
  it('accepts normal public web URLs on ports 80 and 443', () => {
    expect(validateTargetUrl('https://example.com/rezept?x=1').url.toString()).toBe(
      'https://example.com/rezept?x=1',
    )
    expect(validateTargetUrl('http://example.com:80/x').port).toBe(80)
    expect(validateTargetUrl('https://example.com:443/x').port).toBe(443)
    expect(validateTargetUrl('https://8.8.8.8/x').isIpLiteral).toBe(true)
  })

  it('rejects non-http protocols, credentials and unusual ports', () => {
    expect(() => validateTargetUrl('javascript:alert(1)')).toThrow(UrlSafetyError)
    expect(() => validateTargetUrl('file:///etc/passwd')).toThrow(UrlSafetyError)
    expect(() => validateTargetUrl('https://user:pass@example.com/')).toThrow(UrlSafetyError)
    expect(() => validateTargetUrl('https://example.com:8080/')).toThrow(UrlSafetyError)
  })

  it('rejects localhost, internal names, single-label hosts and private IPs', () => {
    for (const url of [
      'http://localhost/',
      'http://foo.localhost/',
      'http://router.local/',
      'http://metadata.google.internal/',
      'http://intranet/',
      'http://127.0.0.1/',
      'http://[::1]/',
      'http://169.254.169.254/latest/meta-data/',
    ]) {
      expect(() => validateTargetUrl(url), url).toThrow(UrlSafetyError)
    }
  })
})

describe('public DNS resolution', () => {
  it('accepts only public answers and rejects mixed or private ones', async () => {
    const publicLookup = async () => [{ address: '93.184.216.34', family: 4 }]
    expect(await resolvePublicAddresses('example.com', publicLookup)).toEqual([
      { address: '93.184.216.34', family: 4 },
    ])

    const privateLookup = async () => [{ address: '10.0.0.5', family: 4 }]
    await expect(resolvePublicAddresses('example.com', privateLookup)).rejects.toThrow(
      /private, lokale oder reservierte/,
    )

    // A public answer plus a private answer is rejected as a whole. This blocks
    // a rebinding attempt that relies on the second DNS record.
    const mixedLookup = async () => [
      { address: '93.184.216.34', family: 4 },
      { address: '127.0.0.1', family: 4 },
    ]
    await expect(resolvePublicAddresses('example.com', mixedLookup)).rejects.toThrow(UrlSafetyError)

    const emptyLookup = async () => []
    await expect(resolvePublicAddresses('example.com', emptyLookup)).rejects.toThrow(UrlSafetyError)
  })

  it('does not re-resolve literal public IPs', async () => {
    const failingLookup = async () => {
      throw new Error('should not be called')
    }
    expect(await resolvePublicAddresses('8.8.8.8', failingLookup)).toEqual([
      { address: '8.8.8.8', family: 4 },
    ])
  })
})
