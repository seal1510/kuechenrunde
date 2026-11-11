/*
 * Küchenrunde – Workers-AI-Anbindung der Foto-Erkennung
 * Copyright (C) 2026 openCook Web contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Diese Datei kapselt alles, was mit dem Workers-AI-Binding (`env.AI`) und der
 * Prüfung der Foto-Eingaben zu tun hat:
 *  - Typisierung des Bindings und des Modellaufrufs,
 *  - strenge Base64-/Magic-Byte-/Größenprüfung der Seiten,
 *  - Aufbau der multimodalen Nachricht an das Modell,
 *  - robuste Extraktion von Antworttext und Token-Verbrauch,
 *  - reine, testbare Klassifikation der Workers-AI-Fehler.
 *
 * Bewusst keine Node-APIs, keine Netzwerkaufrufe und kein Logging: Bilder und
 * Rezeptinhalte werden weder gespeichert noch protokolliert. Der Modelltext
 * wird nie ungeprüft weitergegeben; die Validierung liegt im gemeinsamen
 * Vertrag `src/import/photo-ocr.ts`.
 */

import {
  OCR_SYSTEM_PROMPT,
  PHOTO_OCR_ALLOWED_MIME_TYPES,
  PHOTO_OCR_ERROR_MESSAGES,
  PHOTO_OCR_MAX_OUTPUT_TOKENS,
  PHOTO_OCR_MAX_PAGE_BYTES,
  PHOTO_OCR_MAX_PAGES,
  PHOTO_OCR_MAX_TOTAL_BYTES,
  PHOTO_OCR_MODEL,
  PHOTO_OCR_TEMPERATURE,
  buildOcrUserPrompt,
  type PhotoOcrErrorCode,
  type PhotoOcrMimeType,
  type PhotoOcrPage,
  type PhotoOcrUsage,
} from '../../src/import/photo-ocr'
import { sniffImageMime } from '../../src/import/image-mime'
import { HttpError } from './http'

/** Binding aus `wrangler.toml` (`[ai] binding = "AI"`). */
export interface AiBinding {
  run(model: string, input: unknown, options?: PhotoAiRunOptions): Promise<unknown>
}

export interface PhotoAiRunOptions {
  /** Optionaler Abbruch durch die Plattform; der Aufruf bleibt sonst synchron. */
  signal?: AbortSignal
}

/**
 * Ergebnis der Seitenprüfung: nur MIME und das bereits geprüfte Base64 werden
 * weitergereicht. Die decodierten Bytes bleiben lokal und werden nicht
 * gespeichert.
 */
export type ValidatedPhotoPage = PhotoOcrPage

export interface PhotoOcrTextPart {
  type: 'text'
  text: string
}

export interface PhotoOcrImagePart {
  type: 'image_url'
  image_url: { url: string }
}

export type PhotoOcrUserPart = PhotoOcrTextPart | PhotoOcrImagePart

export interface PhotoOcrChatMessage {
  role: 'system' | 'user'
  content: string | PhotoOcrUserPart[]
}

export interface PhotoOcrModelInput {
  messages: PhotoOcrChatMessage[]
  temperature: number
  max_tokens: number
}


const ALLOWED_MIME_TYPES: readonly string[] = PHOTO_OCR_ALLOWED_MIME_TYPES

const BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/

/**
 * Strenge Standard-Base64-Prüfung (mit Padding). Browser liefern
 * `FileReader.readAsDataURL`-Ergebnisse, die immer gepolstert sind; alles
 * andere wird abgelehnt statt stillschweigend „repariert“.
 */
export function decodeBase64Strict(value: unknown): Uint8Array | null {
  if (typeof value !== 'string') return null
  if (value.length === 0 || value.length % 4 !== 0) return null
  if (!BASE64_PATTERN.test(value)) return null

  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0
  let binary: string
  try {
    binary = atob(value)
  } catch {
    return null
  }
  if (binary.length !== (value.length / 4) * 3 - padding) return null

  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}

function invalidRequest(message: string): HttpError {
  return new HttpError(400, 'invalid-request', message)
}

function tooLarge(): HttpError {
  return new HttpError(413, 'too-large', PHOTO_OCR_ERROR_MESSAGES['too-large'])
}

