/*
 * openCook Web
 * Copyright (C) 2026 openCook Web contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * SSRF protection for the local URL fetch service.
 *
 * The URL/IP rules are shared with the Cloudflare Pages Function in
 * `src/import/remote-url-policy.ts`. This Node-only module adds the part that
 * Cloudflare Workers cannot provide: resolve the hostname, reject any private
 * answer, and pin a validated address into the actual socket lookup so a second
 * DNS answer cannot redirect the connection to an internal address (DNS
 * rebinding).
 */

import { lookup as dnsLookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import {
  isPublicIp,
  validateRemoteTarget,
  UrlSafetyError,
  type RemoteUrlPolicyOptions,
  type ValidatedRemoteTarget,
} from '../src/import/remote-url-policy'

export { isPublicIp, UrlSafetyError }
export type { ValidatedRemoteTarget }
export type ValidatedTarget = ValidatedRemoteTarget

const DEFAULT_POLICY: RemoteUrlPolicyOptions = {
  rejectIpLiterals: false,
  requireDefaultPortForScheme: false,
}

/**
 * Validate the URL shape without doing DNS. The returned URL has no fragment.
 * Ports are limited to the normal web ports to avoid public port scanning.
 * The Node path keeps supporting public IP literals for backwards
 * compatibility; the Cloudflare path rejects them.
 */
export function validateTargetUrl(
  raw: string,
  options: RemoteUrlPolicyOptions = DEFAULT_POLICY,
): ValidatedRemoteTarget {
  return validateRemoteTarget(raw, { ...DEFAULT_POLICY, ...options })
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
