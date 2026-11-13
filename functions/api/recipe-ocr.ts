/*
 * Küchenrunde – Cloudflare Pages Function für die Foto-Erkennung
 * Copyright (C) 2026 openCook Web contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Route: POST /api/recipe-ocr
 *
 * Ablauf:
 *  1. Nur POST, JSON, same-origin.
 *  2. Grobe IP-Rate-Limitierung, dann Supabase-Token + Haushaltsmitgliedschaft.
 *     Die Anmeldung läuft bewusst VOR dem Lesen des großen Foto-Bodys, damit
 *     unangemeldete Aufrufe niemals 12 MB verarbeiten.
 *  3. Nutzer-Rate-Limit und Prüfung des Workers-AI-Bindings (fail fast, wenn
 *     die Foto-Erkennung im Deployment nicht aktiviert ist).
 *  4. Body mit hartem 12-MiB-Limit lesen, Seiten streng prüfen
 *     (MIME, Base64, Größen, Magic Bytes).
 *  5. Erkennungsaufruf; Antworttext extrahieren und gegen den gemeinsamen
 *     Vertrag validieren. Danach ein zweiter, text-only Aufruf, der aus
 *     Transkription + Zutatenliste verständliche Zubereitungsschritte baut
 *     (Fehler dort sind nicht fatal). Strukturfehler der Erkennung werden
 *     generisch als 502 gemeldet – niemals mit Modell-Rohdaten oder
 *     Rezeptinhalt.
 *
 * Kein CORS, kein Cache, keine Logs mit Bild-/Rezeptdaten. Die Rate-Limits
 * leben isolate-lokal (kein KV/Durable Object) und sind eine Missbrauchsbremse,
 * keine globale Garantie.
 */

import {
  PHOTO_OCR_CONTRACT_VERSION,
  PHOTO_OCR_ERROR_MESSAGES,
  PHOTO_OCR_MAX_REQUEST_BYTES,
  PHOTO_OCR_MAX_WARNINGS,
  PHOTO_OCR_MODEL,
  OcrFormatError,
  applyOcrConsistencyChecks,
  extractJsonObject,
  isPlausibleOcrAssemblySteps,
  mergePhotoOcrUsage,
  validateOcrPolish,
  validateOcrPageReports,
  validateOcrRecipe,
  type PhotoOcrErrorCode,
  type PhotoOcrSuccess,
  type OcrRecipe,
} from '../../src/import/photo-ocr'
import {
  clientKey,
  errorResponse,
  HttpError,
  isSameOrigin,
  jsonResponse,
} from '../lib/http'
import {
  PHOTO_AI_ASSEMBLY_FALLBACK_MESSAGE,
  PHOTO_AI_MISSING_BINDING_MESSAGE,
  PHOTO_AI_TRUNCATED_MESSAGE,
  classifyPhotoAiError,
  extractModelText,
  extractPhotoAiUsage,
  isTruncatedModelResponse,
  runPhotoOcr,
  runPhotoOcrAssembly,
  validatePhotoPages,
  type AiBinding,
} from '../lib/photo-ai'
import { isJsonContentType, readPhotoJsonBody } from '../lib/photo-request'
import {
  authorizeHouseholdMember,
  type SupabaseEnv,
} from '../lib/supabase-auth'

export interface Env extends SupabaseEnv {
  AI?: AiBinding
}

export interface PagesContext<E> {
  request: Request
  env: E
  params: Record<string, string | string[]>
  next: () => Promise<Response>
  waitUntil: (promise: Promise<unknown>) => void
  data: Record<string, unknown>
}

export interface RecipeOcrDependencies {
  authorize?: typeof authorizeHouseholdMember
  now?: () => number
}

export const PHOTO_OCR_RATE_LIMITS = {
  perIpPerMinute: 20,
  perUserPerMinute: 8,
  windowMs: 60_000,
} as const

/** Für Dokumentation/Tests sichtbar; entspricht dem Vertrag. */
export const MAX_REQUEST_BYTES = PHOTO_OCR_MAX_REQUEST_BYTES

interface Bucket {
  count: number
  resetAt: number
}

const buckets = new Map<string, Bucket>()

export function resetPhotoOcrRateLimits(): void {
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
    buckets.set(key, { count: 1, resetAt: now + PHOTO_OCR_RATE_LIMITS.windowMs })
    return false
  }
  bucket.count += 1
  return bucket.count > limit
}