function unsupportedImage(message: string): HttpError {
  return new HttpError(415, 'unsupported-image', message)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

interface ParsedPhotoPage {
  mimeType: PhotoOcrMimeType
  dataBase64: string
  decodedBytes: number
}

function parsePhotoPage(value: unknown, index: number): ParsedPhotoPage {
  if (!isRecord(value)) {
    throw invalidRequest(`Seite ${index + 1} ist keine gültige Seitenangabe.`)
  }

  const rawMime = typeof value.mimeType === 'string' ? value.mimeType.trim().toLowerCase() : ''
  if (!ALLOWED_MIME_TYPES.includes(rawMime)) {
    throw unsupportedImage(PHOTO_OCR_ERROR_MESSAGES['unsupported-image'])
  }
  const mimeType = rawMime as PhotoOcrMimeType

  const dataBase64 = typeof value.dataBase64 === 'string' ? value.dataBase64 : ''
  const bytes = decodeBase64Strict(dataBase64)
  if (!bytes || bytes.byteLength === 0) {
    throw unsupportedImage(
      `Seite ${index + 1} enthält keine gültigen Bilddaten (Base64 erwartet).`,
    )
  }
  if (bytes.byteLength > PHOTO_OCR_MAX_PAGE_BYTES) {
    throw tooLarge()
  }

  // Der deklarierte MIME muss zu den tatsächlichen Magic Bytes passen. Damit
  // kann ein Aufrufer keine beliebigen Daten als Bild „deklarieren“.
  const detected = sniffImageMime(bytes)
  if (detected !== mimeType) {
    throw unsupportedImage(
      `Seite ${index + 1} ist keine Bilddatei des angegebenen Formats (JPEG, PNG oder WebP).`,
    )
  }

  return { mimeType, dataBase64, decodedBytes: bytes.byteLength }
}

/**
 * Validiert 1..PHOTO_OCR_MAX_PAGES Seiten: MIME-Allowlist, striktes Base64,
 * decodierte Einzel- und Gesamtgröße sowie Magic Bytes. Wirft `HttpError` mit
 * den Vertrags-Codes `invalid-request` (400), `too-large` (413) und
 * `unsupported-image` (415).
 */
export function validatePhotoPages(value: unknown): ValidatedPhotoPage[] {
  if (!Array.isArray(value)) {
    throw invalidRequest('Es wurden keine Fotos übermittelt.')
  }
  if (value.length < 1) {
    throw invalidRequest('Bitte mindestens ein Foto übermitteln.')
  }
  if (value.length > PHOTO_OCR_MAX_PAGES) {
    throw invalidRequest(`Es sind höchstens ${PHOTO_OCR_MAX_PAGES} Seiten pro Erkennung erlaubt.`)
  }

  const pages: ValidatedPhotoPage[] = []
  let totalBytes = 0
  for (let index = 0; index < value.length; index += 1) {
    const page = parsePhotoPage(value[index], index)
    totalBytes += page.decodedBytes
    if (totalBytes > PHOTO_OCR_MAX_TOTAL_BYTES) throw tooLarge()
    pages.push({ mimeType: page.mimeType, dataBase64: page.dataBase64 })
  }
  return pages
}

/** Baut die multimodale Nachricht: System-Prompt, Begleittext, dann die Bilder. */
export function buildPhotoOcrMessages(pages: readonly ValidatedPhotoPage[]): PhotoOcrChatMessage[] {
  return [
    { role: 'system', content: OCR_SYSTEM_PROMPT },
    {
      role: 'user',
      content: [
        { type: 'text', text: buildOcrUserPrompt(pages.length) },
        ...pages.map(
          (page): PhotoOcrImagePart => ({
            type: 'image_url',
            image_url: { url: `data:${page.mimeType};base64,${page.dataBase64}` },
          }),
        ),
      ],
    },
  ]
}

/** Modell-Eingabe; als eigene Funktion exportiert, damit sie testbar ist. */
export function buildPhotoOcrInput(pages: readonly ValidatedPhotoPage[]): PhotoOcrModelInput {
  return {
    messages: buildPhotoOcrMessages(pages),
    temperature: PHOTO_OCR_TEMPERATURE,
    max_tokens: PHOTO_OCR_MAX_OUTPUT_TOKENS,
  }
}

/** Ruft genau ein Modell ohne Fallback auf. Fehler werden vom Aufrufer klassifiziert. */
export async function runPhotoOcr(
  ai: AiBinding,
  pages: readonly ValidatedPhotoPage[],
): Promise<unknown> {
  return ai.run(PHOTO_OCR_MODEL, buildPhotoOcrInput(pages))
}

/* ------------------------------------------------------------------ *
 * Antwort-Extraktion
 * ------------------------------------------------------------------ */

/** String, OpenAI-ähnliche content-Arrays oder Text-Objekte zu Text machen. */
function textFromContent(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  const parts: string[] = []
  for (const part of content) {
    if (typeof part === 'string') {
      parts.push(part)
      continue
    }
    if (isRecord(part) && typeof part.text === 'string') {
      parts.push(part.text)
    }
  }
  return parts.join('')
}

/**
 * Extrahiert den Modelltext robust aus den Formen, die Workers AI bzw.
 * OpenAI-kompatible Gateways liefern. Der Text ist weiterhin ungeprüfter
 * Freitext; die JSON-Validierung erfolgt anschließend im Vertrag.
 */
export function extractModelText(value: unknown, depth = 0): string {
  if (typeof value === 'string') return value
  if (!isRecord(value) || depth > 3) return ''

  const response = value.response
  if (typeof response === 'string') return response
  // Manche Bindings liefern bereits ein Objekt; dessen JSON wird erneut
  // durch die Vertrags-Extraktion geparst.
  if (isRecord(response)) return JSON.stringify(response)

  if (value.result !== undefined) {
    const nested = extractModelText(value.result, depth + 1)
    if (nested) return nested
  }

  const choices = value.choices
  if (Array.isArray(choices) && choices.length > 0) {
    const first = choices[0]
    if (isRecord(first)) {
      const message = first.message
      if (isRecord(message)) {
        const content = textFromContent(message.content)
        if (content) return content
      }
      const text = textFromContent(first.text)
      if (text) return text
    }
  }

  const outputText = value.output_text
  if (typeof outputText === 'string' && outputText) return outputText

  const direct = textFromContent(value.text)
  if (direct) return direct
  const content = textFromContent(value.content)
  if (content) return content
  return ''
}

function readTokenCount(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    return Math.trunc(value)
  }
  return null
}

