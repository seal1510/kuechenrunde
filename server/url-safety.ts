/*
 * openCook Web
 * Copyright (C) 2026 openCook Web contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * SSRF protection for the local URL fetch service.
 *
 * The rules are deliberately conservative and universal: only public HTTP(S)
 * targets on ports 80/443, no credentials, no single-label/internal hostnames,
 * and every DNS answer must be a public address. The resolver result is pinned
 * into the actual socket lookup so a second DNS answer cannot redirect the
 * connection to an internal address (DNS rebinding).
 */

import { lookup as dnsLookup } from 'node:dns/promises'
import { isIP } from 'node:net'

export class UrlSafetyError extends Error {
  readonly code = 'unsafe-url'

  constructor(message: string) {
    super(message)
    this.name = 'UrlSafetyError'
  }
}

const BLOCKED_HOST_SUFFIXES = [
  'localhost',
  'local',
  'localdomain',
  'internal',
  'intranet',
  'lan',
  'home',
  'home.arpa',
  'corp',
  'private',
  'test',
  'invalid',
  'example',
  'onion',
]

const IPV4_BLOCKED: Array<[string, number]> = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
  ['255.255.255.255', 32],
]

function parseIpv4(address: string): number[] | null {
  const parts = address.split('.')
  if (parts.length !== 4) return null
  const octets: number[] = []
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null
    const value = Number(part)
    if (!Number.isInteger(value) || value < 0 || value > 255) return null
    octets.push(value)
  }
  return octets
}

function ipv4ToInt(octets: number[]): number {
  return (
    (((octets[0] ?? 0) * 256 + (octets[1] ?? 0)) * 256 + (octets[2] ?? 0)) * 256 +
    (octets[3] ?? 0)
  ) >>> 0
}

function ipv4InCidr(value: number, base: string, prefix: number): boolean {
  const baseOctets = parseIpv4(base)
  if (!baseOctets) return false
  const baseValue = ipv4ToInt(baseOctets)
  if (prefix === 0) return true
  const mask = prefix === 32 ? 0xffffffff : (0xffffffff << (32 - prefix)) >>> 0
  return (value & mask) === (baseValue & mask)
}

export function isPublicIpv4(address: string): boolean {
  const octets = parseIpv4(address)
  if (!octets) return false
  const value = ipv4ToInt(octets)
  return !IPV4_BLOCKED.some(([base, prefix]) => ipv4InCidr(value, base, prefix))
}

function parseIpv6(address: string): number[] | null {
  let text = address.trim().toLowerCase()
  if (text.startsWith('[') && text.endsWith(']')) text = text.slice(1, -1)
  const zone = text.indexOf('%')
  if (zone >= 0) text = text.slice(0, zone)
  if (!text.includes(':')) return null
  if (text.split('::').length > 2) return null

  const expand = (part: string): string[] | null => {
    if (!part) return []
    const entries = part.split(':')
    const result: string[] = []
    for (let index = 0; index < entries.length; index += 1) {
      const entry = entries[index] ?? ''
      if (entry === '') return null
      if (index === entries.length - 1 && entry.includes('.')) {
        const ipv4 = parseIpv4(entry)
        if (!ipv4) return null
        result.push(((ipv4[0] ?? 0) * 256 + (ipv4[1] ?? 0)).toString(16))
        result.push(((ipv4[2] ?? 0) * 256 + (ipv4[3] ?? 0)).toString(16))
        continue
      }
      if (!/^[0-9a-f]{1,4}$/.test(entry)) return null
      result.push(entry)
    }
    return result
  }

  let groups: string[]
  if (text.includes('::')) {
    const [headText = '', tailText = ''] = text.split('::', 2)
    const head = expand(headText)
    const tail = expand(tailText)
    if (!head || !tail) return null
    const missing = 8 - head.length - tail.length
    if (missing < 1) return null
    groups = [...head, ...Array.from({ length: missing }, () => '0'), ...tail]
  } else {
    const parts = expand(text)
    if (!parts) return null
    groups = parts
  }
  if (groups.length !== 8) return null
  return groups.map((group) => Number.parseInt(group, 16))
}

function embeddedIpv4(words: number[]): string | null {
  const high = words[0] ?? 0
  const low = words[1] ?? 0
  return `${(high >> 8) & 0xff}.${high & 0xff}.${(low >> 8) & 0xff}.${low & 0xff}`
}

export function isPublicIpv6(address: string): boolean {
  const words = parseIpv6(address)
  if (!words) return false

  const allZero = words.every((word) => word === 0)
  if (allZero) return false
  // ::1 loopback
  if (words.slice(0, 7).every((word) => word === 0) && words[7] === 1) return false

  // IPv4-mapped ::ffff:0:0/96
  if (words.slice(0, 5).every((word) => word === 0) && words[5] === 0xffff) {
    const ipv4 = embeddedIpv4([words[6] ?? 0, words[7] ?? 0])
    return ipv4 ? isPublicIpv4(ipv4) : false
  }
  // IPv4-compatible ::/96 (deprecated, but can reach IPv4 targets)
  if (words.slice(0, 6).every((word) => word === 0)) {
    return false
  }
  // NAT64 64:ff9b::/96
  if (words[0] === 0x0064 && words[1] === 0xff9b && words.slice(2, 6).every((word) => word === 0)) {
    const ipv4 = embeddedIpv4([words[6] ?? 0, words[7] ?? 0])
    return ipv4 ? isPublicIpv4(ipv4) : false
  }
  // 6to4 2002::/16 and Teredo 2001:0000::/32 are deprecated and can tunnel
  // IPv4 addresses; reject outright instead of trying to special-case them.
  if (words[0] === 0x2002) return false
  if (words[0] === 0x2001 && words[1] === 0x0000) return false

  const first = words[0] ?? 0
  // Unique local fc00::/7
  if ((first & 0xfe00) === 0xfc00) return false
  // Link local fe80::/10
  if ((first & 0xffc0) === 0xfe80) return false
  // Multicast ff00::/8
  if ((first & 0xff00) === 0xff00) return false
  // Documentation 2001:db8::/32
  if (first === 0x2001 && words[1] === 0x0db8) return false
  // Discard-only 100::/64
  if (first === 0x0100 && words.slice(1, 4).every((word) => word === 0)) return false
  // Benchmark 2001:2::/48
  if (first === 0x2001 && words[1] === 0x0002 && words[2] === 0x0000) return false
  // ORCHID 2001:10::/28 and 2001:20::/28
  if (first === 0x2001 && ((words[1] ?? 0) & 0xfff0) === 0x0010) return false
  if (first === 0x2001 && ((words[1] ?? 0) & 0xfff0) === 0x0020) return false

  // Only global unicast 2000::/3 is accepted.
  return (first & 0xe000) === 0x2000
}

