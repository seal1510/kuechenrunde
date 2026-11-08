/*
 * openCook Web
 * Copyright (C) 2026 openCook Web contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Vite dev/preview middleware for the URL import. It exposes a same-origin
 * endpoint only; there are deliberately no CORS headers and no wildcard proxy.
 * A production deployment must mount an equivalent handler behind its own
 * authenticated, rate-limited backend (see IMPLEMENTATION_05.md).
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Connect, Plugin } from 'vite'
import {
  fetchRecipeHtml,
  fetchRecipeImage,
  RemoteFetchError,
} from './recipe-fetcher'
import { UrlSafetyError } from './url-safety'

export const RECIPE_FETCH_PATH = '/api/recipe-fetch'
const MAX_REQUEST_BYTES = 16 * 1024
const RATE_LIMIT = 30
const RATE_WINDOW_MS = 60_000

interface Bucket {
  count: number
  resetAt: number
}

const buckets = new Map<string, Bucket>()

export function resetRecipeFetchRateLimits(): void {
  buckets.clear()
}

function rateLimited(key: string): boolean {
  const now = Date.now()
  const bucket = buckets.get(key)
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + RATE_WINDOW_MS })
    return false
  }
  bucket.count += 1
  return bucket.count > RATE_LIMIT
}

function sendJson(response: ServerResponse, status: number, value: unknown): void {
  const body = JSON.stringify(value)
  response.statusCode = status
  response.setHeader('Content-Type', 'application/json; charset=utf-8')
  response.setHeader('Content-Length', Buffer.byteLength(body))
  response.setHeader('Cache-Control', 'no-store')
  response.setHeader('X-Content-Type-Options', 'nosniff')
  response.end(body)
}

function sendError(response: ServerResponse, status: number, code: string, message: string): void {
  sendJson(response, status, { ok: false, code, error: message })
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const declared = Number(request.headers['content-length'])
  if (Number.isFinite(declared) && declared > MAX_REQUEST_BYTES) {
    throw new Error('request-too-large')
  }
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    total += buffer.byteLength
    if (total > MAX_REQUEST_BYTES) throw new Error('request-too-large')
    chunks.push(buffer)
  }
  const text = Buffer.concat(chunks, total).toString('utf8')
  if (!text.trim()) throw new Error('empty-request')
  try {
    return JSON.parse(text)
  } catch {
    throw new Error('invalid-json')
  }
}

function isSameOrigin(request: IncomingMessage): boolean {
  const site = String(request.headers['sec-fetch-site'] ?? '')
  if (site === 'cross-site') return false
  const origin = request.headers.origin
  if (!origin) return true
  if (origin === 'null') return false
  try {
    return new URL(origin).host === request.headers.host
  } catch {
    return false
  }
}

function errorStatus(error: unknown): { status: number; code: string; message: string } {
  if (error instanceof UrlSafetyError) {
    return { status: 400, code: error.code, message: error.message }
  }
  if (error instanceof RemoteFetchError) {
    const status =
      error.code === 'timeout'
        ? 504
        : error.code === 'too-large'
          ? 413
          : error.code === 'not-html' || error.code === 'not-image'
            ? 415
            : 502
    return { status, code: error.code, message: error.message }
  }
  const message = (error as Error)?.message
  if (message === 'request-too-large') {
    return { status: 413, code: 'too-large', message: 'Die Anfrage ist zu groß.' }
  }
  if (message === 'invalid-json' || message === 'empty-request') {
    return { status: 400, code: 'invalid-request', message: 'Ungültige Anfrage.' }
  }
  return { status: 500, code: 'internal', message: 'Der Abruf ist fehlgeschlagen.' }
}

export function createRecipeFetchHandler() {
  return (request: IncomingMessage, response: ServerResponse, _next: Connect.NextFunction): void => {
    void (async () => {
      if (request.method !== 'POST') {
        response.setHeader('Allow', 'POST')
        sendError(response, 405, 'method-not-allowed', 'Nur POST ist erlaubt.')
        return
      }
      if (!isSameOrigin(request)) {
        sendError(response, 403, 'forbidden-origin', 'Nur Anfragen aus dieser App sind erlaubt.')
        return
      }
      const contentType = String(request.headers['content-type'] ?? '')
      if (!contentType.toLowerCase().startsWith('application/json')) {
        sendError(response, 415, 'invalid-content-type', 'Anfragen müssen JSON sein.')
        return
      }
      const key = request.socket.remoteAddress ?? 'unknown'
      if (rateLimited(key)) {
        sendError(response, 429, 'rate-limited', 'Zu viele Abrufe. Bitte kurz warten.')
        return
      }

      let body: unknown
      try {
        body = await readJsonBody(request)
      } catch (error) {
        const mapped = errorStatus(error)
        sendError(response, mapped.status, mapped.code, mapped.message)
        return
      }
      if (typeof body !== 'object' || body === null || Array.isArray(body)) {
        sendError(response, 400, 'invalid-request', 'Ungültige Anfrage.')
        return
      }
      const record = body as Record<string, unknown>
      const url = typeof record.url === 'string' ? record.url : ''
      const kind = record.kind === 'image' ? 'image' : 'html'
      if (!url) {
        sendError(response, 400, 'invalid-request', 'Es wurde keine URL übermittelt.')
        return
      }

      try {
        if (kind === 'image') {
          const image = await fetchRecipeImage(url)
          response.statusCode = 200
          response.setHeader('Content-Type', image.mimeType)
          response.setHeader('Content-Length', image.bytes.byteLength)
          response.setHeader('X-Final-Url', encodeURIComponent(image.finalUrl))
          response.setHeader('Cache-Control', 'no-store')
          response.setHeader('X-Content-Type-Options', 'nosniff')
          response.end(image.bytes)
          return
        }

        const page = await fetchRecipeHtml(url)
        sendJson(response, 200, {
          ok: true,
          html: page.html,
          finalUrl: page.finalUrl,
          contentType: page.contentType,
          bytes: page.bytes,
        })
      } catch (error) {
        const mapped = errorStatus(error)
        sendError(response, mapped.status, mapped.code, mapped.message)
      }
    })()
  }
}

/** Vite plugin: active for `vite dev` and `vite preview`, never for the build. */
export function recipeFetchPlugin(): Plugin {
  const handler = createRecipeFetchHandler()
  return {
    name: 'opencook-recipe-fetch',
    configureServer(server) {
      server.middlewares.use(RECIPE_FETCH_PATH, handler)
    },
    configurePreviewServer(server) {
      server.middlewares.use(RECIPE_FETCH_PATH, handler)
    },
  }
}