const PHOTO_ERROR_CODES: readonly PhotoOcrErrorCode[] = [
  'method-not-allowed',
  'forbidden-origin',
  'invalid-content-type',
  'invalid-request',
  'too-large',
  'unsupported-image',
  'unauthorized',
  'not-a-member',
  'rate-limited',
  'not-configured',
  'quota-exhausted',
  'busy',
  'timeout',
  'invalid-ai-response',
  'upstream',
  'internal',
]

function isPhotoOcrErrorCode(value: string): value is PhotoOcrErrorCode {
  return (PHOTO_ERROR_CODES as readonly string[]).includes(value)
}

/** Auth-Fehler bekommen die zur Foto-Erkennung passende Standardmeldung. */
function authMessage(code: PhotoOcrErrorCode, fallback: string): string {
  if (code === 'unauthorized') return PHOTO_OCR_ERROR_MESSAGES.unauthorized
  if (code === 'not-a-member') return PHOTO_OCR_ERROR_MESSAGES['not-a-member']
  return fallback || PHOTO_OCR_ERROR_MESSAGES.internal
}

function errorToResponse(error: unknown): Response {
  if (error instanceof HttpError) {
    const code = isPhotoOcrErrorCode(error.code) ? error.code : 'internal'
    return errorResponse(error.status, code, authMessage(code, error.message))
  }
  if (error instanceof OcrFormatError) {
    return errorResponse(502, 'invalid-ai-response', PHOTO_OCR_ERROR_MESSAGES['invalid-ai-response'])
  }
  return errorResponse(500, 'internal', PHOTO_OCR_ERROR_MESSAGES.internal)
}

/**
 * Main handler. Exportiert, damit der vollständige Ablauf ohne Pages-Runtime
 * und ohne Entwicklungsserver getestet werden kann.
 */
