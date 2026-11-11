/*
 * Küchenrunde – Client für die Foto-Erkennung
 * Copyright (C) 2026 openCook Web contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Ruft ausschließlich den eigenen, same-origin Endpunkt `/api/recipe-ocr` auf.
 * Der Supabase-Access-Token geht nur an diesen Endpunkt; der Browser spricht
 * niemals direkt mit Cloudflare Workers AI. Jede Antwort wird defensiv gegen
 * den gemeinsamen Vertrag aus `photo-ocr.ts` geprüft.
 */

import { base64ByteLength } from './photo-image'
import {
  OcrFormatError,
  applyOcrConsistencyChecks,
  PHOTO_OCR_CLIENT_TIMEOUT_MS,
  PHOTO_OCR_CONTRACT_VERSION,
  PHOTO_OCR_ERROR_MESSAGES,
  PHOTO_OCR_MAX_PAGES,
  PHOTO_OCR_MAX_PAGE_BYTES,
  PHOTO_OCR_MAX_REQUEST_BYTES,
  PHOTO_OCR_MAX_TOTAL_BYTES,
  PHOTO_OCR_MODEL,
  validateOcrPageReports,
  validateOcrRecipe,
  type OcrPageReport,
  type OcrRecipe,
  type PhotoOcrErrorCode,
  type PhotoOcrPage,
  type PhotoOcrUsage,
} from './photo-ocr'

export const PHOTO_OCR_ENDPOINT = '/api/recipe-ocr'

/** Fehler mit einem Code aus dem gemeinsamen Vertrag und deutscher Meldung. */
export class PhotoOcrRequestError extends Error {
  readonly code: PhotoOcrErrorCode

  constructor(code: PhotoOcrErrorCode, message?: string) {
    super(message?.trim() || PHOTO_OCR_ERROR_MESSAGES[code])
    this.name = 'PhotoOcrRequestError'
    this.code = code
  }
}

/** Der Nutzer hat die laufende Erkennung selbst abgebrochen. */
export class PhotoOcrAbortedError extends Error {
  constructor(message = 'Die Erkennung wurde abgebrochen.') {
    super(message)
    this.name = 'PhotoOcrAbortedError'
  }
}

export function isPhotoOcrAbort(cause: unknown): cause is PhotoOcrAbortedError {
  return cause instanceof PhotoOcrAbortedError
}

export function photoOcrErrorMessage(code: PhotoOcrErrorCode): string {
  return PHOTO_OCR_ERROR_MESSAGES[code] ?? PHOTO_OCR_ERROR_MESSAGES.internal
}

/** Request-Body, den die Pages Function liest. */
export interface PhotoOcrRequest {
  pages: PhotoOcrPage[]
}

export interface PhotoOcrResult {
  model: string
  recipe: OcrRecipe
  pages: OcrPageReport[]
  usage: PhotoOcrUsage
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength
}

/**
 * Prüft Seiten vor dem Senden: Anzahl, MIME-Typ, gepolstertes Standard-Base64
 * und die Größenlimits des Vertrags. Fehler werden bereits hier verständlich
 * gemeldet, damit kein unnötiger Netzwerkaufruf entsteht.
 */
export function validatePhotoOcrPages(pages: readonly PhotoOcrPage[]): void {
  if (pages.length < 1) {
    throw new PhotoOcrRequestError(
      'invalid-request',
      'Bitte mindestens eine Seite auswählen, bevor die Erkennung startet.',
    )
  }
  if (pages.length > PHOTO_OCR_MAX_PAGES) {
    throw new PhotoOcrRequestError(
      'too-large',
      `Es sind höchstens ${PHOTO_OCR_MAX_PAGES} Seiten pro Erkennung möglich.`,
    )
  }
  let total = 0
  for (const page of pages) {
    if (!page || typeof page !== 'object') {
      throw new PhotoOcrRequestError('invalid-request', 'Eine Seite ist unvollständig.')
    }
    if (page.mimeType !== 'image/jpeg' && page.mimeType !== 'image/png' && page.mimeType !== 'image/webp') {
      throw new PhotoOcrRequestError(
        'unsupported-image',
        'Mindestens eine Seite hat kein unterstütztes Bildformat (JPEG, PNG oder WebP).',
      )
    }
    const base64 = typeof page.dataBase64 === 'string' ? page.dataBase64.trim() : ''
    if (!base64 || base64.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) {
      throw new PhotoOcrRequestError(
        'invalid-request',
        'Mindestens eine Seite hat keine gültigen Bilddaten.',
      )
    }
    const length = base64ByteLength(base64)
    if (length <= 0) {
      throw new PhotoOcrRequestError(
        'invalid-request',
        'Mindestens eine Seite hat keine gültigen Bilddaten.',
      )
    }
    if (length > PHOTO_OCR_MAX_PAGE_BYTES) {
      throw new PhotoOcrRequestError('too-large')
    }
    total += length
  }
  if (total > PHOTO_OCR_MAX_TOTAL_BYTES) {
    throw new PhotoOcrRequestError('too-large')
  }
}

