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
  applyOcrLanguageCorrections,
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
import { catalogSpellingLabels } from '../../src/domain/ingredientSpelling'
import {
  clientKey,
  errorResponse,
  HttpError,
  isSameOrigin,
  jsonResponse,
} from '../lib/http'
import {
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
      // Deterministische Sprachkorrektur vor der Aufbereitung: Der
      // Zutatenkatalog liefert etablierte Schreibweisen. Damit sieht das
      // Textmodell bereits die korrigierte Zutatenliste und die korrigierte
      // Transkription; offensichtliche OCR-Schreibfehler müssen nicht vom
      // Modell erraten werden.
      const spellingLabels = catalogSpellingLabels()
      const language = applyOcrLanguageCorrections(recipe, transcription, spellingLabels)
      recipe = language.recipe
      const assemblyTranscription = language.transcription
      // Zweiter, text-only Aufruf: aus Transkription + validierter
      // Zutatenliste verständliche Schritte bauen. Die Aufbereitung ist
      // verpflichtend: Fällt sie aus, wird NICHT die rohe Erkennung als
      // erfolgreich ausgegeben (sie kann unbrauchbar sein), sondern ein
      // klarer Fehler zurückgegeben. Die Fotos bleiben im Editor erhalten,
      // sodass ohne erneute Fotoauswahl neu gestartet werden kann.
      if (recipe.recognized && recipe.ingredients.length > 0 && assemblyTranscription.trim()) {
        try {
          const assembled = await runPhotoOcrAssembly(ai, recipe, assemblyTranscription)
          if (isTruncatedModelResponse(assembled)) {
            console.warn('[photo-ocr] assembly failed: truncated')
            return errorResponse(
              502,
              'assembly-failed',
              PHOTO_OCR_ERROR_MESSAGES['assembly-failed'],
            )
          }
          const polished = validateOcrPolish(
            recipe,
            extractJsonObject(extractModelText(assembled)),
            assemblyTranscription,
          )
          // Die Nutzung ist auch bei einer verworfenen Antwort angefallen.
          usage = mergePhotoOcrUsage(usage, extractPhotoAiUsage(assembled))
          if (!isPlausibleOcrAssemblySteps(polished.recipe.steps, recipe)) {
            console.warn('[photo-ocr] assembly failed: implausible')
            return errorResponse(
              502,
              'assembly-failed',
              PHOTO_OCR_ERROR_MESSAGES['assembly-failed'],
            )
          }
          // Zweite Korrektur nach dem Modell: Das Modell darf keine falsche
          // Schreibweise erneut einführen; zudem werden Schreibfehler in den
          // Schritttexten an die bereinigten Zutatennamen angeglichen.
          recipe = applyOcrLanguageCorrections(
            polished.recipe,
            assemblyTranscription,
            spellingLabels,
          ).recipe
          if (polished.rejectedNames > 0 || polished.rejectedGroups > 0) {
            addPolishWarning(recipe)
          }
        } catch (error) {
          const failure = classifyPhotoAiError(error)
          // Nur technisch eindeutige Ursachen durchreichen; Format- und
          // Plausibilitätsfehler erscheinen als assembly-failed.
          console.warn(`[photo-ocr] assembly failed: ${failure.code}`)
          if (
            failure.code === 'quota-exhausted' ||
            failure.code === 'busy' ||
            failure.code === 'timeout'
          ) {
            return errorResponse(failure.status, failure.code, failure.message)
          }
          return errorResponse(
            502,
            'assembly-failed',
            PHOTO_OCR_ERROR_MESSAGES['assembly-failed'],
          )
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

/** Cloudflare Pages entry point. Only the `/api/recipe-ocr` route invokes it. */
export const onRequest = (context: PagesContext<Env>): Promise<Response> =>
  handleRecipeOcr(context.request, context.env)
