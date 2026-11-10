/*
 * Küchenrunde – Supabase-Authentifizierung der Pages Function
 * Copyright (C) 2026 openCook Web contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Der Import-Endpunkt ist kein öffentlicher Proxy. Er akzeptiert nur ein
 * gültiges Supabase-Access-Token und prüft anschließend mit der vorhandenen
 * SECURITY-INVOKER-Funktion `public.is_household_member()`, ob das Konto zum
 * Familienhaushalt gehört.
 *
 * Es wird ausschließlich der öffentliche Publishable-/Anon-Key als `apikey`
 * verwendet. Ein service_role-/Secret-Key wird aktiv abgelehnt. Tokens werden
 * nie geloggt, nie an die Rezeptwebsite weitergegeben und nie in Antworten
 * aufgenommen.
 */

import { bearerToken, HttpError } from './http'
import { validateRemoteTarget } from '../../src/import/remote-url-policy'

export interface SupabaseEnv {
  SUPABASE_URL?: string
  SUPABASE_PUBLISHABLE_KEY?: string
  SUPABASE_ANON_KEY?: string
}

export interface SupabaseConfig {
  origin: string
  publishableKey: string
}

export interface AuthorizedMember {
  id: string
  email: string | null
}

export interface AuthDependencies {
  fetchImpl?: typeof fetch
  timeoutMs?: number
}

const AUTH_TIMEOUT_MS = 5_000

function base64UrlDecode(value: string): string {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/')
  const withPadding = padded + '='.repeat((4 - (padded.length % 4)) % 4)
  if (typeof atob !== 'function') return ''
  try {
    return atob(withPadding)
  } catch {
    return ''
  }
}

/**
 * Reject keys that are service-role-equivalent. The public publishable key or
 * the legacy anon JWT may be used; a secret/service key must never reach this
 * Function.
 */
function assertPublicKey(key: string): void {
  if (key.startsWith('sb_secret_') || /service[_-]?role/i.test(key)) {
    throw new HttpError(
      503,
      'not-configured',
      'Der Importdienst ist nicht korrekt konfiguriert. Es darf nur der öffentliche Supabase-Key verwendet werden.',
    )
  }
  const parts = key.split('.')
  if (parts.length === 3 && parts[1]) {
    const payload = base64UrlDecode(parts[1])
    if (payload) {
      try {
        const decoded = JSON.parse(payload) as { role?: unknown }
        if (decoded.role === 'service_role') {
          throw new HttpError(
            503,
            'not-configured',
            'Der Importdienst ist nicht korrekt konfiguriert. Es darf nur der öffentliche Supabase-Key verwendet werden.',
          )
        }
      } catch (error) {
        if (error instanceof HttpError) throw error
        // An unreadable JWT payload is not a reason to expose anything.
      }
    }
  }
}

/**
 * Read and validate the runtime environment. `SUPABASE_URL` and
 * `SUPABASE_PUBLISHABLE_KEY` are set as Pages environment variables, never as
 * VITE_* build variables (those would end up in the browser bundle).
 */
export function readSupabaseConfig(env: SupabaseEnv | undefined): SupabaseConfig {
  const rawUrl = (env?.SUPABASE_URL ?? '').trim()
  const key = (env?.SUPABASE_PUBLISHABLE_KEY ?? env?.SUPABASE_ANON_KEY ?? '').trim()
  if (!rawUrl || !key) {
    throw new HttpError(
      503,
      'not-configured',
      'Der Importdienst ist nicht konfiguriert. SUPABASE_URL und SUPABASE_PUBLISHABLE_KEY fehlen.',
    )
  }
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    throw new HttpError(503, 'not-configured', 'SUPABASE_URL ist ungültig.')
  }
  try {
    validateRemoteTarget(url.toString(), {
      rejectIpLiterals: true,
      requireDefaultPortForScheme: true,
    })
  } catch {
    throw new HttpError(
      503,
      'not-configured',
      'SUPABASE_URL muss eine öffentliche HTTPS-Adresse ohne Zugangsdaten sein.',
    )
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new HttpError(
      503,
      'not-configured',
      'SUPABASE_URL muss eine öffentliche HTTPS-Adresse ohne Zugangsdaten sein.',
    )
  }
  if (key.length < 20) {
    throw new HttpError(503, 'not-configured', 'SUPABASE_PUBLISHABLE_KEY ist ungültig.')
  }
  assertPublicKey(key)
  return { origin: url.origin, publishableKey: key }
}

