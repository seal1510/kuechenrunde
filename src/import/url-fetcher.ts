/*
 * openCook Web
 * Copyright (C) 2026 openCook Web contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Client side of the URL import. This is a thin interface to a same-origin
 * backend endpoint. It never fetches third-party pages directly (CORS would make
 * that unreliable and unsafe), sends no cookies or credentials, and validates
 * every URL again before sending it.
 *
 * The endpoint is intentionally replaceable via VITE_RECIPE_FETCH_ENDPOINT so a
 * later, separately secured deployment can be used without changing the UI.
 */

import { SAFE_REMOTE_IMAGE_MIME_TYPES, sniffImageMime } from './image-mime'
import { normalizeHttpUrl } from './url'

export const DEFAULT_RECIPE_FETCH_ENDPOINT = '/api/recipe-fetch'
export const CLIENT_HTML_LIMIT_BYTES = 6 * 1024 * 1024
export const CLIENT_IMAGE_LIMIT_BYTES = 8 * 1024 * 1024
export const CLIENT_TIMEOUT_MS = 20_000

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

export class RecipeFetchError extends Error {
  readonly code: RecipeFetchErrorCode

  constructor(code: RecipeFetchErrorCode, message: string) {
    super(message)
    this.name = 'RecipeFetchError'
    this.code = code
  }
}

export interface FetchedPage {
  html: string
  finalUrl: string
  contentType: string
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

export interface RecipeFetcherOptions {
  endpoint?: string
  fetchImpl?: typeof fetch
  timeoutMs?: number
}

function configuredEndpoint(): string {
  const env = import.meta.env as Record<string, string | undefined> | undefined
  return env?.VITE_RECIPE_FETCH_ENDPOINT?.trim() || DEFAULT_RECIPE_FETCH_ENDPOINT
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

export function createRecipeFetcher(options: RecipeFetcherOptions = {}): RecipeUrlFetcher {
  const endpoint = (options.endpoint ?? configuredEndpoint()).replace(/\/+$/, '')
  const timeoutMs = options.timeoutMs ?? CLIENT_TIMEOUT_MS
  const fetchImpl = options.fetchImpl ?? globalThis.fetch?.bind(globalThis)

  async function post(url: string, body: Record<string, unknown>): Promise<Response> {
    if (!fetchImpl) {
      throw new RecipeFetchError(
        'unavailable',
        'Der lokale Abrufdienst ist nicht verfügbar (kein fetch im Browser).',
      )
    }
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      return await fetchImpl(endpoint, {
        method: 'POST',
        // No cookies, no HTTP auth, no cache, no automatic redirects.
        credentials: 'omit',
        cache: 'no-store',
        redirect: 'error',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      })
    } catch (error) {
      if ((error as Error).name === 'AbortError') {
        throw new RecipeFetchError('timeout', 'Der Abruf hat zu lange gedauert.')
      }
      throw new RecipeFetchError(
        'network',
        'Der lokale Abrufdienst ist nicht erreichbar. Läuft der Entwicklungsserver?',
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
          'Der lokale Abrufdienst ist nicht verfügbar. In der Entwicklung startet er mit dem Vite-Server; für den Produktivbetrieb ist ein abgesichertes Backend erforderlich.',
        )
      }
      throw new RecipeFetchError(
        code === 'timeout' ? 'timeout' : code === 'too-large' ? 'too-large' : code === 'not-html' ? 'not-html' : 'http',
        message,
      )
    }

    let data: unknown
    try {
      data = await response.json()
    } catch {
      throw new RecipeFetchError(
        'unavailable',
        'Der Abrufdienst antwortet nicht im erwarteten Format. Ist der lokale Importdienst aktiv?',
      )
    }
    if (!isRecord(data) || typeof data.html !== 'string') {
      throw new RecipeFetchError('invalid-response', 'Der Abrufdienst hat keine HTML-Seite geliefert.')
    }
    const finalUrl = normalizeHttpUrl(typeof data.finalUrl === 'string' ? data.finalUrl : normalized)
    if (!finalUrl) {
      throw new RecipeFetchError('invalid-response', 'Der Abrufdienst hat eine ungültige Ziel-URL geliefert.')
    }
    if (data.html.length > CLIENT_HTML_LIMIT_BYTES) {
      throw new RecipeFetchError('too-large', 'Die Seite ist zu groß für den Import.')
    }
    return {
      html: data.html,
      finalUrl,
      contentType: typeof data.contentType === 'string' ? data.contentType : 'text/html',
    }
  }

  async function fetchImage(rawUrl: string): Promise<FetchedImage> {
    const normalized = normalizeHttpUrl(rawUrl)
    if (!normalized) {
      throw new RecipeFetchError('invalid-url', 'Die Bild-URL ist keine gültige HTTP(S)-URL.')
    }
    const response = await post(normalized, { url: normalized, kind: 'image' })
    if (!response.ok) {
      const { message } = await readError(response)
      throw new RecipeFetchError('not-image', message)
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
