/*
 * Küchenrunde – Cloudflare Pages Function für den URL-Rezeptimport
 * Copyright (C) 2026 openCook Web contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Route: POST /api/recipe-fetch
 *
 * Ablauf:
 *  1. Nur POST, JSON, same-origin.
 *  2. Grobe IP-Rate-Limitierung vor der teuren Authentifizierungsprüfung.
 *  3. Gültiges Supabase-Access-Token + Mitgliedschaft in household_members.
 *  4. URL nach gemeinsamen Regeln prüfen (Cloud: keine IP-Literale, nur 80/443).
 *  5. Fremde Seite serverseitig mit manuellen Redirects und harten Limits holen.
 *  6. HTML nur mit dem vorhandenen JSON-LD-Parser auswerten; niemals rohes
 *     fremdes HTML an den Browser weitergeben.
 *
 * Kein Service-Role-Key, keine Cookies, keine Authorization-/Referer-Header an
 * die fremde Website. Die Rate-Limits sind isolate-lokal (kein KV/Durable
 * Object); diese Grenze ist dokumentiert.
 */

import { extractRecipeCandidates } from '../../src/import/jsonld'
import {
  REMOTE_FETCH_LIMITS,
  UrlSafetyError,
  validateRemoteTarget,
} from '../../src/import/remote-url-policy'
import {
  clientKey,
  errorResponse,
  HttpError,
  isSameOrigin,
  readJsonBody,
} from '../lib/http'
import {
  CLOUD_URL_POLICY,
  CloudFetchError,
  fetchCloudRecipeHtml,
  fetchCloudRecipeImage,
} from '../lib/remote-fetch'
import {
  authorizeHouseholdMember,
  type SupabaseEnv,
} from '../lib/supabase-auth'

export interface Env extends SupabaseEnv {}

export interface PagesContext<E> {
  request: Request
  env: E
  params: Record<string, string | string[]>
  next: () => Promise<Response>
  waitUntil: (promise: Promise<unknown>) => void
  data: Record<string, unknown>
}

export interface RecipeFetchDependencies {
  authorize?: typeof authorizeHouseholdMember
  fetchHtml?: typeof fetchCloudRecipeHtml
  fetchImage?: typeof fetchCloudRecipeImage
  now?: () => number
}

export const RATE_LIMITS = {
  perIpPerMinute: 30,
  perUserPerMinute: 60,
  windowMs: 60_000,
} as const

const MAX_JSON_RESPONSE_BYTES = 6 * 1024 * 1024

interface Bucket {
  count: number
  resetAt: number
}

const buckets = new Map<string, Bucket>()

export function resetRecipeFetchRateLimits(): void {
  buckets.clear()
}

function rateLimited(key: string, limit: number, now: number): boolean {
  if (buckets.size > 2_000) {
    for (const [entryKey, bucket] of buckets) {
      if (bucket.resetAt <= now) buckets.delete(entryKey)
    }
  }
  const bucket = buckets.get(key)
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + RATE_LIMITS.windowMs })
    return false
  }
  bucket.count += 1
  return bucket.count > limit
}

function fetchErrorResponse(error: CloudFetchError): Response {
  const status =
    error.code === 'timeout'
      ? 504
      : error.code === 'too-large'
        ? 413
        : error.code === 'not-html' || error.code === 'not-image'
          ? 415
          : 502
  return errorResponse(status, error.code, error.message)
}

function errorToResponse(error: unknown): Response {
  if (error instanceof HttpError) {
    return errorResponse(error.status, error.code, error.message)
  }
  if (error instanceof UrlSafetyError) {
    return errorResponse(400, error.code, error.message)
  }
  if (error instanceof CloudFetchError) {
    return fetchErrorResponse(error)
  }
  return errorResponse(500, 'internal', 'Der Abruf ist fehlgeschlagen.')
}

function contentTypeIsJson(request: Request): boolean {
  const value = (request.headers.get('content-type') ?? '').trim().toLowerCase()
  return value.startsWith('application/json')
}

/**
 * Main handler. Exported separately so the complete flow can be tested without
 * a Pages runtime or a development server.
 */
export async function handleRecipeFetch(
  request: Request,
  env: Env | undefined,
  deps: RecipeFetchDependencies = {},
): Promise<Response> {
  if (request.method !== 'POST') {
    return errorResponse(405, 'method-not-allowed', 'Nur POST ist erlaubt.', {
      Allow: 'POST',
    })
  }
  if (!isSameOrigin(request)) {
    return errorResponse(403, 'forbidden-origin', 'Nur Anfragen aus dieser App sind erlaubt.')
  }
  if (!contentTypeIsJson(request)) {
    return errorResponse(415, 'invalid-content-type', 'Anfragen müssen JSON sein.')
  }

  const now = deps.now ?? Date.now
  if (rateLimited(`ip:${clientKey(request)}`, RATE_LIMITS.perIpPerMinute, now())) {
    return errorResponse(429, 'rate-limited', 'Zu viele Abrufe. Bitte kurz warten.')
  }

  try {
    const body = await readJsonBody(request)
    const url = typeof body.url === 'string' ? body.url.trim() : ''
    if (!url) {
      throw new HttpError(400, 'invalid-request', 'Es wurde keine URL übermittelt.')
    }
    const kind = body.kind === 'image' ? 'image' : 'html'

    // Authentication is the primary gate. The URL is only validated after a
    // valid household member has been established.
    const authorize = deps.authorize ?? authorizeHouseholdMember
    const member = await authorize(request, env)
    if (rateLimited(`user:${member.id}`, RATE_LIMITS.perUserPerMinute, now())) {
      throw new HttpError(429, 'rate-limited', 'Zu viele Abrufe. Bitte kurz warten.')
    }

    validateRemoteTarget(url, CLOUD_URL_POLICY)

    if (kind === 'image') {
      const fetchImage = deps.fetchImage ?? fetchCloudRecipeImage
      const image = await fetchImage(url)
      const body = new Uint8Array(image.bytes).buffer
      return new Response(body, {
        status: 200,
        headers: {
          'Content-Type': image.mimeType,
          'Content-Length': String(image.bytes.byteLength),
          'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff',
          'X-Final-Url': encodeURIComponent(image.finalUrl),
        },
      })
    }

    const fetchHtml = deps.fetchHtml ?? fetchCloudRecipeHtml
    const page = await fetchHtml(url)
    // Reuse the exact parser used by the local import. It is pure and bounds
    // the amount of data it reads. Raw foreign HTML is not part of the response.
    const extraction = extractRecipeCandidates(page.html, page.finalUrl)
    const payload = {
      ok: true,
      finalUrl: page.finalUrl,
      contentType: page.contentType,
      bytes: page.bytes,
      extraction,
    }
    const serialized = new TextEncoder().encode(JSON.stringify(payload))
    if (serialized.byteLength > MAX_JSON_RESPONSE_BYTES) {
      return errorResponse(413, 'too-large', 'Die ausgewerteten Rezeptdaten sind zu groß.')
    }
    return new Response(serialized, {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': String(serialized.byteLength),
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    })
  } catch (error) {
    return errorToResponse(error)
  }
}

/** Cloudflare Pages entry point. Only the `/api/recipe-fetch` route invokes it. */
export const onRequest = (context: PagesContext<Env>): Promise<Response> =>
  handleRecipeFetch(context.request, context.env)

/** Keep the request-body limit discoverable for documentation/tests. */
export const MAX_REQUEST_BYTES = REMOTE_FETCH_LIMITS.maxRequestBodyBytes