function readUsage(usage: unknown): PhotoOcrUsage {
  const empty: PhotoOcrUsage = { promptTokens: null, completionTokens: null }
  if (!isRecord(usage)) return empty
  return {
    promptTokens: readTokenCount(usage.prompt_tokens ?? usage.promptTokens),
    completionTokens: readTokenCount(usage.completion_tokens ?? usage.completionTokens),
  }
}

/**
 * Token-Verbrauch aus der Modellantwort. Fehlt er, bleiben beide Werte null;
 * es werden keine Werte geschätzt.
 */
export function extractPhotoAiUsage(value: unknown): PhotoOcrUsage {
  if (!isRecord(value)) return { promptTokens: null, completionTokens: null }
  const direct = value.usage
  if (isRecord(direct)) return readUsage(direct)
  if (isRecord(value.result) && isRecord(value.result.usage)) return readUsage(value.result.usage)
  if (isRecord(value.meta) && isRecord(value.meta.usage)) return readUsage(value.meta.usage)
  return { promptTokens: null, completionTokens: null }
}

/* ------------------------------------------------------------------ *
 * Workers-AI-Fehlerklassifikation
 * ------------------------------------------------------------------ */

export interface PhotoAiFailure {
  status: 413 | 429 | 502 | 503 | 504
  code: PhotoOcrErrorCode
  message: string
}

/** Verständliche Meldung, wenn das AI-Binding im Deployment fehlt. */
export const PHOTO_AI_MISSING_BINDING_MESSAGE =
  'Die Foto-Erkennung ist auf diesem Deployment nicht aktiviert.'

const MODEL_AGREEMENT_MESSAGE =
  'Die Foto-Erkennung ist auf diesem Deployment nicht eingerichtet. Die Modellbedingungen des Workers-AI-Modells müssen im Cloudflare-Dashboard akzeptiert werden.'

