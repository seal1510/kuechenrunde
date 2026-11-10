/*
 * Küchenrunde – abgesicherter Remote-Abruf in Cloudflare Workers
 * Copyright (C) 2026 openCook Web contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Der Browser ruft ausschließlich die eigene Pages Function auf. Diese Datei
 * holt die fremde Rezeptseite bzw. das Bild. Sie nutzt die Web-Standard-API
 * `fetch()` der Workers-Runtime und teilt URL-, IP- und Content-Regeln mit dem
 * lokalen Node-Fetcher.
 *
 * Cloudflare-spezifische Grenze: Anders als der Node-Pfad kann dieser Pfad DNS
 * nicht pinnen. Deshalb werden IP-Literale und interne Namen abgelehnt, jede
 * Weiterleitung wird vollständig neu geprüft, und Cloudflares öffentliches
 * Egress (ohne VPC-Bindung) bleibt die Netzwerkgrenze. Ein DNS-Rebinding
 * zwischen Prüfung und Verbindung ist aus Anwendungscode nicht vollständig
 * ausschließbar; diese Grenze wird nicht als gleichwertig zum Node-Pinning
 * dargestellt.
 */

import { SAFE_REMOTE_IMAGE_MIME_TYPES, sniffImageMime } from '../../src/import/image-mime'
import {
  decodeHtmlBytes,
  isHtmlContentType,
  isImageContentType,
  REMOTE_FETCH_LIMITS,
  resolveRemoteRedirect,
  validateRemoteTarget,
  type RemoteUrlPolicyOptions,
  type ValidatedRemoteTarget,
} from '../../src/import/remote-url-policy'

export const CLOUD_URL_POLICY: RemoteUrlPolicyOptions = {
  rejectIpLiterals: true,
  requireDefaultPortForScheme: true,
}

export type CloudFetchErrorCode =
  | 'timeout'
  | 'too-large'
  | 'not-html'
  | 'not-image'
  | 'redirect'
  | 'http'
  | 'network'

export class CloudFetchError extends Error {
  readonly code: CloudFetchErrorCode

  constructor(code: CloudFetchErrorCode, message: string) {
    super(message)
    this.name = 'CloudFetchError'
    this.code = code
  }
}

export interface CloudFetchDependencies {
  fetchImpl?: typeof fetch
  now?: () => number
  timeoutMs?: number
}

export interface FetchedCloudHtml {
  html: string
  finalUrl: string
  contentType: string
  bytes: number
}

export interface FetchedCloudImage {
  bytes: Uint8Array
  mimeType: string
  finalUrl: string
}

function headerValue(headers: Headers, name: string): string {
  return headers.get(name) ?? ''
}

function outboundHeaders(kind: 'html' | 'image'): Headers {
  // Deliberately no Cookie, Authorization, Referer, Origin or other local
  // headers. Nothing from the incoming request is copied to the foreign site.
  return new Headers({
    'User-Agent': 'Kuechenrunde/0.2 (cloud recipe import)',
    Accept:
      kind === 'html'
        ? 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.1'
        : 'image/avif,image/webp,image/png,image/jpeg,image/gif;q=0.9,*/*;q=0.1',
    'Accept-Language': 'de-DE,de;q=0.9,en;q=0.7',
    'Accept-Encoding': 'identity',
    'Cache-Control': 'no-cache',
  })
}

async function cancelBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel()
  } catch {
    // Cancelling a response body is best effort.
  }
}

/**
 * Read a response stream with a hard byte cap. The check happens while reading,
 * not only against a possibly absent or incorrect Content-Length header.
 */
async function readBodyLimited(response: Response, maxBytes: number): Promise<Uint8Array> {
  const body = response.body
  if (!body) return new Uint8Array()
  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue
      total += value.byteLength
      if (total > maxBytes) {
        try {
          await reader.cancel()
        } catch {
          // The size limit is authoritative even if cancelling fails.
        }
        throw new CloudFetchError(
          'too-large',
          `Die Antwort ist größer als ${Math.round(maxBytes / 1024 / 1024)} MB.`,
        )
      }
      chunks.push(value)
    }
  } catch (error) {
    if (error instanceof CloudFetchError) throw error
    throw new CloudFetchError('network', 'Die Antwort konnte nicht gelesen werden.')
  }
  const result = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.byteLength
  }
  return result
}

interface HopResult {
  status: number
  headers: Headers
  body: Uint8Array
}

