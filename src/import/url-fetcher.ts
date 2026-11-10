/*
 * openCook Web
 * Copyright (C) 2026 openCook Web contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Client side of the URL import. This is a thin interface to a same-origin
 * backend endpoint. It never fetches third-party pages directly (CORS would make
 * that unreliable and unsafe), sends no cookies, and validates every URL again
 * before sending it.
 *
 * Local mode talks to the Vite middleware without an Authorization header.
 * Cloud mode sends the current Supabase access token only to the own API
 * endpoint; the Pages Function never forwards it to the recipe website.
 */

import type { RecipeExtraction } from './jsonld'
import { SAFE_REMOTE_IMAGE_MIME_TYPES, sniffImageMime } from './image-mime'
import { normalizeHttpUrl } from './url'

export const DEFAULT_RECIPE_FETCH_ENDPOINT = '/api/recipe-fetch'
export const CLIENT_HTML_LIMIT_BYTES = 6 * 1024 * 1024
export const CLIENT_IMAGE_LIMIT_BYTES = 8 * 1024 * 1024
export const CLIENT_TIMEOUT_MS = 30_000

export type RecipeFetchErrorCode =
  | 'invalid-url'
  | 'unavailable'
  | 'timeout'
  | 'too-large'
  | 'not-html'
  | 'not-image'
  | 'http'
  | 'network'
  | 'invalid-response'
  | 'unauthorized'
  | 'forbidden'
  | 'rate-limited'

export class RecipeFetchError extends Error {
  readonly code: RecipeFetchErrorCode

  constructor(code: RecipeFetchErrorCode, message: string) {
    super(message)
    this.name = 'RecipeFetchError'
    this.code = code
  }
}

export interface FetchedPage {
  /**
   * Raw HTML from the local endpoint. The Cloudflare endpoint deliberately
   * returns only the parsed extraction, so this is empty in cloud mode.
   */
  html: string
  finalUrl: string
  contentType: string
  /** Server-side JSON-LD extraction; avoids sending raw HTML to the browser. */
  extraction?: RecipeExtraction
}

export interface FetchedImage {
  bytes: ArrayBuffer
  mimeType: string
  finalUrl: string
}

export interface RecipeUrlFetcher {
  fetchPage(url: string): Promise<FetchedPage>
  fetchImage(url: string): Promise<FetchedImage>
}

export type RecipeFetchService = 'local' | 'cloud'

export interface RecipeFetcherOptions {
  endpoint?: string
  fetchImpl?: typeof fetch
  timeoutMs?: number
  service?: RecipeFetchService
  /**
   * Only used by the cloud mode. Returns the current Supabase access token.
   * A missing token is reported as an authentication error before any request.
   */
  getAccessToken?: () => Promise<string | null>
}

function configuredEndpoint(): string {
  const env = import.meta.env as Record<string, string | undefined> | undefined
  return env?.VITE_RECIPE_FETCH_ENDPOINT?.trim() || DEFAULT_RECIPE_FETCH_ENDPOINT
}