async function supabaseFetch(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal })
  } catch (error) {
    if ((error as Error)?.name === 'AbortError') {
      throw new HttpError(504, 'upstream-timeout', 'Die Anmeldeprüfung hat zu lange gedauert.')
    }
    throw new HttpError(502, 'upstream', 'Die Anmeldeprüfung ist derzeit nicht erreichbar.')
  } finally {
    clearTimeout(timer)
  }
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return (await response.json()) as unknown
  } catch {
    throw new HttpError(502, 'upstream', 'Die Anmeldeprüfung hat keine gültige Antwort geliefert.')
  }
}

/**
 * Validate the bearer token with Supabase Auth and then check the existing
 * household membership RPC. Throws HttpError 401 (missing/invalid token),
 * 403 (authenticated but not a household member) or 502/503/504.
 */
export async function authorizeHouseholdMember(
  request: Request,
  env: SupabaseEnv | undefined,
  deps: AuthDependencies = {},
): Promise<AuthorizedMember> {
  const token = bearerToken(request)
  if (!token) {
    throw new HttpError(401, 'unauthorized', 'Für den Import ist eine Anmeldung erforderlich.')
  }
  const config = readSupabaseConfig(env)
  const fetchImpl = deps.fetchImpl ?? globalThis.fetch?.bind(globalThis)
  if (!fetchImpl) {
    throw new HttpError(502, 'upstream', 'Der Importdienst ist nicht erreichbar.')
  }
  const timeoutMs = deps.timeoutMs ?? AUTH_TIMEOUT_MS
  const authorization = `Bearer ${token}`

  const userResponse = await supabaseFetch(
    fetchImpl,
    `${config.origin}/auth/v1/user`,
    {
      method: 'GET',
      cache: 'no-store',
      headers: {
        apikey: config.publishableKey,
        Authorization: authorization,
        Accept: 'application/json',
      },
    },
    timeoutMs,
  )
  if (userResponse.status === 401 || userResponse.status === 403) {
    throw new HttpError(401, 'unauthorized', 'Die Anmeldung ist ungültig oder abgelaufen.')
  }
  if (!userResponse.ok) {
    throw new HttpError(502, 'upstream', 'Die Anmeldeprüfung ist derzeit nicht erreichbar.')
  }
  const user = await readJson(userResponse)
  if (typeof user !== 'object' || user === null || Array.isArray(user)) {
    throw new HttpError(502, 'upstream', 'Die Anmeldeprüfung hat keine gültige Antwort geliefert.')
  }
  const record = user as Record<string, unknown>
  if (typeof record.id !== 'string' || !record.id) {
    throw new HttpError(401, 'unauthorized', 'Die Anmeldung ist ungültig oder abgelaufen.')
  }

  const membershipResponse = await supabaseFetch(
    fetchImpl,
    `${config.origin}/rest/v1/rpc/is_household_member`,
    {
      method: 'POST',
      cache: 'no-store',
      headers: {
        apikey: config.publishableKey,
        Authorization: authorization,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: '{}',
    },
    timeoutMs,
  )
  if (membershipResponse.status === 401) {
    throw new HttpError(401, 'unauthorized', 'Die Anmeldung ist ungültig oder abgelaufen.')
  }
  if (membershipResponse.status === 403) {
    throw new HttpError(403, 'not-a-member', 'Dieses Konto ist nicht für den Familienhaushalt freigegeben.')
  }
  if (!membershipResponse.ok) {
    throw new HttpError(502, 'upstream', 'Die Mitgliedschaft konnte nicht geprüft werden.')
  }
  const membership = await readJson(membershipResponse)
  if (membership !== true) {
    throw new HttpError(403, 'not-a-member', 'Dieses Konto ist nicht für den Familienhaushalt freigegeben.')
  }

  return {
    id: record.id,
    email: typeof record.email === 'string' ? record.email : null,
  }
}