const PAID_PLAN_MESSAGE =
  'Die Foto-Erkennung erfordert in diesem Deployment einen kostenpflichtigen Workers-Tarif. Es erfolgt bewusst kein Tarifwechsel; die Erkennung bleibt deaktiviert.'

interface ErrorFacts {
  text: string
  codes: Set<number>
}

/**
 * Sammelt Text und numerische Codes aus einem beliebig geformten Fehler
 * (Error, String, Objekt, verschachtelte cause/error-Felder) – ohne den
 * Fehler zu loggen oder Inhalte nach außen zu geben.
 */
function collectErrorFacts(error: unknown): ErrorFacts {
  const parts: string[] = []
  const codes = new Set<number>()
  const seen = new Set<object>()

  const visit = (value: unknown, depth: number): void => {
    if (depth > 4 || value === null || value === undefined) return
    if (typeof value === 'string') {
      if (value.length <= 4_000) parts.push(value)
      return
    }
    if (typeof value === 'number') {
      if (Number.isInteger(value)) codes.add(value)
      return
    }
    if (typeof value !== 'object') return
    if (seen.has(value)) return
    seen.add(value)
    if (value instanceof Error) {
      parts.push(value.name, value.message)
    }
    if (Array.isArray(value)) {
      for (const entry of value.slice(0, 20)) visit(entry, depth + 1)
      return
    }
    const record = value as Record<string, unknown>
    for (const key of [
      'code',
      'status',
      'statusCode',
      'message',
      'name',
      'error',
      'errors',
      'cause',
      'response',
    ]) {
      if (Object.prototype.hasOwnProperty.call(record, key)) {
        visit(record[key], depth + 1)
      }
    }
  }

  visit(error, 0)
  const text = parts.join('\n')
  // Fehlercodes stehen bei Workers AI oft nur im Meldungstext ("AiError: 3036: …").
  for (const match of text.matchAll(/\b\d{3,5}\b/g)) {
    codes.add(Number(match[0]))
  }
  return { text, codes }
}

function failure(
  status: PhotoAiFailure['status'],
  code: PhotoOcrErrorCode,
  message: string,
): PhotoAiFailure {
  return { status, code, message }
}

/**
 * Reine Klassifikation der Workers-AI-Fehler in HTTP-Status und Vertrags-Code.
 * Unbekannte Fehler werden zu 502 `upstream` – nie zu einer internen Meldung,
 * die Rückschlüsse auf Modell oder Daten zuließe.
 */
export function classifyPhotoAiError(error: unknown): PhotoAiFailure {
  const { text, codes } = collectErrorFacts(error)
  const haystack = text.toLowerCase()

  if (
    codes.has(3036) ||
    /daily free allocation|10[.,]?000 neurons/.test(haystack)
  ) {
    return failure(429, 'quota-exhausted', PHOTO_OCR_ERROR_MESSAGES['quota-exhausted'])
  }
  if (codes.has(3040) || haystack.includes('capacity temporarily exceeded')) {
    return failure(503, 'busy', PHOTO_OCR_ERROR_MESSAGES.busy)
  }
  if (codes.has(3006) || haystack.includes('request too large')) {
    return failure(413, 'too-large', PHOTO_OCR_ERROR_MESSAGES['too-large'])
  }
  if (
    codes.has(3007) ||
    codes.has(3008) ||
    /timeout|timed[ -]?out|abort/.test(haystack)
  ) {
    return failure(504, 'timeout', PHOTO_OCR_ERROR_MESSAGES.timeout)
  }
  if (codes.has(5016) || haystack.includes('model agreement')) {
    return failure(503, 'not-configured', MODEL_AGREEMENT_MESSAGE)
  }
  if (codes.has(5035) || haystack.includes('workers paid')) {
    return failure(503, 'not-configured', PAID_PLAN_MESSAGE)
  }
  if (codes.has(5007) || codes.has(3042) || codes.has(5018) || codes.has(3041)) {
    return failure(503, 'not-configured', PHOTO_OCR_ERROR_MESSAGES['not-configured'])
  }
  return failure(502, 'upstream', PHOTO_OCR_ERROR_MESSAGES.upstream)
}