/** In cloud mode the Supabase token may only go to a same-origin endpoint. */
function isAllowedCloudEndpoint(endpoint: string): boolean {
  const absolute = /^([a-z][a-z0-9+.-]*:|\/\/)/i.test(endpoint)
  if (!absolute) return true
  try {
    const location = (globalThis as { location?: { origin?: string } }).location
    if (!location?.origin) return false
    return new URL(endpoint, location.origin).origin === new URL(location.origin).origin
  } catch {
    return false
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function readError(response: Response): Promise<{ message: string; code?: string }> {
  try {
    const data = (await response.json()) as unknown
    if (isRecord(data)) {
      return {
        message: typeof data.error === 'string' ? data.error : `HTTP ${response.status}`,
        code: typeof data.code === 'string' ? data.code : undefined,
      }
    }
  } catch {
    // Fall through to the status-only message.
  }
  return { message: `HTTP ${response.status}` }
}

/**
 * Accept the server-side extraction only when its outer shape is plausible.
 * The parser itself already bounds and sanitises every field; this guard keeps
 * a misconfigured endpoint from crashing the preview with a non-object payload.
 */
function readExtraction(value: unknown): RecipeExtraction | undefined {
  if (!isRecord(value)) return undefined
  if (!Array.isArray(value.candidates)) return undefined
  if (!Array.isArray(value.warnings)) return undefined
  if (typeof value.jsonLdBlockCount !== 'number') return undefined
  if (typeof value.recipeObjectCount !== 'number') return undefined
  if (typeof value.baseUrl !== 'string') return undefined
  const candidates = value.candidates
  if (
    !candidates.every(
      (candidate) =>
        isRecord(candidate) &&
        typeof candidate.key === 'string' &&
        typeof candidate.title === 'string' &&
        Array.isArray(candidate.ingredients) &&
        Array.isArray(candidate.instructions) &&
        Array.isArray(candidate.images) &&
        Array.isArray(candidate.warnings),
    )
  ) {
    return undefined
  }
  return value as unknown as RecipeExtraction
}

const SERVER_ERROR_CODES: Record<string, RecipeFetchErrorCode> = {
  timeout: 'timeout',
  'too-large': 'too-large',
  'not-html': 'not-html',
  'not-image': 'not-image',
  unauthorized: 'unauthorized',
  forbidden: 'forbidden',
  'forbidden-origin': 'forbidden',
  'not-a-member': 'forbidden',
  'rate-limited': 'rate-limited',
  'not-configured': 'unavailable',
}

function errorCodeFor(response: Response, code: string | undefined): RecipeFetchErrorCode {
  if (code && SERVER_ERROR_CODES[code]) return SERVER_ERROR_CODES[code]
  if (response.status === 401) return 'unauthorized'
  if (response.status === 403) return 'forbidden'
  if (response.status === 429) return 'rate-limited'
  if (response.status === 503) return 'unavailable'
  return 'http'
}

export function createRecipeFetcher(options: RecipeFetcherOptions = {}): RecipeUrlFetcher {
  const endpoint = (options.endpoint ?? configuredEndpoint()).replace(/\/+$/, '')
  const timeoutMs = options.timeoutMs ?? CLIENT_TIMEOUT_MS
  const fetchImpl = options.fetchImpl ?? globalThis.fetch?.bind(globalThis)
  const cloud = options.service === 'cloud'
  const serviceLabel = cloud ? 'Der Importdienst der Familien-Cloud' : 'Der lokale Abrufdienst'
  const cloudEndpointAllowed = !cloud || isAllowedCloudEndpoint(endpoint)

  async function accessToken(): Promise<string | null> {
    if (!options.getAccessToken) return null
    let token: string | null
    try {
      token = await options.getAccessToken()
    } catch {
      throw new RecipeFetchError(
        'unauthorized',
        'Die Anmeldung konnte nicht geprüft werden. Bitte erneut anmelden.',
      )
    }
    if (!token) {
      throw new RecipeFetchError(
        'unauthorized',
        'Die Anmeldung ist abgelaufen. Bitte erneut anmelden und den Import wiederholen.',
      )
    }
    return token
  }

  async function post(url: string, body: Record<string, unknown>): Promise<Response> {
    if (!cloudEndpointAllowed) {
      throw new RecipeFetchError(
        'unavailable',
        'Der Import-Endpunkt muss im Cloud-Modus same-origin sein.',
      )
    }
    if (!fetchImpl) {
      throw new RecipeFetchError(
        'unavailable',
        `${serviceLabel} ist nicht verfügbar (kein fetch im Browser).`,
      )
    }
    const token = await accessToken()
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    }
    // Only the own API gets the token. It is never part of the request that the
    // server makes to the foreign recipe website.
    if (token) headers.Authorization = `Bearer ${token}`
    try {
      return await fetchImpl(endpoint, {
        method: 'POST',
        // No cookies, no automatic redirects, no shared cache.
        credentials: 'omit',
        cache: 'no-store',
        redirect: 'error',
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      })
    } catch (error) {
      if ((error as Error).name === 'AbortError') {
        throw new RecipeFetchError('timeout', 'Der Abruf hat zu lange gedauert.')
      }
      throw new RecipeFetchError(
        'network',
        cloud
          ? 'Der Importdienst ist nicht erreichbar. Bitte die Verbindung prüfen.'
          : 'Der lokale Abrufdienst ist nicht erreichbar. Läuft der Entwicklungsserver?',
      )
    } finally {
      clearTimeout(timer)
    }
  }

  async function fetchPage(rawUrl: string): Promise<FetchedPage> {
    const normalized = normalizeHttpUrl(rawUrl)
    if (!normalized) {
      throw new RecipeFetchError('invalid-url', 'Bitte eine gültige öffentliche HTTP(S)-URL eingeben.')
    }
    const response = await post(normalized, { url: normalized, kind: 'html' })
    if (!response.ok) {
      const { message, code } = await readError(response)
      if (response.status === 404 || response.status === 405 || response.status === 501) {
        throw new RecipeFetchError(
          'unavailable',
          cloud
            ? 'Der Import-Endpunkt ist auf diesem Server nicht verfügbar.'
            : 'Der lokale Abrufdienst ist nicht verfügbar. In der Entwicklung startet er mit dem Vite-Server; für den Produktivbetrieb ist ein abgesichertes Backend erforderlich.',
        )
      }
      throw new RecipeFetchError(errorCodeFor(response, code), message)
    }

    let data: unknown
    try {
      data = await response.json()
    } catch {
      throw new RecipeFetchError(
        'unavailable',
        cloud
          ? 'Der Importdienst hat keine gültige Antwort geliefert.'
          : 'Der Abrufdienst antwortet nicht im erwarteten Format. Ist der lokale Importdienst aktiv?',
      )
    }
    if (!isRecord(data)) {
      throw new RecipeFetchError('invalid-response', 'Der Abrufdienst hat keine gültige Antwort geliefert.')
    }
    const extraction = readExtraction(data.extraction)
    const hasHtml = typeof data.html === 'string'
    if (!hasHtml && !extraction) {
      throw new RecipeFetchError(
        'invalid-response',
        'Der Abrufdienst hat weder eine HTML-Seite noch ausgewertete Rezeptdaten geliefert.',
      )
    }
    const finalUrl = normalizeHttpUrl(typeof data.finalUrl === 'string' ? data.finalUrl : normalized)
    if (!finalUrl) {
      throw new RecipeFetchError('invalid-response', 'Der Abrufdienst hat eine ungültige Ziel-URL geliefert.')
    }
    const html = hasHtml ? (data.html as string) : ''
    if (html.length > CLIENT_HTML_LIMIT_BYTES) {
      throw new RecipeFetchError('too-large', 'Die Seite ist zu groß für den Import.')
    }
    return {
      html,
      finalUrl,
      contentType: typeof data.contentType === 'string' ? data.contentType : 'text/html',
      extraction,
    }
  }

  async function fetchImage(rawUrl: string): Promise<FetchedImage> {
    const normalized = normalizeHttpUrl(rawUrl)
    if (!normalized) {
      throw new RecipeFetchError('invalid-url', 'Die Bild-URL ist keine gültige HTTP(S)-URL.')
    }
    const response = await post(normalized, { url: normalized, kind: 'image' })
    if (!response.ok) {
      const { message, code } = await readError(response)
      const mapped = errorCodeFor(response, code)
      throw new RecipeFetchError(mapped === 'http' ? 'not-image' : mapped, message)
    }
    const declared = (response.headers.get('content-type') ?? '').split(';')[0]?.trim().toLowerCase() ?? ''
    const bytes = await response.arrayBuffer()
    if (bytes.byteLength === 0) {
      throw new RecipeFetchError('not-image', 'Das Bild ist leer.')
    }
    if (bytes.byteLength > CLIENT_IMAGE_LIMIT_BYTES) {
      throw new RecipeFetchError('too-large', 'Das Bild ist zu groß (maximal 8 MB).')
    }
    const sniffed = sniffImageMime(new Uint8Array(bytes))
    if (!sniffed || !SAFE_REMOTE_IMAGE_MIME_TYPES.has(sniffed)) {
      throw new RecipeFetchError(
        'not-image',
        'Der Inhalt ist kein unterstütztes Bildformat (JPEG, PNG, WebP, GIF, AVIF).',
      )
    }
    if (declared && !declared.startsWith('image/')) {
      throw new RecipeFetchError('not-image', 'Der Server hat kein Bild geliefert.')
    }
    const finalHeader = response.headers.get('x-final-url')
    let finalUrl = normalized
    if (finalHeader) {
      try {
        finalUrl = normalizeHttpUrl(decodeURIComponent(finalHeader)) ?? normalized
      } catch {
        finalUrl = normalized
      }
    }
    return { bytes, mimeType: sniffed, finalUrl }
  }

  return { fetchPage, fetchImage }
}

export const defaultRecipeFetcher = createRecipeFetcher()