export async function handleRecipeOcr(
  request: Request,
  env: Env | undefined,
  deps: RecipeOcrDependencies = {},
): Promise<Response> {
  if (request.method !== 'POST') {
    return errorResponse(
      405,
      'method-not-allowed',
      PHOTO_OCR_ERROR_MESSAGES['method-not-allowed'],
      { Allow: 'POST' },
    )
  }
  if (!isSameOrigin(request)) {
    return errorResponse(403, 'forbidden-origin', PHOTO_OCR_ERROR_MESSAGES['forbidden-origin'])
  }
  if (!isJsonContentType(request)) {
    return errorResponse(415, 'invalid-content-type', PHOTO_OCR_ERROR_MESSAGES['invalid-content-type'])
  }

  const now = deps.now ?? Date.now
  if (rateLimited(`ip:${clientKey(request)}`, PHOTO_OCR_RATE_LIMITS.perIpPerMinute, now())) {
    return errorResponse(429, 'rate-limited', PHOTO_OCR_ERROR_MESSAGES['rate-limited'])
  }

  try {
    // Anmeldung zuerst: unangemeldete Aufrufe dürfen den 12-MB-Body nicht
    // einmal anfassen. authorizeHouseholdMember wirft HttpError 401/403/503.
    const authorize = deps.authorize ?? authorizeHouseholdMember
    const member = await authorize(request, env)
    if (rateLimited(`user:${member.id}`, PHOTO_OCR_RATE_LIMITS.perUserPerMinute, now())) {
      return errorResponse(429, 'rate-limited', PHOTO_OCR_ERROR_MESSAGES['rate-limited'])
    }

    // Fail fast: ohne AI-Binding gibt es nichts zu erkennen.
    const ai = env?.AI
    if (!ai || typeof ai.run !== 'function') {
      return errorResponse(503, 'not-configured', PHOTO_AI_MISSING_BINDING_MESSAGE)
    }

    const body = await readPhotoJsonBody(request)
    const pages = validatePhotoPages(body.pages)

    let raw: unknown
    try {
      raw = await runPhotoOcr(ai, pages)
    } catch (error) {
      // Reine Klassifikation; die Originalmeldung wird nie ausgeliefert.
      const failure = classifyPhotoAiError(error)
      return errorResponse(failure.status, failure.code, failure.message)
    }

    try {
      const text = extractModelText(raw)
      // Abgeschnittene Antworten werden nicht als generischer Formatfehler
      // gemeldet: Der Nutzer soll wissen, dass er mit weniger Seiten erneut
      // versuchen kann, statt dass die Erkennung „kaputt“ wirkt.
      if (isTruncatedModelResponse(raw)) {
        return errorResponse(502, 'invalid-ai-response', PHOTO_AI_TRUNCATED_MESSAGE)
      }
      const value = extractJsonObject(text)
      const transcription =
        isRecordValue(value) && typeof value.transcription === 'string'
          ? value.transcription
          : ''

      let recipe = validateOcrRecipe(value)
      let usage = extractPhotoAiUsage(raw)
      // Zweiter, text-only Aufruf: aus Transkription + validierter
      // Zutatenliste verständliche Schritte bauen. Schlägt er fehl, bleibt die
      // Erkennung nutzbar; die Schritte werden dann nur als unsicher markiert.
      if (recipe.recognized && recipe.ingredients.length > 0 && transcription.trim()) {
        try {
          const assembled = await runPhotoOcrAssembly(ai, recipe, transcription)
          if (isTruncatedModelResponse(assembled)) {
            addAssemblyFallbackWarning(recipe)
          } else {
            const polished = validateOcrPolish(
              recipe,
              extractJsonObject(extractModelText(assembled)),
              transcription,
            )
            // Die Nutzung ist auch bei einer verworfenen Antwort angefallen.
            usage = mergePhotoOcrUsage(usage, extractPhotoAiUsage(assembled))
            if (isPlausibleOcrAssemblySteps(polished.recipe.steps, recipe)) {
              recipe = polished.recipe
              if (polished.rejectedNames > 0 || polished.rejectedGroups > 0) {
                addPolishWarning(recipe)
              }
            } else {
              addAssemblyFallbackWarning(recipe)
            }
          }
        } catch {
          // Auch Quota-, Format- und Netzwerkfehler des zweiten Aufrufs dürfen
          // den bereits erfolgreichen Import nicht scheitern lassen.
          addAssemblyFallbackWarning(recipe)
        }
      }

      // Zusätzlich zur Schema-Validierung: doppelte Zutaten mit
      // unterschiedlichen Mengen und offensichtlich vermischte Zeilen sichtbar
      // als unklar markieren – auf den finalen Schritten.
      const checkedRecipe = applyOcrConsistencyChecks(recipe)
      // validateOcrRecipe hat den Objektcharakter bereits geprüft.
      const pageReports = validateOcrPageReports(
        (value as Record<string, unknown>).pages,
        pages.length,
      )
      const success: PhotoOcrSuccess = {
        ok: true,
        contractVersion: PHOTO_OCR_CONTRACT_VERSION,
        model: PHOTO_OCR_MODEL,
        recipe: checkedRecipe,
        pages: pageReports,
        usage,
      }
      return jsonResponse(200, success)
    } catch (error) {
      if (error instanceof OcrFormatError) {
        return errorResponse(
          502,
          'invalid-ai-response',
          PHOTO_OCR_ERROR_MESSAGES['invalid-ai-response'],
        )
      }
      throw error
    }
  } catch (error) {
    return errorToResponse(error)
  }
}

function addPolishWarning(recipe: OcrRecipe): void {
  const message =
    'Einige Zutatenbezeichnungen oder -gruppen konnten nicht sicher bereinigt werden. Bitte mit dem Foto abgleichen.'
  if (recipe.warnings.length >= PHOTO_OCR_MAX_WARNINGS) return
  if (!recipe.warnings.includes(message)) recipe.warnings.push(message)
}

function isRecordValue(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Sichtbarer, aber nicht fataler Hinweis, wenn die Schrittaufbereitung
 * fehlschlägt. Der Import bleibt mit den erkannten Schritten möglich.
 */
function addAssemblyFallbackWarning(recipe: OcrRecipe): void {
  if (recipe.warnings.length >= PHOTO_OCR_MAX_WARNINGS) return
  if (!recipe.warnings.includes(PHOTO_AI_ASSEMBLY_FALLBACK_MESSAGE)) {
    recipe.warnings.push(PHOTO_AI_ASSEMBLY_FALLBACK_MESSAGE)
  }
}

/** Cloudflare Pages entry point. Only the `/api/recipe-ocr` route invokes it. */
export const onRequest = (context: PagesContext<Env>): Promise<Response> =>
  handleRecipeOcr(context.request, context.env)
