/*
 * Küchenrunde – gemeinsame Regeln für fremde Rezept-URLs
 * Copyright (C) 2026 openCook Web contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Laufzeitunabhängige URL-, IP- und Antwortregeln für den URL-Import. Dieses
 * Modul enthält bewusst keine Netzwerk-, DNS- oder Node-API. Es wird sowohl vom
 * lokalen Vite-Middleware-Fetcher (Node) als auch von der Cloudflare-Pages-
 * Function (Workers) verwendet, damit beide Pfade dieselben Grenzen prüfen.
 *
 * Die Regeln sind konservativ:
 *  - nur HTTP/HTTPS, keine Zugangsdaten,
 *  - nur Port 80/443 (Cloud zusätzlich nur der zum Schema passende Port),
 *  - keine IP-Literale im Cloud-Pfad,
 *  - keine lokalen, internen, reservierten oder Wildcard-DNS-Ziele,
 *  - jede Weiterleitung wird wie eine neue Start-URL geprüft.
 *
 * DNS-Pinning ist Node-spezifisch und bleibt in server/url-safety.ts. Die
 * Cloudflare-Function kann DNS nicht pinnen; dort wird die verbleibende Grenze
 * im Handler dokumentiert.
 */

export class UrlSafetyError extends Error {
  readonly code = 'unsafe-url'

  constructor(message: string) {
    super(message)
    this.name = 'UrlSafetyError'
  }
}

export const REMOTE_FETCH_LIMITS = {
  htmlBytes: 5 * 1024 * 1024,
  imageBytes: 8 * 1024 * 1024,
  maxRedirects: 5,
  maxImageRedirects: 3,
  timeoutMs: 15_000,
  maxUrlLength: 2048,
  maxRequestBodyBytes: 16 * 1024,
} as const

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
  'alt',
  // Wildcard-DNS-Dienste, die eine beliebige (auch private) IP aus dem
  // Hostnamen ableiten. Sie umgehen eine reine Namensprüfung.
  'nip.io',
  'sslip.io',
  'xip.io',
  'localtest.me',
  'lvh.me',
  'vcap.me',
  'traefik.me',
  'local.gd',
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

export type IpVersion = 0 | 4 | 6

/** Eigene, von Node unabhängige IP-Erkennung. */
export function ipVersion(address: string): IpVersion {
  const clean = String(address ?? '')
    .trim()
    .replace(/^\[|\]$/g, '')
  if (parseIpv4(clean)) return 4
  if (parseIpv6(clean)) return 6
  return 0
}

export function isPublicIp(address: string): boolean {
  const clean = String(address ?? '')
    .trim()
    .replace(/^\[|\]$/g, '')
  const version = ipVersion(clean)
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
  // IP-Adressen werden separat geprüft; single-label hosts sind fast immer
  // interne Namen und im Import nie sinnvoll. IPv6-Literale enthalten ':'
  // und dürfen deshalb nicht an der Label-Prüfung scheitern.
  const version = ipVersion(host)
  if (version !== 0) return false
  if (!host.includes('.')) return true
  if (host.length > 253) return true
  return host
    .split('.')
    .some(
      (label) =>
        label.length === 0 ||
        label.length > 63 ||
        !/^[a-z0-9-]+$/i.test(label) ||
        label.startsWith('-') ||
        label.endsWith('-'),
    )
}

export interface ValidatedRemoteTarget {
  url: URL
  hostname: string
  port: number
  isIpLiteral: boolean
}

export interface RemoteUrlPolicyOptions {
  /** Cloud-Pfad: keine IP-Literale, auch keine öffentlichen. */
  rejectIpLiterals?: boolean
  /** Cloud-Pfad: http nur auf 80, https nur auf 443. */
  requireDefaultPortForScheme?: boolean
}

/**
 * Prüft die URL-Form ohne DNS. Der zurückgegebene URL-Wert enthält kein
 * Fragment. Die Funktion ist absichtlich frei von Netzwerkzugriffen.
 */
