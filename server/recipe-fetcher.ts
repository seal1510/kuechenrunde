/*
 * openCook Web
 * Copyright (C) 2026 openCook Web contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Local, server-side fetch service for the URL recipe import.
 *
 * Design notes:
 *  - The browser never contacts third-party recipe pages directly.
 *  - Only public HTTP(S) targets on ports 80/443 are allowed.
 *  - DNS answers are validated and pinned into the socket lookup, which blocks
 *    DNS rebinding between validation and connection.
 *  - Redirects are followed manually and validated again on every hop.
 *  - Time, size and redirect limits apply. HTML content type is enforced.
 *  - No cookies, authorization headers, local credentials or proxy env values
 *    are sent to the remote site. Remote scripts are never executed.
 *
 * This module is plain Node code and has no React/Dexie dependency. The Vite
 * plugin mounts it for development and preview; a production deployment must
 * put the same handler behind TLS and authentication/rate limiting.
 */

import http from 'node:http'
import https from 'node:https'
import {
  createBrotliDecompress,
  createGunzip,
  createInflate,
} from 'node:zlib'
import { SAFE_REMOTE_IMAGE_MIME_TYPES, sniffImageMime } from '../src/import/image-mime'
import {
  isPublicIp,
  pinnedLookup,
  resolvePublicAddresses,
  UrlSafetyError,
  validateTargetUrl,
  type ValidatedTarget,
} from './url-safety'

export const FETCH_LIMITS = {
  htmlBytes: 5 * 1024 * 1024,
  imageBytes: 8 * 1024 * 1024,
  maxRedirects: 5,
  maxImageRedirects: 3,
  timeoutMs: 15_000,
  maxUrlLength: 2048,
} as const

export type RemoteFetchErrorCode =
  | 'timeout'
  | 'too-large'
  | 'not-html'
  | 'not-image'
  | 'redirect'
  | 'http'
  | 'network'
  | 'content-encoding'

export class RemoteFetchError extends Error {
  readonly code: RemoteFetchErrorCode

  constructor(code: RemoteFetchErrorCode, message: string) {
    super(message)
    this.name = 'RemoteFetchError'
    this.code = code
  }
}

export interface FetchedHtml {
  html: string
  finalUrl: string
  contentType: string
  bytes: number
}

export interface FetchedRemoteImage {
  bytes: Buffer
  mimeType: string
  finalUrl: string
}

interface RawResponse {
  status: number
  headers: http.IncomingHttpHeaders
  body: Buffer
}

function headerValue(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? '') : (value ?? '')
}

/** MIME type without parameters, lowercased. */
export function contentTypeMime(value: string | string[] | undefined): string {
  return headerValue(value).split(';')[0]?.trim().toLowerCase() ?? ''
}

export function isHtmlContentType(value: string | string[] | undefined): boolean {
  const mime = contentTypeMime(value)
  return mime === 'text/html' || mime === 'application/xhtml+xml'
}

export function isImageContentType(value: string | string[] | undefined): boolean {
  const mime = contentTypeMime(value)
  return mime.startsWith('image/') || mime === 'application/octet-stream'
}

