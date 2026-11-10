/*
 * Küchenrunde – kleine HTTP-Helfer der Pages Function
 * Copyright (C) 2026 openCook Web contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { REMOTE_FETCH_LIMITS } from '../../src/import/remote-url-policy'

export class HttpError extends Error {
  readonly status: number
  readonly code: string

  constructor(status: number, code: string, message: string) {
    super(message)
    this.name = 'HttpError'
    this.status = status
    this.code = code
  }
}

export const JSON_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
} as const

export function jsonResponse(
  status: number,
  value: unknown,
  extraHeaders: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { ...JSON_HEADERS, ...extraHeaders },
  })
}

export function errorResponse(
  status: number,
  code: string,
  message: string,
  extraHeaders: Record<string, string> = {},
): Response {
  return jsonResponse(status, { ok: false, code, error: message }, extraHeaders)
}

function concatBytes(chunks: readonly Uint8Array[], total: number): Uint8Array {
  const result = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.byteLength
  }
  return result
}

/**
 * Read the JSON request body with a hard cap. Content-Length is checked first,
 * then the stream is capped while reading because the header can lie.
 */
export async function readJsonBody(request: Request): Promise<Record<string, unknown>> {
  const declared = Number(request.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > REMOTE_FETCH_LIMITS.maxRequestBodyBytes) {
    throw new HttpError(413, 'too-large', 'Die Anfrage ist zu groß.')
  }
  const body = request.body
  if (!body) throw new HttpError(400, 'invalid-request', 'Ungültige Anfrage.')
  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue
      total += value.byteLength
      if (total > REMOTE_FETCH_LIMITS.maxRequestBodyBytes) {
        try {
          await reader.cancel()
        } catch {
          // The size limit is authoritative even if cancelling fails.
        }
        throw new HttpError(413, 'too-large', 'Die Anfrage ist zu groß.')
      }
      chunks.push(value)
    }
  } catch (error) {
    if (error instanceof HttpError) throw error
    throw new HttpError(400, 'invalid-request', 'Die Anfrage konnte nicht gelesen werden.')
  }
  if (total === 0) throw new HttpError(400, 'invalid-request', 'Ungültige Anfrage.')
  let parsed: unknown
  try {
    parsed = JSON.parse(new TextDecoder().decode(concatBytes(chunks, total)))
  } catch {
    throw new HttpError(400, 'invalid-request', 'Ungültige Anfrage.')
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new HttpError(400, 'invalid-request', 'Ungültige Anfrage.')
  }
  return parsed as Record<string, unknown>
}

/**
 * Only a same-origin browser request is accepted. The Authorization check is
 * the primary gate; this is an additional CSRF/exfiltrations guard. No CORS
 * headers are returned, so a foreign origin cannot use the endpoint silently.
 */
export function isSameOrigin(request: Request): boolean {
  const site = request.headers.get('sec-fetch-site') ?? ''
  if (site === 'cross-site') return false
  const origin = request.headers.get('origin')
  if (!origin) return true
  if (origin === 'null') return false
  try {
    return new URL(origin).host === new URL(request.url).host
  } catch {
    return false
  }
}

/** Bearer token from the Authorization header; never logged or echoed. */
export function bearerToken(request: Request): string | null {
  const header = (request.headers.get('authorization') ?? '').trim()
  const match = /^Bearer\s+([A-Za-z0-9._~+/=-]+)$/i.exec(header)
  if (!match) return null
  const token = match[1] ?? ''
  if (token.length < 20 || token.length > 4096) return null
  return token
}

/** Cloudflare provides this header; do not trust client-supplied X-Forwarded-For. */
export function clientKey(request: Request): string {
  const ip = (request.headers.get('cf-connecting-ip') ?? '').trim()
  return ip || 'unknown'
}