export function isPublicIp(address: string): boolean {
  const clean = address.trim().replace(/^\[|\]$/g, '')
  const version = isIP(clean)
  if (version === 4) return isPublicIpv4(clean)
  if (version === 6) return isPublicIpv6(clean)
  return false
}

function isBlockedHostname(hostname: string): boolean {
  const host = hostname.trim().toLowerCase().replace(/\.$/, '')
  if (!host) return true
  if (host === 'localhost') return true
  for (const suffix of BLOCKED_HOST_SUFFIXES) {
    if (host === suffix || host.endsWith(`.${suffix}`)) return true
  }
  // Single-label hosts are nearly always internal names.
  if (!host.includes('.') && isIP(host) === 0) return true
  if (host.length > 253) return true
  return host.split('.').some((label) => label.length > 63)
}

export interface ValidatedTarget {
  url: URL
  hostname: string
  port: number
  isIpLiteral: boolean
}

/**
 * Validate the URL shape without doing DNS. The returned URL has no fragment.
 * Ports are limited to the normal web ports to avoid public port scanning.
 */
export function validateTargetUrl(raw: string): ValidatedTarget {
  let url: URL
  try {
    url = new URL(String(raw ?? '').trim())
  } catch {
    throw new UrlSafetyError('Die URL ist ungültig.')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new UrlSafetyError('Nur öffentliche HTTP(S)-Webseiten sind erlaubt.')
  }
  if (url.username || url.password) {
    throw new UrlSafetyError('URLs mit Benutzername oder Passwort sind nicht erlaubt.')
  }
  if (url.href.length > 2048) {
    throw new UrlSafetyError('Die URL ist zu lang.')
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, '')
  if (!hostname) throw new UrlSafetyError('Die URL enthält keinen Hostnamen.')
  if (isBlockedHostname(hostname)) {
    throw new UrlSafetyError('Lokale, private oder interne Ziele sind nicht erlaubt.')
  }
  const effectivePort = url.port || (url.protocol === 'https:' ? '443' : '80')
  if (effectivePort !== '80' && effectivePort !== '443') {
    throw new UrlSafetyError('Nur die Ports 80 und 443 sind erlaubt.')
  }
  if (isIP(hostname) !== 0) {
    if (!isPublicIp(hostname)) {
      throw new UrlSafetyError('Private, lokale oder reservierte IP-Adressen sind nicht erlaubt.')
    }
  }
  url.hash = ''
  return {
    url,
    hostname,
    port: Number(effectivePort),
    isIpLiteral: isIP(hostname) !== 0,
  }
}

export type DnsLookup = (
  hostname: string,
) => Promise<Array<{ address: string; family: number }>>

const defaultLookup: DnsLookup = async (hostname) => {
  const results = await dnsLookup(hostname, { all: true, verbatim: true })
  return results.map((entry) => ({ address: entry.address, family: entry.family }))
}

/**
 * Resolve every DNS answer and reject the request if any address is private.
 * Returning all validated addresses lets the connector pin one of them without
 * resolving the name again inside http.request.
 */
export async function resolvePublicAddresses(
  hostname: string,
  lookup: DnsLookup = defaultLookup,
): Promise<Array<{ address: string; family: number }>> {
  if (isIP(hostname) !== 0) {
    if (!isPublicIp(hostname)) {
      throw new UrlSafetyError('Private, lokale oder reservierte IP-Adressen sind nicht erlaubt.')
    }
    return [{ address: hostname, family: isIP(hostname) }]
  }
  let results: Array<{ address: string; family: number }>
  try {
    results = await lookup(hostname)
  } catch (error) {
    throw new UrlSafetyError(`Der Hostname konnte nicht aufgelöst werden: ${(error as Error).message}`)
  }
  if (!results || results.length === 0) {
    throw new UrlSafetyError('Der Hostname konnte nicht aufgelöst werden.')
  }
  for (const result of results) {
    if (!isPublicIp(result.address)) {
      throw new UrlSafetyError(
        'Der Hostname verweist auf eine private, lokale oder reservierte Adresse.',
      )
    }
  }
  return results
}

/** Node `lookup` function pinned to one already validated address. */
export function pinnedLookup(address: string, family: number) {
  return (
    _hostname: string,
    options: { all?: boolean } | ((...args: unknown[]) => void),
    callback?: (...args: unknown[]) => void,
  ): void => {
    const opts = typeof options === 'function' ? {} : options
    const done = (typeof options === 'function' ? options : callback) as
      | ((...args: unknown[]) => void)
      | undefined
    if (!done) return
    if (opts.all) {
      done(null, [{ address, family }])
    } else {
      done(null, address, family)
    }
  }
}