/** Decode HTML bytes using the header charset, a meta charset, or UTF-8. */
export function decodeHtmlBuffer(buffer: Buffer, contentType: string): string {
  const headerCharset = /charset\s*=\s*["']?([^;"'\s]+)/i.exec(contentType)?.[1]
  let charset = headerCharset
  if (!charset) {
    const head = buffer.subarray(0, 4096).toString('latin1')
    charset =
      /<meta[^>]+charset\s*=\s*["']?([^"'\s/>]+)/i.exec(head)?.[1] ??
      /<meta[^>]+content\s*=\s*["'][^"']*charset\s*=\s*([^"'\s;]+)/i.exec(head)?.[1]
  }
  const label = (charset ?? 'utf-8').toLowerCase().replace(/^utf8$/, 'utf-8')
  try {
    return new TextDecoder(label, { fatal: false }).decode(buffer).replace(/^\uFEFF/, '')
  } catch {
    return new TextDecoder('utf-8', { fatal: false }).decode(buffer).replace(/^\uFEFF/, '')
  }
}

/** Read a stream with a hard byte cap; also guards against decompression bombs. */
export async function readLimited(
  stream: AsyncIterable<Uint8Array | string>,
  maxBytes: number,
): Promise<Buffer> {
  const chunks: Buffer[] = []
  let total = 0
  try {
    for await (const chunk of stream) {
      const buffer = typeof chunk === 'string' ? Buffer.from(chunk) : Buffer.from(chunk)
      total += buffer.byteLength
      if (total > maxBytes) {
        const destroy = (stream as { destroy?: () => void }).destroy
        if (typeof destroy === 'function') destroy.call(stream)
        throw new RemoteFetchError(
          'too-large',
          `Die Antwort ist größer als ${Math.round(maxBytes / 1024 / 1024)} MB.`,
        )
      }
      chunks.push(buffer)
    }
  } catch (error) {
    if (error instanceof RemoteFetchError) throw error
    throw new RemoteFetchError('network', `Die Antwort konnte nicht gelesen werden: ${(error as Error).message}`)
  }
  return Buffer.concat(chunks, total)
}

/** Resolve a redirect target with the same URL safety rules as the first URL. */
export function resolveRedirect(currentUrl: URL, location: string): URL {
  let resolved: URL
  try {
    resolved = new URL(location, currentUrl)
  } catch {
    throw new RemoteFetchError('redirect', 'Die Weiterleitung enthält eine ungültige Ziel-URL.')
  }
  return validateTargetUrl(resolved.toString()).url
}

function requestHeaders(target: ValidatedTarget, kind: 'html' | 'image'): http.OutgoingHttpHeaders {
  return {
    Host: target.url.host,
    'User-Agent': 'Kuechenrunde/0.2 (local recipe import)',
    Accept:
      kind === 'html'
        ? 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.1'
        : 'image/avif,image/webp,image/png,image/jpeg,image/gif;q=0.9,*/*;q=0.1',
    'Accept-Language': 'de-DE,de;q=0.9,en;q=0.7',
    'Accept-Encoding': 'gzip, deflate, br',
    Connection: 'close',
    // Deliberately no Cookie, Authorization, Proxy-Authorization, Referer or
    // Origin headers. Nothing local is forwarded to the foreign site.
  }
}

function requestOnce(
  target: ValidatedTarget,
  addresses: Array<{ address: string; family: number }>,
  deadline: number,
  maxBytes: number,
  kind: 'html' | 'image',
): Promise<RawResponse> {
  const attempt = (address: string, family: number): Promise<RawResponse> =>
    new Promise((resolve, reject) => {
      const remaining = deadline - Date.now()
      if (remaining <= 0) {
        reject(new RemoteFetchError('timeout', 'Der Abruf hat zu lange gedauert.'))
        return
      }
      let settled = false
      let timer: ReturnType<typeof setTimeout> | null = null
      const finish = (callback: () => void) => {
        if (settled) return
        settled = true
        if (timer) clearTimeout(timer)
        callback()
      }

      const options: https.RequestOptions = {
        hostname: target.hostname,
        port: target.port,
        path: `${target.url.pathname || '/'}${target.url.search}`,
        method: 'GET',
        headers: requestHeaders(target, kind),
        // Pin the validated address into the socket lookup. Node will not
        // resolve the hostname a second time.
        lookup: pinnedLookup(address, family) as never,
        servername: target.isIpLiteral ? undefined : target.hostname,
        rejectUnauthorized: true,
        timeout: remaining,
      }

      const request =
        target.url.protocol === 'https:'
          ? https.request(options, (response) => {
              handleResponse(
                response,
                maxBytes,
                kind,
                (value) => finish(() => resolve(value)),
                (error) => finish(() => reject(error)),
              )
            })
          : http.request(options, (response) => {
              handleResponse(
                response,
                maxBytes,
                kind,
                (value) => finish(() => resolve(value)),
                (error) => finish(() => reject(error)),
              )
            })

      timer = setTimeout(() => {
        finish(() => reject(new RemoteFetchError('timeout', 'Der Abruf hat zu lange gedauert.')))
        request.destroy()
      }, remaining)

      request.on('error', (error) => {
        finish(() =>
          reject(
            new RemoteFetchError(
              'network',
              `Die Verbindung zum Zielserver ist fehlgeschlagen: ${error.message}`,
            ),
          ),
        )
      })
      request.setTimeout(remaining, () => {
        finish(() => reject(new RemoteFetchError('timeout', 'Der Abruf hat zu lange gedauert.')))
        request.destroy()
      })
      request.end()
    })

  const run = async (): Promise<RawResponse> => {
    let lastError: Error | null = null
    for (const entry of addresses) {
      try {
        return await attempt(entry.address, entry.family)
      } catch (error) {
        lastError = error as Error
        if ((error as RemoteFetchError).code !== 'network') throw error
      }
    }
    throw lastError ?? new RemoteFetchError('network', 'Keine Verbindung zum Zielserver.')
  }

  return run()
}

function handleResponse(
  response: http.IncomingMessage,
  maxBytes: number,
  kind: 'html' | 'image',
  resolve: (value: RawResponse) => void,
  reject: (error: Error) => void,
): void {
  const status = response.statusCode ?? 0
  const headers = response.headers

  // Redirects are handled by the caller. Drain the tiny body and return.
  if (status >= 300 && status < 400) {
    response.resume()
    resolve({ status, headers, body: Buffer.alloc(0) })
    return
  }
  if (status < 200 || status >= 300) {
    response.resume()
    reject(new RemoteFetchError('http', `Der Zielserver hat mit HTTP ${status} geantwortet.`))
    return
  }

  // Reject wrong content types before downloading the body. This keeps the
  // fetch service from becoming a general-purpose proxy.
  if (kind === 'html' && !isHtmlContentType(headers['content-type'])) {
    response.resume()
    reject(
      new RemoteFetchError(
        'not-html',
        `Der Zielserver hat keine HTML-Seite geliefert (Content-Type: ${contentTypeMime(headers['content-type']) || 'unbekannt'}).`,
      ),
    )
    return
  }
  if (kind === 'image' && !isImageContentType(headers['content-type'])) {
    response.resume()
    reject(
      new RemoteFetchError(
        'not-image',
        `Der Zielserver hat kein Bild geliefert (Content-Type: ${contentTypeMime(headers['content-type']) || 'unbekannt'}).`,
      ),
    )
    return
  }

  const declared = Number(headerValue(headers['content-length']))
  if (Number.isFinite(declared) && declared > maxBytes) {
    response.destroy()
    reject(
      new RemoteFetchError(
        'too-large',
        `Die Antwort ist größer als ${Math.round(maxBytes / 1024 / 1024)} MB.`,
      ),
    )
    return
  }

  const encoding = headerValue(headers['content-encoding']).toLowerCase().trim()
  let stream: NodeJS.ReadableStream = response
  try {
    if (encoding === 'gzip' || encoding === 'x-gzip') stream = response.pipe(createGunzip())
    else if (encoding === 'deflate') stream = response.pipe(createInflate())
    else if (encoding === 'br') stream = response.pipe(createBrotliDecompress())
    else if (encoding && encoding !== 'identity') {
      response.destroy()
      reject(
        new RemoteFetchError(
          'content-encoding',
          `Die Seite verwendet eine nicht unterstützte Komprimierung (${encoding}).`,
        ),
      )
      return
    }
  } catch (error) {
    response.destroy()
    reject(new RemoteFetchError('content-encoding', (error as Error).message))
    return
  }

  void readLimited(stream as AsyncIterable<Uint8Array>, maxBytes)
    .then((body) => resolve({ status, headers, body }))
    .catch((error) => {
      response.destroy()
      reject(error as Error)
    })
}

async function fetchWithRedirects(
  rawUrl: string,
  kind: 'html' | 'image',
  maxRedirects: number,
  maxBytes: number,
): Promise<{ response: RawResponse; finalTarget: ValidatedTarget }> {
  const deadline = Date.now() + FETCH_LIMITS.timeoutMs
  let target = validateTargetUrl(rawUrl)
  let redirects = 0

  for (;;) {
    const addresses = await resolvePublicAddresses(target.hostname)
    const response = await requestOnce(target, addresses, deadline, maxBytes, kind)

    if (response.status >= 300 && response.status < 400) {
      if (redirects >= maxRedirects) {
        throw new RemoteFetchError('redirect', 'Zu viele Weiterleitungen.')
      }
      const location = headerValue(response.headers.location)
      if (!location) {
        throw new RemoteFetchError('redirect', 'Die Weiterleitung enthält kein Ziel.')
      }
      const next = resolveRedirect(target.url, location)
      target = validateTargetUrl(next.toString())
      redirects += 1
      continue
    }

    if (response.status < 200 || response.status >= 300) {
      throw new RemoteFetchError('http', `Der Zielserver hat mit HTTP ${response.status} geantwortet.`)
    }
    return { response, finalTarget: target }
  }
}

/** Fetch an HTML page. The response is decoded to text but never executed. */
export async function fetchRecipeHtml(rawUrl: string): Promise<FetchedHtml> {
  const { response, finalTarget } = await fetchWithRedirects(
    rawUrl,
    'html',
    FETCH_LIMITS.maxRedirects,
    FETCH_LIMITS.htmlBytes,
  )
  if (!isHtmlContentType(response.headers['content-type'])) {
    throw new RemoteFetchError(
      'not-html',
      `Der Zielserver hat keine HTML-Seite geliefert (Content-Type: ${contentTypeMime(response.headers['content-type']) || 'unbekannt'}).`,
    )
  }
  if (response.body.byteLength === 0) {
    throw new RemoteFetchError('not-html', 'Die Seite ist leer.')
  }
  const contentType = headerValue(response.headers['content-type'])
  const html = decodeHtmlBuffer(response.body, contentType)
  return {
    html,
    finalUrl: finalTarget.url.toString(),
    contentType,
    bytes: response.body.byteLength,
  }
}

/** Fetch and validate a remote image. SVG and other executable formats are rejected. */
export async function fetchRecipeImage(rawUrl: string): Promise<FetchedRemoteImage> {
  const { response, finalTarget } = await fetchWithRedirects(
    rawUrl,
    'image',
    FETCH_LIMITS.maxImageRedirects,
    FETCH_LIMITS.imageBytes,
  )
  if (!isImageContentType(response.headers['content-type'])) {
    throw new RemoteFetchError(
      'not-image',
      `Der Zielserver hat kein Bild geliefert (Content-Type: ${contentTypeMime(response.headers['content-type']) || 'unbekannt'}).`,
    )
  }
  const mimeType = sniffImageMime(response.body)
  if (!mimeType || !SAFE_REMOTE_IMAGE_MIME_TYPES.has(mimeType)) {
    throw new RemoteFetchError(
      'not-image',
      'Der Inhalt ist kein unterstütztes Bildformat (JPEG, PNG, WebP, GIF, AVIF).',
    )
  }
  return {
    bytes: response.body,
    mimeType,
    finalUrl: finalTarget.url.toString(),
  }
}

export { UrlSafetyError, isPublicIp }