/** Baut den JSON-Body. Der Prompt wird serverseitig aus dem Vertrag erzeugt. */
export function buildPhotoOcrRequest(pages: readonly PhotoOcrPage[]): PhotoOcrRequest {
  validatePhotoOcrPages(pages)
  const request: PhotoOcrRequest = {
    pages: pages.map((page) => ({
      mimeType: page.mimeType,
      dataBase64: page.dataBase64,
      ...(page.width !== undefined ? { width: page.width } : {}),
      ...(page.height !== undefined ? { height: page.height } : {}),
    })),
  }
  if (byteLength(JSON.stringify(request)) > PHOTO_OCR_MAX_REQUEST_BYTES) {
    throw new PhotoOcrRequestError('too-large')
  }
  return request
}

function readUsage(value: unknown): PhotoOcrUsage {
  if (!isRecord(value)) return { promptTokens: null, completionTokens: null }
  const number = (entry: unknown): number | null =>
    typeof entry === 'number' && Number.isFinite(entry) && entry >= 0
      ? Math.round(entry)
      : null
  return {
    promptTokens: number(value.promptTokens),
    completionTokens: number(value.completionTokens),
  }
}

function readErrorCode(value: unknown): PhotoOcrErrorCode {
  if (typeof value === 'string' && value in PHOTO_OCR_ERROR_MESSAGES) {
    return value as PhotoOcrErrorCode
  }
  return 'internal'
}

/**
 * Parsed eine Antwort defensiv. `ok:false` wird als typisierter Fehler
 * gemeldet; Erfolgsantworten laufen durch die strikte Validierung des
 * gemeinsamen Vertrags. Modell-Rohdaten werden nie an den Editor gereicht.
 */
export function parsePhotoOcrResponse(value: unknown, pageCount: number): PhotoOcrResult {
  if (!isRecord(value)) {
    throw new PhotoOcrRequestError(
      'invalid-ai-response',
      'Der Erkennungsdienst hat keine gültige Antwort geliefert.',
    )
  }
  if (value.ok === false) {
    const code = readErrorCode(value.code)
    const message = typeof value.error === 'string' ? value.error : undefined
    throw new PhotoOcrRequestError(code, message)
  }
  if (value.ok !== true) {
    throw new PhotoOcrRequestError(
      'invalid-ai-response',
      'Der Erkennungsdienst hat keine gültige Antwort geliefert.',
    )
  }
  if (value.contractVersion !== PHOTO_OCR_CONTRACT_VERSION) {
    throw new PhotoOcrRequestError(
      'invalid-ai-response',
      'Der Erkennungsdienst verwendet eine unbekannte Vertragsversion. Bitte die App aktualisieren.',
    )
  }
  try {
    return {
      model:
        typeof value.model === 'string' && value.model.trim()
          ? value.model.trim()
          : PHOTO_OCR_MODEL,
      recipe: applyOcrConsistencyChecks(validateOcrRecipe(value.recipe)),
      pages: validateOcrPageReports(value.pages, pageCount),
      usage: readUsage(value.usage),
    }
  } catch (cause) {
    if (cause instanceof OcrFormatError) {
      throw new PhotoOcrRequestError('invalid-ai-response')
    }
    throw new PhotoOcrRequestError(
      'invalid-ai-response',
      'Der Erkennungsdienst hat keine gültige Antwort geliefert.',
    )
  }
}