export function validateRemoteTarget(
  raw: string,
  options: RemoteUrlPolicyOptions = {},
): ValidatedRemoteTarget {
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
  if (url.href.length > REMOTE_FETCH_LIMITS.maxUrlLength) {
    throw new UrlSafetyError('Die URL ist zu lang.')
  }

  const hostname = url.hostname.replace(/^\[|\]$/g, '')
  if (!hostname) throw new UrlSafetyError('Die URL enthält keinen Hostnamen.')
  if (isBlockedHostname(hostname)) {
    throw new UrlSafetyError('Lokale, private oder interne Ziele sind nicht erlaubt.')
  }

  const effectivePort = url.port || (url.protocol === 'https:' ? '443' : '80')
  const expectedPort = url.protocol === 'https:' ? '443' : '80'
  if (effectivePort !== '80' && effectivePort !== '443') {
    throw new UrlSafetyError('Nur die Ports 80 und 443 sind erlaubt.')
  }
  if (options.requireDefaultPortForScheme && effectivePort !== expectedPort) {
    throw new UrlSafetyError('Der Port passt nicht zum verwendeten HTTP-Schema.')
  }

  const version = ipVersion(hostname)
  if (version !== 0) {
    if (options.rejectIpLiterals) {
      throw new UrlSafetyError('Direkte IP-Adressen sind für den Import nicht erlaubt.')
    }
    if (!isPublicIp(hostname)) {
      throw new UrlSafetyError('Private, lokale oder reservierte IP-Adressen sind nicht erlaubt.')
    }
  }

  url.hash = ''
  return {
    url,
    hostname,
    port: Number(effectivePort),
    isIpLiteral: version !== 0,
  }
}

/**
 * Löst ein Redirect-Ziel relativ zur aktuellen URL auf und prüft es vollständig
 * mit denselben Regeln wie die Start-URL.
 */
export function resolveRemoteRedirect(
  currentUrl: URL,
  location: string,
  options: RemoteUrlPolicyOptions = {},
): URL {
  let resolved: URL
  try {
    resolved = new URL(String(location ?? ''), currentUrl)
  } catch {
    throw new UrlSafetyError('Die Weiterleitung enthält eine ungültige Ziel-URL.')
  }
  return validateRemoteTarget(resolved.toString(), options).url
}

/** MIME type without parameters, lowercased. */
export function contentTypeMime(value: string | string[] | null | undefined): string {
  const raw = Array.isArray(value) ? (value[0] ?? '') : (value ?? '')
  return raw.split(';')[0]?.trim().toLowerCase() ?? ''
}

export function isHtmlContentType(value: string | string[] | null | undefined): boolean {
  const mime = contentTypeMime(value)
  return mime === 'text/html' || mime === 'application/xhtml+xml'
}

export function isImageContentType(value: string | string[] | null | undefined): boolean {
  const mime = contentTypeMime(value)
  return mime.startsWith('image/') || mime === 'application/octet-stream'
}

function asciiHead(bytes: Uint8Array, length: number): string {
  const end = Math.min(bytes.length, length)
  let result = ''
  for (let index = 0; index < end; index += 1) {
    result += String.fromCharCode(bytes[index] ?? 0)
  }
  return result
}

/**
 * Dekodiert HTML-Bytes mit Header-Charset, Meta-Charset oder UTF-8. Die
 * Funktion nutzt nur Web-Standard-APIs (TextDecoder) und läuft damit auch in
 * Cloudflare Workers.
 */
export function decodeHtmlBytes(bytes: Uint8Array, contentType: string): string {
  const headerCharset = /charset\s*=\s*["']?([^;"'\s]+)/i.exec(contentType)?.[1]
  let charset = headerCharset
  if (!charset) {
    const head = asciiHead(bytes, 4096)
    charset =
      /<meta[^>]+charset\s*=\s*["']?([^"'\s/>]+)/i.exec(head)?.[1] ??
      /<meta[^>]+content\s*=\s*["'][^"']*charset\s*=\s*([^"'\s;]+)/i.exec(head)?.[1]
  }
  const label = (charset ?? 'utf-8').toLowerCase().replace(/^utf8$/, 'utf-8')
  try {
    return new TextDecoder(label, { fatal: false }).decode(bytes).replace(/^\uFEFF/, '')
  } catch {
    return new TextDecoder('utf-8', { fatal: false }).decode(bytes).replace(/^\uFEFF/, '')
  }
}