async function fetchOneHop(
  target: ValidatedRemoteTarget,
  kind: 'html' | 'image',
  deadline: number,
  deps: Required<Pick<CloudFetchDependencies, 'fetchImpl' | 'now'>>,
): Promise<HopResult> {
  const remaining = deadline - deps.now()
  if (remaining <= 0) {
    throw new CloudFetchError('timeout', 'Der Abruf hat zu lange gedauert.')
  }

  const controller = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, remaining)

  try {
    let response: Response
    try {
      response = await deps.fetchImpl(target.url.toString(), {
        method: 'GET',
        // Manual redirects are essential: the target is validated again before
        // every following request. `redirect: 'error'` is not supported by all
        // Workers runtimes and would not let us inspect a 3xx response.
        redirect: 'manual',
        cache: 'no-store',
        headers: outboundHeaders(kind),
        signal: controller.signal,
      })
    } catch (error) {
      if (timedOut || (error as Error)?.name === 'AbortError') {
        throw new CloudFetchError('timeout', 'Der Abruf hat zu lange gedauert.')
      }
      throw new CloudFetchError('network', 'Die Verbindung zum Zielserver ist fehlgeschlagen.')
    }

    if (response.status >= 300 && response.status < 400) {
      await cancelBody(response)
      return { status: response.status, headers: response.headers, body: new Uint8Array() }
    }
    if (response.status < 200 || response.status >= 300) {
      await cancelBody(response)
      throw new CloudFetchError(
        'http',
        `Der Zielserver hat mit HTTP ${response.status} geantwortet.`,
      )
    }

    if (kind === 'html' && !isHtmlContentType(headerValue(response.headers, 'content-type'))) {
      await cancelBody(response)
      throw new CloudFetchError(
        'not-html',
        `Der Zielserver hat keine HTML-Seite geliefert (Content-Type: ${
          headerValue(response.headers, 'content-type').split(';')[0]?.trim() || 'unbekannt'
        }).`,
      )
    }
    if (kind === 'image' && !isImageContentType(headerValue(response.headers, 'content-type'))) {
      await cancelBody(response)
      throw new CloudFetchError(
        'not-image',
        `Der Zielserver hat kein Bild geliefert (Content-Type: ${
          headerValue(response.headers, 'content-type').split(';')[0]?.trim() || 'unbekannt'
        }).`,
      )
    }

    const maxBytes = kind === 'html' ? REMOTE_FETCH_LIMITS.htmlBytes : REMOTE_FETCH_LIMITS.imageBytes
    const declared = Number(headerValue(response.headers, 'content-length'))
    if (Number.isFinite(declared) && declared > maxBytes) {
      await cancelBody(response)
      throw new CloudFetchError(
        'too-large',
        `Die Antwort ist größer als ${Math.round(maxBytes / 1024 / 1024)} MB.`,
      )
    }

    let body: Uint8Array
    try {
      body = await readBodyLimited(response, maxBytes)
    } catch (error) {
      if (timedOut && error instanceof CloudFetchError && error.code === 'network') {
        throw new CloudFetchError('timeout', 'Der Abruf hat zu lange gedauert.')
      }
      throw error
    }
    return { status: response.status, headers: response.headers, body }
  } finally {
    clearTimeout(timer)
  }
}

async function fetchWithRedirects(
  rawUrl: string,
  kind: 'html' | 'image',
  maxRedirects: number,
  deps: CloudFetchDependencies,
): Promise<{ target: ValidatedRemoteTarget; hop: HopResult }> {
  const now = deps.now ?? Date.now
  const fetchImpl = deps.fetchImpl ?? globalThis.fetch?.bind(globalThis)
  if (!fetchImpl) {
    throw new CloudFetchError('network', 'Der Abruf ist auf diesem Server nicht verfügbar.')
  }
  const timeoutMs = deps.timeoutMs ?? REMOTE_FETCH_LIMITS.timeoutMs
  const deadline = now() + timeoutMs
  let target = validateRemoteTarget(rawUrl, CLOUD_URL_POLICY)
  let redirects = 0

  for (;;) {
    const hop = await fetchOneHop(target, kind, deadline, { fetchImpl, now })

    if (hop.status >= 300 && hop.status < 400) {
      if (redirects >= maxRedirects) {
        throw new CloudFetchError('redirect', 'Zu viele Weiterleitungen.')
      }
      const location = headerValue(hop.headers, 'location')
      if (!location) {
        throw new CloudFetchError('redirect', 'Die Weiterleitung enthält kein Ziel.')
      }
      const next = resolveRemoteRedirect(target.url, location, CLOUD_URL_POLICY)
      target = validateRemoteTarget(next.toString(), CLOUD_URL_POLICY)
      redirects += 1
      continue
    }

    return { target, hop }
  }
}

/** Fetch and decode a remote recipe page. HTML is never executed or returned raw to the browser. */
export async function fetchCloudRecipeHtml(
  rawUrl: string,
  deps: CloudFetchDependencies = {},
): Promise<FetchedCloudHtml> {
  const { target, hop } = await fetchWithRedirects(
    rawUrl,
    'html',
    REMOTE_FETCH_LIMITS.maxRedirects,
    deps,
  )
  if (hop.body.byteLength === 0) {
    throw new CloudFetchError('not-html', 'Die Seite ist leer.')
  }
  const contentType = headerValue(hop.headers, 'content-type')
  return {
    html: decodeHtmlBytes(hop.body, contentType),
    finalUrl: target.url.toString(),
    contentType,
    bytes: hop.body.byteLength,
  }
}

/** Fetch and validate a remote image. SVG and other executable formats are rejected. */
export async function fetchCloudRecipeImage(
  rawUrl: string,
  deps: CloudFetchDependencies = {},
): Promise<FetchedCloudImage> {
  const { target, hop } = await fetchWithRedirects(
    rawUrl,
    'image',
    REMOTE_FETCH_LIMITS.maxImageRedirects,
    deps,
  )
  if (hop.body.byteLength === 0) {
    throw new CloudFetchError('not-image', 'Das Bild ist leer.')
  }
  const mimeType = sniffImageMime(hop.body)
  if (!mimeType || !SAFE_REMOTE_IMAGE_MIME_TYPES.has(mimeType)) {
    throw new CloudFetchError(
      'not-image',
      'Der Inhalt ist kein unterstütztes Bildformat (JPEG, PNG, WebP, GIF, AVIF).',
    )
  }
  return {
    bytes: hop.body,
    mimeType,
    finalUrl: target.url.toString(),
  }
}