/** In Cloud-Modus darf der Token nur an einen same-origin Endpunkt gehen. */
export function isSameOriginPhotoOcrEndpoint(endpoint: string): boolean {
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

function httpStatusError(status: number): PhotoOcrRequestError {
  if (status === 401) return new PhotoOcrRequestError('unauthorized')
  if (status === 403) return new PhotoOcrRequestError('not-a-member')
  if (status === 413) return new PhotoOcrRequestError('too-large')
  if (status === 415) {
    return new PhotoOcrRequestError('unsupported-image')
  }
  if (status === 429) return new PhotoOcrRequestError('rate-limited')
  if (status === 504) return new PhotoOcrRequestError('timeout')
  if (status === 503) return new PhotoOcrRequestError('busy')
  if (status === 502) return new PhotoOcrRequestError('upstream')
  if (status >= 500) return new PhotoOcrRequestError('internal')
  return new PhotoOcrRequestError('internal', `Unerwarteter Fehler (HTTP ${status}).`)
}

async function readErrorBody(response: Response): Promise<PhotoOcrRequestError> {
  try {
    const data = (await response.json()) as unknown
    if (isRecord(data) && data.ok === false) {
      return new PhotoOcrRequestError(
        readErrorCode(data.code),
        typeof data.error === 'string' ? data.error : undefined,
      )
    }
  } catch {
    // Kein JSON: der HTTP-Status entscheidet.
  }
  return httpStatusError(response.status)
}

export interface RequestPhotoOcrOptions {
  endpoint?: string
  fetchImpl?: typeof fetch
  /** Liefert den Supabase-Access-Token; fehlt er, wird nicht gesendet. */
  getAccessToken?: () => Promise<string | null>
  timeoutMs?: number
  /** Abbruch durch „Abbrechen“ in der Oberfläche. */
  signal?: AbortSignal
}

/**
 * POST an den eigenen Erkennungsendpunkt. Timeout und Nutzerabbruch sind
 * getrennt: ein Timeout meldet einen verständlichen Fehler, ein bewusster
 * Abbruch wird von der Oberfläche still behandelt.
 */
export async function requestPhotoOcr(
  pages: readonly PhotoOcrPage[],
  options: RequestPhotoOcrOptions = {},
): Promise<PhotoOcrResult> {
  const endpoint = (options.endpoint ?? PHOTO_OCR_ENDPOINT).trim()
  if (!endpoint) {
    throw new PhotoOcrRequestError('not-configured', 'Der Erkennungsendpunkt fehlt.')
  }
  if (!isSameOriginPhotoOcrEndpoint(endpoint)) {
    throw new PhotoOcrRequestError(
      'not-configured',
      'Der Erkennungsendpunkt muss same-origin sein.',
    )
  }
  const fetchImpl = options.fetchImpl ?? globalThis.fetch?.bind(globalThis)
  if (!fetchImpl) {
    throw new PhotoOcrRequestError(
      'upstream',
      'Die Foto-Erkennung ist in diesem Browser nicht verfügbar.',
    )
  }

  const request = buildPhotoOcrRequest(pages)

  let token: string | null = null
  if (options.getAccessToken) {
    try {
      token = await options.getAccessToken()
    } catch {
      throw new PhotoOcrRequestError(
        'unauthorized',
        'Die Anmeldung konnte nicht geprüft werden. Bitte erneut anmelden.',
      )
    }
    if (!token) {
      throw new PhotoOcrRequestError(
        'unauthorized',
        'Die Anmeldung ist abgelaufen. Bitte erneut anmelden und die Erkennung wiederholen.',
      )
    }
  }

  const controller = new AbortController()
  let timedOut = false
  let externallyAborted = false
  const timeout = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, options.timeoutMs ?? PHOTO_OCR_CLIENT_TIMEOUT_MS)

  const handleExternalAbort = () => {
    externallyAborted = true
    controller.abort()
  }
  if (options.signal) {
    if (options.signal.aborted) {
      clearTimeout(timeout)
      throw new PhotoOcrAbortedError()
    }
    options.signal.addEventListener('abort', handleExternalAbort, { once: true })
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  }
  // Nur der eigene Endpunkt bekommt den Token; keine Cookies, kein Cache.
  if (token) headers.Authorization = `Bearer ${token}`

  try {
    const response = await fetchImpl(endpoint, {
      method: 'POST',
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'error',
      headers,
      body: JSON.stringify(request),
      signal: controller.signal,
    })

    if (!response.ok) {
      throw await readErrorBody(response)
    }

    let data: unknown
    try {
      data = await response.json()
    } catch {
      throw new PhotoOcrRequestError(
        'invalid-ai-response',
        'Der Erkennungsdienst hat keine lesbare Antwort geliefert.',
      )
    }
    return parsePhotoOcrResponse(data, pages.length)
  } catch (cause) {
    if (externallyAborted) throw new PhotoOcrAbortedError()
    if (timedOut) throw new PhotoOcrRequestError('timeout')
    if (cause instanceof PhotoOcrRequestError || cause instanceof PhotoOcrAbortedError) {
      throw cause
    }
    if ((cause as Error)?.name === 'AbortError') {
      throw new PhotoOcrRequestError('timeout')
    }
    throw new PhotoOcrRequestError(
      'upstream',
      'Der Erkennungsdienst ist nicht erreichbar. Bitte die Verbindung prüfen.',
    )
  } finally {
    clearTimeout(timeout)
    options.signal?.removeEventListener('abort', handleExternalAbort)
  }
}
