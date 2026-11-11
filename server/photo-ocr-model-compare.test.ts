/*
 * Küchenrunde – Opt-in-Vergleichsharness für drei Workers-AI-Modelle
 * Copyright (C) 2026 openCook Web contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Vergleicht auf DEMSELBEN echten Familienrezept-Foto drei Workers-AI-Modelle:
 *
 *   1. @cf/meta/llama-4-scout-17b-16e-instruct   – bisheriger Produktionspfad (Vergleichsbasis)
 *      (Chat: messages + image_url, max_tokens, temperature 0.1)
 *   2. @cf/google/gemma-4-26b-a4b-it             – aktueller Produktionspfad (Reasoning-/Vision-Modell)
 *      (Chat wie oben; Cloudflare-Doku: max_tokens ist zugunsten von
 *      max_completion_tokens veraltet, Vision über image_url bestätigt;
 *      Antwort kann einen Reasoning-Trace enthalten → JSON robust extrahieren)
 *   3. @cf/moondream/moondream3.1-9B-A2B         – ANDERES API-FORMAT
 *      ({task:"query", image:<dataURI>, question:<prompt>, reasoning:false,
 *      max_tokens, temperature}; Antwortfeld `answer`, keine Chat-Messages;
 *      genau ein Aufruf pro Seite – hier genau eine Bilddatei = genau ein Aufruf)
 *
 * Der Harness ist ein Opt-in: Ohne Zugangsdaten (bzw. ohne Offline-Rohantworten)
 * und ohne Bild-/Ground-Truth-Datei wird die Suite über describe.skipIf
 * vollständig übersprungen – Exit 0, keine Kosten.
 *
 * ---------------------------------------------------------------------------
 * Env-Variablen
 * ---------------------------------------------------------------------------
 *   CLOUDFLARE_ACCOUNT_ID        Pflicht für Live-Lauf (nie geloggt).
 *   CLOUDFLARE_API_TOKEN         Pflicht für Live-Lauf (nie geloggt).
 *   PHOTO_OCR_COMPARE_IMAGE      Pfad zum echten Foto.
 *                                Default: fixtures-private/photo-compare/photo.jpg
 *   PHOTO_OCR_COMPARE_GT         Pfad zur Ground-Truth-JSON.
 *                                Default: fixtures-private/photo-compare/ground-truth.json
 *   PHOTO_OCR_COMPARE_OUT        Ausgabeverzeichnis für Bericht + Rohantworten.
 *                                Default: /tmp/photo-ocr-compare
 *   PHOTO_OCR_COMPARE_RAW_DIR    Optionaler Offline-Modus: wertet bereits
 *                                gespeicherte Rohantworten aus, ohne Netzwerk.
 *                                Dateiname: <rawKey>__<bild-basisname>.json
 *                                Inhalt: { "latencyMs": number, "body": <Workers-AI-Body> }
 *                                (Format analog server/photo-ocr-trial.test.ts;
 *                                ein Live-Lauf schreibt genau solche Dateien
 *                                nach $PHOTO_OCR_COMPARE_OUT/raw/.)
 *
 * Beispiel (Live, genau 3 Aufrufe):
 *   CLOUDFLARE_ACCOUNT_ID=... CLOUDFLARE_API_TOKEN=... \
 *     pnpm vitest run server/photo-ocr-model-compare.test.ts
 *
 * Beispiel (Offline, keine Kosten):
 *   PHOTO_OCR_COMPARE_RAW_DIR=/tmp/photo-ocr-compare/raw \
 *     pnpm vitest run server/photo-ocr-model-compare.test.ts
 *
 * ---------------------------------------------------------------------------
 * Ground-Truth-Schema (in fixtures-private/, wird vom Lead gepflegt)
 * ---------------------------------------------------------------------------
 *   {
 *     "title": "Beispielrezept",
 *     "ingredients": [
 *       { "group": "", "quantity": "500", "unit": "g", "name": "Mehl" }
 *     ],
 *     "steps": ["Erster Schritt …", "Zweiter Schritt …"],
 *     "notes": "Freitext oder leer",
 *     "mustNotInvent": ["Knoblauch", "Sesam"]
 *   }
 *
 *   - `group`: Zutatengruppen-Überschrift oder leer.
 *   - `quantity` / `unit`: Soll-Mengenangabe wörtlich wie im Original; leer,
 *     wenn das Original keine Angabe hat.
 *   - `steps`: Soll-Schritte, je Eintrag ein Schritt.
 *   - `mustNotInvent`: Begriffe, die in der Modellantwort NICHT vorkommen
 *     dürfen (z. B. verwechselte/erfundene Zutaten). Geprüft wird normalisiert
 *     gegen Zutatennamen, Schritttexte und Notizen.
 *
 * ---------------------------------------------------------------------------
 * Metriken pro Modell
 * ---------------------------------------------------------------------------
 *   - Titel: exakt / enthält (normalisiert).
 *   - Zutaten: Precision, Recall, gematchte Zutaten, fehlende Zutaten,
 *     falsch erkannte Zutaten (ähnlich zu einer Soll-Zutat, aber kein Match),
 *     erfundene Zutaten (mustNotInvent-Treffer oder ohne Bezug zur GT).
 *   - Menge/Einheit: Trefferquote bei gematchten Zutaten.
 *   - Schritte: Soll-/Ist-Anzahl und Anzahl Schritte mit fremdem
 *     Zutaten-/Mengenmaterial (mustNotInvent-Treffer oder fremder Zutatname).
 *   - Ist-vs-Soll je Zutat: Menge/Einheit nebeneinander.
 *   - usage (prompt/completion/total) und Neuronen-/Kostenschätzung mit den
 *     modellspezifischen Neuronen pro Million Token:
 *       llama  24.545 in / 77.273 out
 *       gemma   9.091 in / 27.273 out
 *       moondream 27.273 in / 90.909 out
 *
 * ---------------------------------------------------------------------------
 * Sicherheit / Grenzen
 * ---------------------------------------------------------------------------
 *   - Genau 1 Modellaufruf pro Modell, 180 s Timeout, keine Wiederholung.
 *   - Keine Secrets, keine Account-ID, kein API-Token und kein Bild-Base64 in
 *     Logs oder Berichten. Fehlermeldungen werden auf HTTP-Status und kurze
 *     technische Meldungen begrenzt.
 *   - Rohantworten (inkl. privater Rezepttexte) werden ausschließlich unter
 *     PHOTO_OCR_COMPARE_OUT/raw/ abgelegt, niemals im Repository.
 *   - stdout bleibt kurz: nur Status/Metriken, keine vollständigen Rezepttexte.
 *   - Fehlende Bild-/Ground-Truth-Datei → sauberer Skip mit klarer Meldung,
 *     Exit 0. Erstgar kein Modellaufruf.
 *   - Kein Commit, kein Push, kein Deploy, keine Änderung an src/functions.
 *
 * Der Prompt wird NICHT dupliziert, sondern aus dem gemeinsamen Vertrag
 * `src/import/photo-ocr.ts` importiert (OCR_SYSTEM_PROMPT, buildOcrUserPrompt,
 * extractJsonObject, validateOcrRecipe).
 */

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  OCR_SYSTEM_PROMPT,
  PHOTO_OCR_CONTRACT_VERSION,
  PHOTO_OCR_MAX_OUTPUT_TOKENS,
  PHOTO_OCR_TEMPERATURE,
  applyOcrConsistencyChecks,
  buildOcrUserPrompt,
  extractJsonObject,
  validateOcrRecipe,
  type OcrIngredient,
  type OcrRecipe,
} from '../src/import/photo-ocr'

// ===========================================================================
// Kleine Helfer
// ===========================================================================

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value
  return `${value.slice(0, maxLength)}… [${value.length - maxLength} Zeichen gekürzt]`
}

function envValue(name: string): string {
  return (process.env[name] ?? '').trim()
}

function readStringField(record: Record<string, unknown>, key: string): string {
  return typeof record[key] === 'string' ? (record[key] as string).trim() : ''
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.trunc(value)
    : null
}

// ===========================================================================
// Konfiguration (nur aus der Umgebung; keine Secrets werden geloggt)
// ===========================================================================

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const DEFAULT_IMAGE = 'fixtures-private/photo-compare/photo.jpg'
const DEFAULT_GROUND_TRUTH = 'fixtures-private/photo-compare/ground-truth.json'
const DEFAULT_OUTPUT_DIR = '/tmp/photo-ocr-compare'

const API_BASE = 'https://api.cloudflare.com/client/v4'
/** Ein Modellaufruf darf bis zu 180 s dauern; das Vitest-Timeout liegt darüber. */
const REQUEST_TIMEOUT_MS = 180_000
const MODEL_CALL_TIMEOUT_MS = REQUEST_TIMEOUT_MS + 30_000
/** Nur private Kürzung für Berichte, niemals in stdout. */
const MAX_RAW_PREVIEW_CHARS = 400
/** Free-Tier-Tagesbudget der Workers AI (nur für die Einordnung). */
const FREE_DAILY_NEURON_BUDGET = 10_000

function resolveRepoPath(value: string): string {
  return isAbsolute(value) ? value : resolve(REPO_ROOT, value)
}

const IMAGE_PATH = resolveRepoPath(envValue('PHOTO_OCR_COMPARE_IMAGE') || DEFAULT_IMAGE)
const GROUND_TRUTH_PATH = resolveRepoPath(
  envValue('PHOTO_OCR_COMPARE_GT') || DEFAULT_GROUND_TRUTH,
)
const OUTPUT_DIR = resolveRepoPath(envValue('PHOTO_OCR_COMPARE_OUT') || DEFAULT_OUTPUT_DIR)
const RAW_DIR = envValue('PHOTO_OCR_COMPARE_RAW_DIR')
  ? resolveRepoPath(envValue('PHOTO_OCR_COMPARE_RAW_DIR'))
  : ''

const ACCOUNT_ID = envValue('CLOUDFLARE_ACCOUNT_ID')
const API_TOKEN = envValue('CLOUDFLARE_API_TOKEN')

const CREDENTIALS_PRESENT = ACCOUNT_ID.length > 0 && API_TOKEN.length > 0
/** Offline-Auswertung hat Vorrang: sie kostet kein Kontingent und braucht kein Netz. */
const OFFLINE_RAW = RAW_DIR.length > 0
const COMPARE_CONFIGURED = OFFLINE_RAW || CREDENTIALS_PRESENT
const IMAGE_PRESENT = existsSync(IMAGE_PATH)

// ===========================================================================
// Modell-Spezifikationen
// ===========================================================================

type ModelApi = 'chat' | 'moondream-query'

interface ModelSpec {
  /** Exakte Workers-AI-Modell-ID. */
  id: string
  /** Kurzlabel für Tabelle, Logs und Rohdateinamen. */
  label: string
  /** Präfix der Offline-Rohdatei: <rawKey>__<bild-basisname>.json */
  rawKey: string
  api: ModelApi
  /** Feldname für das Ausgabelimit. Gemma 4: max_completion_tokens. */
  maxTokensField: 'max_tokens' | 'max_completion_tokens'
  /** Reasoning-Modell: JSON steht typischerweise am Ende der Antwort. */
  reasoningModel: boolean
  neuronsPerMillionInput: number
  neuronsPerMillionOutput: number
  apiNote: string
}

const MODELS: readonly ModelSpec[] = [
  {
    id: '@cf/meta/llama-4-scout-17b-16e-instruct',
    label: 'llama-4-scout',
    rawKey: 'llama-4-scout',
    api: 'chat',
    maxTokensField: 'max_tokens',
    reasoningModel: false,
    neuronsPerMillionInput: 24_545,
    neuronsPerMillionOutput: 77_273,
    apiNote:
      'Bestehender Produktionspfad: Chat-Messages mit System-Prompt und image_url, ' +
      'temperature 0.1, max_tokens 3000.',
  },
  {
    id: '@cf/google/gemma-4-26b-a4b-it',
    label: 'gemma-4-26b-a4b',
    rawKey: 'gemma-4-26b-a4b',
    api: 'chat',
    maxTokensField: 'max_completion_tokens',
    reasoningModel: true,
    neuronsPerMillionInput: 9_091,
    neuronsPerMillionOutput: 27_273,
    apiNote:
      'Chat-Format wie Llama; Vision über image_url wird laut Cloudflare-Doku ' +
      'unterstützt. max_tokens ist dort zugunsten von max_completion_tokens ' +
      'veraltet, deshalb sendet der Harness max_completion_tokens. Reasoning-Modell: ' +
      'die Antwort kann einen Reasoning-Trace enthalten, das JSON wird robust extrahiert.',
  },
  {
    id: '@cf/moondream/moondream3.1-9B-A2B',
    label: 'moondream3.1-9B-A2B',
    rawKey: 'moondream3.1-9B-A2B',
    api: 'moondream-query',
    maxTokensField: 'max_tokens',
    reasoningModel: false,
    neuronsPerMillionInput: 27_273,
    neuronsPerMillionOutput: 90_909,
    apiNote:
      'Kein Chat-Format: { task:"query", image:<dataURI>, question:<Prompt>, ' +
      'reasoning:false, max_tokens }. Antwort steht im Feld `answer`, Token-Verbrauch ' +
      'in `metrics.input_tokens`/`metrics.output_tokens`. Genau ein Aufruf pro Seite.',
  },
] as const

// ===========================================================================
// Ground Truth
// ===========================================================================

interface GroundTruthIngredient {
  group: string
  quantity: string
  unit: string
  name: string
}

/** Schema: siehe Dateikopf. */
interface GroundTruth {
  title: string
  ingredients: GroundTruthIngredient[]
  steps: string[]
  notes: string
  mustNotInvent: string[]
}

type GroundTruthLoad =
  | { ok: true; value: GroundTruth; sha256: string }
  | { ok: false; reason: string }

function failGroundTruth(reason: string): GroundTruthLoad {
  return { ok: false, reason }
}

function loadGroundTruth(): GroundTruthLoad {
  if (!existsSync(GROUND_TRUTH_PATH)) {
    return failGroundTruth(`Ground-Truth-Datei fehlt: ${GROUND_TRUTH_PATH}`)
  }
  let raw: string
  try {
    raw = readFileSync(GROUND_TRUTH_PATH, 'utf8')
  } catch (error) {
    return failGroundTruth(
      `Ground-Truth-Datei nicht lesbar: ${GROUND_TRUTH_PATH} (${describeError(error)})`,
    )
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw) as unknown
  } catch {
    return failGroundTruth(`Ground-Truth-Datei ist kein gültiges JSON: ${GROUND_TRUTH_PATH}`)
  }
  if (!isRecord(parsed)) {
    return failGroundTruth('Ground Truth ist kein JSON-Objekt.')
  }

  const rawIngredients = parsed.ingredients
  if (!Array.isArray(rawIngredients)) {
    return failGroundTruth('Ground Truth: Feld „ingredients“ fehlt oder ist keine Liste.')
  }
  const ingredients: GroundTruthIngredient[] = []
  for (let index = 0; index < rawIngredients.length; index += 1) {
    const entry = rawIngredients[index]
    if (!isRecord(entry)) {
      return failGroundTruth(`Ground Truth: ingredients[${index}] ist kein Objekt.`)
    }
    const name = readStringField(entry, 'name')
    if (!name) {
      return failGroundTruth(`Ground Truth: ingredients[${index}].name fehlt.`)
    }
    ingredients.push({
      group: readStringField(entry, 'group'),
      quantity: readStringField(entry, 'quantity'),
      unit: readStringField(entry, 'unit'),
      name,
    })
  }

  const rawSteps = parsed.steps
  if (!Array.isArray(rawSteps)) {
    return failGroundTruth('Ground Truth: Feld „steps“ fehlt oder ist keine Liste.')
  }
  const steps: string[] = []
  for (let index = 0; index < rawSteps.length; index += 1) {
    const step = rawSteps[index]
    if (typeof step !== 'string') {
      return failGroundTruth(`Ground Truth: steps[${index}] ist kein Text.`)
    }
    const trimmed = step.trim()
    if (trimmed) steps.push(trimmed)
  }

  const rawMustNotInvent = parsed.mustNotInvent
  if (rawMustNotInvent !== undefined && !Array.isArray(rawMustNotInvent)) {
    return failGroundTruth('Ground Truth: Feld „mustNotInvent“ ist keine Liste.')
  }
  const mustNotInvent: string[] = []
  for (const entry of Array.isArray(rawMustNotInvent) ? rawMustNotInvent : []) {
    if (typeof entry !== 'string') {
      return failGroundTruth('Ground Truth: mustNotInvent enthält einen Nicht-Text-Eintrag.')
    }
    const trimmed = entry.trim()
    if (trimmed) mustNotInvent.push(trimmed)
  }

  return {
    ok: true,
    value: {
      title: readStringField(parsed, 'title'),
      ingredients,
      steps,
      notes: readStringField(parsed, 'notes'),
      mustNotInvent,
    },
    sha256: createHash('sha256').update(raw).digest('hex'),
  }
}

const GT_LOAD = loadGroundTruth()

function requireGroundTruth(): GroundTruth {
  if (!GT_LOAD.ok) throw new Error(GT_LOAD.reason)
  return GT_LOAD.value
}

/** Live-Lauf braucht das Bild; die Offline-Auswertung nur die Ground Truth. */
const RUN_ENABLED =
  COMPARE_CONFIGURED && GT_LOAD.ok && (OFFLINE_RAW || IMAGE_PRESENT)

function skipReason(): string {
  if (!COMPARE_CONFIGURED) {
    return (
      'CLOUDFLARE_ACCOUNT_ID/CLOUDFLARE_API_TOKEN bzw. PHOTO_OCR_COMPARE_RAW_DIR fehlen – ' +
      'Vergleichslauf ausstehend (kein Modellaufruf, keine Kosten).'
    )
  }
  if (!GT_LOAD.ok) return GT_LOAD.reason
  if (!OFFLINE_RAW && !IMAGE_PRESENT) return `Bilddatei fehlt: ${IMAGE_PATH}`
  return 'Vergleichslauf nicht konfiguriert.'
}

// ===========================================================================
// Metrik-Helfer
// ===========================================================================

function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/ß/g, 'ss')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function tokenize(value: string): string[] {
  const normalized = normalize(value)
  return normalized ? normalized.split(' ') : []
}

/** Leichte Plural-/Endungsnormalisierung, damit z. B. Äpfel ≈ Apfel gilt. */
function stemToken(token: string): string {
  if (token.length <= 4 || /\d/.test(token)) return token
  return token.replace(/(en|er|n|s|e)$/, '')
}

function namesMatch(expectedName: string, detectedName: string): boolean {
  const expectedTokens = tokenize(expectedName).map(stemToken)
  const detectedTokens = tokenize(detectedName).map(stemToken)
  if (expectedTokens.length === 0 || detectedTokens.length === 0) return false
  const [shorter, longer] =
    expectedTokens.length <= detectedTokens.length
      ? [expectedTokens, detectedTokens]
      : [detectedTokens, expectedTokens]
  return shorter.every((token) => longer.includes(token))
}

function normalizeQuantity(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, '').replace(/,/g, '.')
}

function quantitiesMatch(expected: string, detected: string): boolean {
  return normalizeQuantity(expected) === normalizeQuantity(detected)
}

const UNIT_ALIASES: Record<string, string> = {
  el: 'el',
  essloffel: 'el',
  tl: 'tl',
  teeloffel: 'tl',
  msp: 'msp',
  messerspitze: 'msp',
  pck: 'pck',
  packung: 'pck',
  packchen: 'pck',
  stk: 'stk',
  stuck: 'stk',
  prise: 'prise',
  prisen: 'prise',
  g: 'g',
  gr: 'g',
  gramm: 'g',
  kg: 'kg',
  kilogramm: 'kg',
  ml: 'ml',
  milliliter: 'ml',
  l: 'l',
  liter: 'l',
  min: 'min',
  minute: 'min',
  minuten: 'min',
  std: 'std',
  stunde: 'std',
  stunden: 'std',
}

function normalizeUnit(value: string): string {
  const key = normalize(value).replace(/\s+/g, '')
  return UNIT_ALIASES[key] ?? key
}

function unitsMatch(expected: string, detected: string): boolean {
  return normalizeUnit(expected) === normalizeUnit(detected)
}

/** Treffer der normalisierten `mustNotInvent`-Begriffe in einem Text. */
function mustNotInventHits(text: string, groundTruth: GroundTruth): string[] {
  const normalizedText = normalize(text)
  if (!normalizedText) return []
  return groundTruth.mustNotInvent.filter((entry) => {
    const normalizedEntry = normalize(entry)
    return normalizedEntry.length > 0 && normalizedText.includes(normalizedEntry)
  })
}

/**
 * Heuristik für „falsch erkannt“: Die Zutat hat keinen Match, ähnelt aber
 * einer Soll-Zutat (gemeinsamer Wortstamm/Präfix). Reine Fantasiezutaten ohne
 * Bezug zählen als „erfunden“.
 */
function looksLikeMisread(detectedName: string, expectedNames: string[]): boolean {
  const detected = normalize(detectedName)
  if (!detected) return false
  const detectedTokens = tokenize(detectedName)
  for (const expectedName of expectedNames) {
    const expected = normalize(expectedName)
    if (!expected) continue
    if (
      expected.length >= 5 &&
      detected.length >= 5 &&
      (expected.includes(detected) || detected.includes(expected))
    ) {
      return true
    }
    const expectedTokens = tokenize(expectedName)
    for (const left of detectedTokens) {
      if (left.length < 5) continue
      for (const right of expectedTokens) {
        if (right.length < 5) continue
        if (left.startsWith(right) || right.startsWith(left)) return true
      }
    }
  }
  return false
}

// ===========================================================================
// Typen für Auswertung und Bericht
// ===========================================================================

interface Usage {
  promptTokens: number | null
  completionTokens: number | null
  totalTokens: number | null
}

function emptyUsage(): Usage {
  return { promptTokens: null, completionTokens: null, totalTokens: null }
}

interface TitleMetrics {
  expected: string
  detected: string
  exact: boolean
  contains: boolean
}

interface DetectedIngredientView {
  group: string
  quantity: string
  unit: string
  name: string
}

interface IngredientComparison {
  expected: GroundTruthIngredient
  detected: DetectedIngredientView | null
  matched: boolean
  quantityOk: boolean | null
  unitOk: boolean | null
}

interface IngredientMetrics {
  expectedCount: number
  detectedCount: number
  matchedCount: number
  precision: number | null
  recall: number | null
  quantityAccuracy: number | null
  unitAccuracy: number | null
  /** Soll-Zutaten ohne erkanntes Gegenstück. */
  missing: string[]
  /** Zusätzlich erkannte Zutaten, die einer Soll-Zutat ähneln (Fehllesung). */
  wrong: string[]
  /** Zusätzlich erkannte Zutaten ohne Bezug bzw. mustNotInvent-Treffer. */
  invented: string[]
  comparisons: IngredientComparison[]
}

interface StepMetrics {
  expectedCount: number
  detectedCount: number
  countDelta: number
  /** Schritte mit fremdem Zutaten-/Mengenmaterial (mustNotInvent oder fremde Zutat). */
  withForeignMaterial: number
}

interface MustNotInventViolation {
  entry: string
  where: 'ingredients' | 'steps' | 'notes'
  text: string
}

interface NotesMetrics {
  expected: string
  detected: string
  present: boolean
  contains: boolean
}

interface ModelMetrics {
  title: TitleMetrics
  ingredients: IngredientMetrics
  steps: StepMetrics
  notes: NotesMetrics
  mustNotInvent: { expected: string[]; violations: MustNotInventViolation[] }
}

type ModelStatus = 'ok' | 'format-error' | 'api-error'

interface ModelOutcome {
  model: string
  label: string
  api: ModelApi
  status: ModelStatus
  /** Technische Fehlermeldung ohne Rezepttext/Secrets. */
  error?: string
  /** Kurzer Antwortanfang – nur im Bericht unter PHOTO_OCR_COMPARE_OUT. */
  rawPreview?: string
  /** Relativer Pfad der gespeicherten Rohantwort, falls geschrieben. */
  rawStoredAs?: string
  rawStorageError?: string
  latencyMs: number
  httpStatus: number | null
  usage: Usage
  estimatedNeurons: number | null
  /** Woher der ausgewertete Text stammt (z. B. answer, response, choices). */
  responseSource: string | null
  /** Verwendete JSON-Extraktionsstrategie. */
  jsonStrategy: string | null
  recipe: OcrRecipe | null
  metrics: ModelMetrics | null
  apiNote: string
}

interface ModelDescriptor {
  id: string
  label: string
  api: ModelApi
  maxTokensField: ModelSpec['maxTokensField']
  neuronsPerMillionInput: number
  neuronsPerMillionOutput: number
  apiNote: string
}

interface CompareReport {
  status: 'compare-run'
  generatedAt: string
  contractVersion: number
  models: ModelDescriptor[]
  input: {
    image: string
    imagePresent: boolean
    imageBytes: number | null
    groundTruth: string
    groundTruthSha256: string | null
    outputDirectory: string
    offlineRawDirectory: string | null
  }
  budget: {
    modelCalls: number
    models: number
    requestTimeoutMs: number
    noRetries: true
    freeDailyNeurons: number
    estimatedNeuronsTotal: number
    estimatedFreeDailyBudgetPercent: number | null
  }
  groundTruth: GroundTruth
  results: ModelOutcome[]
  summary: {
    models: number
    evaluable: number
    formatErrors: number
    apiErrors: number
    averageLatencyMs: number
    estimatedNeuronsTotal: number
    allEvaluable: boolean
    note: string
  }
}

// ===========================================================================
// Modellaufruf
// ===========================================================================

interface ModelCall {
  body: unknown
  latencyMs: number
  httpStatus: number | null
}

let imageDataUri = ''
let imageMime = ''
let imageBytes: number | null = null

function detectImageMime(bytes: Uint8Array, path: string): string {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg'
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return 'image/png'
  }
  if (
    bytes.length >= 12 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return 'image/webp'
  }
  const extension = path.toLowerCase().split('.').pop() ?? ''
  if (extension === 'png') return 'image/png'
  if (extension === 'webp') return 'image/webp'
  return 'image/jpeg'
}

function endpointFor(spec: ModelSpec): string {
  return `${API_BASE}/accounts/${encodeURIComponent(ACCOUNT_ID)}/ai/run/${spec.id}`
}

/**
 * Chat-Format (Llama/Gemma): gleicher Prompt wie im Produktionspfad.
 * Beim Reasoning-Modell Gemma wird der Denkmodus abgeschaltet, sonst besteht
 * die Antwort nur aus Reasoning und das Tokenbudget ist aufgebraucht.
 */
function buildChatInput(spec: ModelSpec, dataUri: string): Record<string, unknown> {
  return {
    messages: [
      { role: 'system', content: OCR_SYSTEM_PROMPT },
      {
        role: 'user',
        content: [
          { type: 'text', text: buildOcrUserPrompt(1) },
          { type: 'image_url', image_url: { url: dataUri } },
        ],
      },
    ],
    temperature: PHOTO_OCR_TEMPERATURE,
    [spec.maxTokensField]: PHOTO_OCR_MAX_OUTPUT_TOKENS,
    ...(spec.reasoningModel
      ? { chat_template_kwargs: { enable_thinking: false, thinking: false } }
      : {}),
  }
}

/** Moondream-Format: dieselbe Prompt-Vorgabe als `question`, genau eine Seite. */
function buildMoondreamInput(dataUri: string): Record<string, unknown> {
  return {
    task: 'query',
    image: dataUri,
    question: `${OCR_SYSTEM_PROMPT}\n\n${buildOcrUserPrompt(1)}`,
    reasoning: false,
    temperature: PHOTO_OCR_TEMPERATURE,
    max_tokens: PHOTO_OCR_MAX_OUTPUT_TOKENS,
  }
}

function buildModelInput(spec: ModelSpec, dataUri: string): Record<string, unknown> {
  return spec.api === 'moondream-query'
    ? buildMoondreamInput(dataUri)
    : buildChatInput(spec, dataUri)
}

async function callModelLive(spec: ModelSpec): Promise<ModelCall> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  const startedAt = Date.now()
  try {
    let response: Response
    try {
      response = await fetch(endpointFor(spec), {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${API_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(buildModelInput(spec, imageDataUri)),
        signal: controller.signal,
      })
    } catch (error) {
      throw new Error(
        `Netzwerkfehler oder Timeout nach ${Date.now() - startedAt} ms: ${describeError(error)}`,
      )
    }
    const latencyMs = Date.now() - startedAt
    const bodyText = await response.text()
    let body: unknown
    try {
      body = JSON.parse(bodyText) as unknown
    } catch {
      throw new Error(`Die Workers-AI-Antwort ist kein gültiges JSON (HTTP ${response.status}).`)
    }
    if (!response.ok) {
      throw new Error(
        `Workers AI antwortet mit HTTP ${response.status}: ${truncate(
          JSON.stringify(isRecord(body) ? body.errors ?? body : body),
          MAX_RAW_PREVIEW_CHARS,
        )}`,
      )
    }
    return { body, latencyMs, httpStatus: response.status }
  } finally {
    clearTimeout(timer)
  }
}

function rawFileName(spec: ModelSpec): string {
  return `${spec.rawKey}__${basename(IMAGE_PATH)}.json`
}

/** Offline-Modus: liest { latencyMs, body } analog photo-ocr-trial.test.ts. */
function readOfflineModelResponse(spec: ModelSpec): ModelCall {
  const file = join(RAW_DIR, rawFileName(spec))
  if (!existsSync(file)) {
    throw new Error(
      `Offline-Rohantwort fehlt: ${file} (erwartet: <rawKey>__<bild-basisname>.json)`,
    )
  }
  let stored: unknown
  try {
    stored = JSON.parse(readFileSync(file, 'utf8')) as unknown
  } catch (error) {
    throw new Error(`Offline-Rohantwort ist kein gültiges JSON: ${file} (${describeError(error)})`)
  }
  if (!isRecord(stored)) {
    throw new Error(`Offline-Rohantwort enthält kein Objekt: ${file}`)
  }
  if (!('body' in stored)) {
    throw new Error(`Offline-Rohantwort enthält kein body-Feld: ${file}`)
  }
  return {
    body: stored.body,
    latencyMs: numberOrNull(stored.latencyMs) ?? 0,
    httpStatus: numberOrNull(stored.httpStatus),
  }
}

/**
 * Speichert die vollständige Rohantwort ausschließlich unter
 * $PHOTO_OCR_COMPARE_OUT/raw/. Request-Body und Bild-Base64 werden bewusst
 * NICHT gespeichert.
 */
function storeRawResponse(spec: ModelSpec, call: ModelCall): string {
  const rawDirectory = join(OUTPUT_DIR, 'raw')
  mkdirSync(rawDirectory, { recursive: true })
  const file = join(rawDirectory, rawFileName(spec))
  writeFileSync(
    file,
    `${JSON.stringify(
      {
        model: spec.id,
        api: spec.api,
        capturedAt: new Date().toISOString(),
        latencyMs: call.latencyMs,
        httpStatus: call.httpStatus,
        body: call.body,
      },
      null,
      2,
    )}\n`,
    'utf8',
  )
  return `raw/${basename(file)}`
}

// ===========================================================================
// Antwort-Extraktion (Reasoning-/Content-Arrays robust behandeln)
// ===========================================================================

interface ExtractedText {
  text: string
  source: string
}

function textFromContent(value: unknown): string {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) {
    const parts: string[] = []
    for (const part of value) {
      if (typeof part === 'string') {
        parts.push(part)
      } else if (isRecord(part) && typeof part.text === 'string') {
        parts.push(part.text)
      }
    }
    return parts.join('')
  }
  if (isRecord(value) && typeof value.text === 'string') return value.text
  return ''
}

/**
 * Liest den Modelltext aus den Antwortformen, die Workers AI liefert
 * (Chat: response/choices.message.content, Moondream: answer). Reasoning-Traces
 * werden nur als letzter Ausweg verwendet, damit das JSON am Ende der Antwort
 * bevorzugt wird.
 */
function extractModelText(result: Record<string, unknown>, spec: ModelSpec): ExtractedText {
  if (spec.api === 'moondream-query') {
    if (typeof result.answer === 'string' && result.answer.trim()) {
      return { text: result.answer, source: 'answer' }
    }
    if (
      isRecord(result.reasoning) &&
      typeof result.reasoning.text === 'string' &&
      result.reasoning.text.trim()
    ) {
      return { text: result.reasoning.text, source: 'reasoning-fallback' }
    }
  }

  const responseText = textFromContent(result.response)
  if (responseText.trim()) return { text: responseText, source: 'response' }
  if (isRecord(result.response)) {
    return { text: JSON.stringify(result.response), source: 'response-object' }
  }

  const choices = result.choices
  if (Array.isArray(choices) && choices.length > 0) {
    const first = choices[0]
    if (isRecord(first)) {
      const message = first.message
      if (isRecord(message)) {
        const content = textFromContent(message.content)
        if (content.trim()) return { text: content, source: 'choices.message.content' }
        // Reasoning-Modelle: manche Antworten liefern nur reasoning_content.
        const reasoning = message.reasoning_content
        if (typeof reasoning === 'string' && reasoning.trim()) {
          return { text: reasoning, source: 'choices.message.reasoning-fallback' }
        }
      }
      const choiceText = textFromContent(first.text)
      if (choiceText.trim()) return { text: choiceText, source: 'choices.text' }
    }
  }

  if (typeof result.output_text === 'string' && result.output_text.trim()) {
    return { text: result.output_text, source: 'output_text' }
  }
  const direct = textFromContent(result.text)
  if (direct.trim()) return { text: direct, source: 'text' }
  const content = textFromContent(result.content)
  if (content.trim()) return { text: content, source: 'content' }
  return { text: '', source: 'none' }
}

interface JsonExtraction {
  value: unknown
  strategy: string
}

/** Sammelt alle ausbalancierten {...}-Objekte (String-/Escape-bewusst). */
function collectBalancedObjects(text: string): string[] {
  const objects: string[] = []
  let start = -1
  let depth = 0
  let inString = false
  let escaped = false
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    if (inString) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') inString = false
      continue
    }
    if (char === '"') {
      inString = true
      continue
    }
    if (char === '{') {
      if (depth === 0) start = index
      depth += 1
    } else if (char === '}') {
      if (depth > 0) {
        depth -= 1
        if (depth === 0 && start >= 0) {
          objects.push(text.slice(start, index + 1))
          start = -1
        }
      }
    }
  }
  return objects
}

/** Minimal-invasive Reparatur üblicher JSON-Schönheitsfehler (letzter Ausweg). */
function repairJson(source: string): string {
  return source
    .replace(/,\s*([}\]])/g, '$1')
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2018\u2019]/g, "'")
}

function extractByStrategy(text: string, strategy: string): unknown {
  if (strategy === 'direct') return extractJsonObject(text)
  if (strategy === 'fenced') {
    const fencePattern = /```(?:json)?\s*([\s\S]*?)```/gi
    let match: RegExpExecArray | null
    while ((match = fencePattern.exec(text)) !== null) {
      const body = match[1]?.trim()
      if (!body) continue
      try {
        return extractJsonObject(body)
      } catch {
        // nächster Zaun
      }
    }
    throw new Error('Kein JSON-Objekt in einem Markdown-Zaun gefunden.')
  }
  if (strategy === 'balanced') {
    const candidates = collectBalancedObjects(text)
    for (let index = candidates.length - 1; index >= 0; index -= 1) {
      for (const candidate of [candidates[index], repairJson(candidates[index])]) {
        try {
          return JSON.parse(candidate) as unknown
        } catch {
          // nächstes Objekt
        }
      }
    }
    throw new Error('Kein ausbalanciertes JSON-Objekt gefunden.')
  }
  throw new Error(`Unbekannte Extraktionsstrategie: ${strategy}`)
}

/**
 * Robuste JSON-Extraktion. Bei Reasoning-Modellen (Gemma) wird zuerst das
 * letzte ausbalancierte Objekt versucht, weil der Reasoning-Trace vor dem
 * eigentlichen JSON steht und selbst Beispiel-JSON enthalten kann.
 */
function extractJsonRobust(text: string, preferLastBalancedObject: boolean): JsonExtraction {
  const order = preferLastBalancedObject
    ? ['balanced', 'direct', 'fenced']
    : ['direct', 'fenced', 'balanced']
  const errors: string[] = []
  for (const strategy of order) {
    try {
      return { value: extractByStrategy(text, strategy), strategy }
    } catch (error) {
      errors.push(`${strategy}: ${describeError(error)}`)
    }
  }
  throw new Error(
    `Kein gültiges JSON-Objekt in der Modellantwort gefunden (${errors.join(' | ')}).`,
  )
}

// ===========================================================================
// usage / Neuronen
// ===========================================================================

function extractUsage(result: Record<string, unknown>): Usage {
  const sources: Record<string, unknown>[] = []
  if (isRecord(result.usage)) sources.push(result.usage)
  if (isRecord(result.meta) && isRecord(result.meta.usage)) sources.push(result.meta.usage)
  if (isRecord(result.metrics)) sources.push(result.metrics)

  let promptTokens: number | null = null
  let completionTokens: number | null = null
  let totalTokens: number | null = null
  for (const source of sources) {
    promptTokens ??= numberOrNull(
      source.prompt_tokens ?? source.promptTokens ?? source.input_tokens,
    )
    completionTokens ??= numberOrNull(
      source.completion_tokens ?? source.completionTokens ?? source.output_tokens,
    )
    totalTokens ??= numberOrNull(source.total_tokens ?? source.totalTokens)
  }
  if (totalTokens === null && promptTokens !== null && completionTokens !== null) {
    totalTokens = promptTokens + completionTokens
  }
  return { promptTokens, completionTokens, totalTokens }
}

function estimateNeurons(spec: ModelSpec, usage: Usage): number | null {
  if (usage.promptTokens === null && usage.completionTokens === null) return null
  const value =
    ((usage.promptTokens ?? 0) / 1_000_000) * spec.neuronsPerMillionInput +
    ((usage.completionTokens ?? 0) / 1_000_000) * spec.neuronsPerMillionOutput
  return Math.round(value * 100) / 100
}

// ===========================================================================
// Bewertung
// ===========================================================================

function readResultObject(body: unknown): Record<string, unknown> {
  if (!isRecord(body)) {
    throw new Error('Die Workers-AI-Antwort ist kein JSON-Objekt.')
  }
  if (body.success === false) {
    throw new Error(
      `Workers AI meldet einen Fehler: ${truncate(
        JSON.stringify(body.errors ?? body),
        MAX_RAW_PREVIEW_CHARS,
      )}`,
    )
  }
  const result = body.result
  if (!isRecord(result)) {
    throw new Error('Die Workers-AI-Antwort enthält kein result-Objekt.')
  }
  return result
}

function detectedView(ingredient: OcrIngredient): DetectedIngredientView {
  return {
    group: ingredient.group,
    quantity: ingredient.quantity,
    unit: ingredient.unit,
    name: ingredient.name,
  }
}

interface IngredientResult {
  metrics: IngredientMetrics
  violations: MustNotInventViolation[]
}

function evaluateIngredients(
  groundTruth: GroundTruth,
  detectedIngredients: OcrIngredient[],
): IngredientResult {
  const expectedNames = groundTruth.ingredients.map((ingredient) => ingredient.name)
  const usedDetected = new Set<number>()
  const comparisons: IngredientComparison[] = []
  const missing: string[] = []

  for (const expected of groundTruth.ingredients) {
    const detectedIndex = detectedIngredients.findIndex(
      (detected, index) => !usedDetected.has(index) && namesMatch(expected.name, detected.name),
    )
    if (detectedIndex < 0) {
      missing.push(expected.name)
      comparisons.push({ expected, detected: null, matched: false, quantityOk: null, unitOk: null })
      continue
    }
    usedDetected.add(detectedIndex)
    const detected = detectedIngredients[detectedIndex]
    comparisons.push({
      expected,
      detected: detectedView(detected),
      matched: true,
      quantityOk: quantitiesMatch(expected.quantity, detected.quantity),
      unitOk: unitsMatch(expected.unit, detected.unit),
    })
  }

  const extraNames = detectedIngredients
    .filter((_, index) => !usedDetected.has(index))
    .map((ingredient) => ingredient.name)
  const wrong: string[] = []
  const invented: string[] = []
  for (const name of extraNames) {
    if (mustNotInventHits(name, groundTruth).length > 0) {
      invented.push(name)
    } else if (looksLikeMisread(name, expectedNames)) {
      wrong.push(name)
    } else {
      invented.push(name)
    }
  }

  const matched = comparisons.filter((comparison) => comparison.matched)
  const precision =
    detectedIngredients.length > 0 ? matched.length / detectedIngredients.length : null
  const recall =
    groundTruth.ingredients.length > 0
      ? matched.length / groundTruth.ingredients.length
      : null
  const quantityAccuracy =
    matched.length > 0
      ? matched.filter((comparison) => comparison.quantityOk === true).length / matched.length
      : null
  const unitAccuracy =
    matched.length > 0
      ? matched.filter((comparison) => comparison.unitOk === true).length / matched.length
      : null

  const violations: MustNotInventViolation[] = []
  for (const ingredient of detectedIngredients) {
    for (const entry of mustNotInventHits(ingredient.name, groundTruth)) {
      violations.push({ entry, where: 'ingredients', text: ingredient.name })
    }
  }

  return {
    metrics: {
      expectedCount: groundTruth.ingredients.length,
      detectedCount: detectedIngredients.length,
      matchedCount: matched.length,
      precision,
      recall,
      quantityAccuracy,
      unitAccuracy,
      missing,
      wrong,
      invented,
      comparisons,
    },
    violations,
  }
}

function evaluateRecipe(
  groundTruth: GroundTruth,
  recipe: OcrRecipe,
): ModelMetrics {
  const ingredientResult = evaluateIngredients(groundTruth, recipe.ingredients)
  const ingredientMetrics = ingredientResult.metrics

  const normalizedExpectedTitle = normalize(groundTruth.title)
  const normalizedDetectedTitle = normalize(recipe.title)
  const titleExact =
    normalizedExpectedTitle.length > 0 && normalizedExpectedTitle === normalizedDetectedTitle
  const titleContains =
    normalizedExpectedTitle.length > 0 &&
    normalizedDetectedTitle.length > 0 &&
    (normalizedDetectedTitle.includes(normalizedExpectedTitle) ||
      normalizedExpectedTitle.includes(normalizedDetectedTitle))

  const normalizedExpectedNotes = normalize(groundTruth.notes)
  const normalizedDetectedNotes = normalize(recipe.notes)
  const notesPresent = recipe.notes.trim().length > 0
  const notesContains =
    normalizedExpectedNotes.length > 0 &&
    normalizedDetectedNotes.length > 0 &&
    (normalizedDetectedNotes.includes(normalizedExpectedNotes) ||
      normalizedExpectedNotes.includes(normalizedDetectedNotes))

  const foreignNames = new Set(
    [...ingredientMetrics.wrong, ...ingredientMetrics.invented]
      .map(normalize)
      .filter((name) => name.length > 0),
  )
  const withForeignMaterial = recipe.steps.filter((step) => {
    const stepText = normalize(step.text)
    if (!stepText) return false
    if (mustNotInventHits(step.text, groundTruth).length > 0) return true
    for (const foreignName of foreignNames) {
      if (stepText.includes(foreignName)) return true
    }
    return false
  }).length

  const stepViolations: MustNotInventViolation[] = []
  for (const step of recipe.steps) {
    for (const entry of mustNotInventHits(step.text, groundTruth)) {
      stepViolations.push({ entry, where: 'steps', text: step.text.slice(0, 200) })
    }
  }
  const noteViolations: MustNotInventViolation[] = mustNotInventHits(
    recipe.notes,
    groundTruth,
  ).map((entry) => ({ entry, where: 'notes' as const, text: recipe.notes.slice(0, 200) }))

  return {
    title: {
      expected: groundTruth.title,
      detected: recipe.title,
      exact: titleExact,
      contains: titleContains,
    },
    ingredients: ingredientMetrics,
    steps: {
      expectedCount: groundTruth.steps.length,
      detectedCount: recipe.steps.length,
      countDelta: recipe.steps.length - groundTruth.steps.length,
      withForeignMaterial,
    },
    notes: {
      expected: groundTruth.notes,
      detected: recipe.notes,
      present: notesPresent,
      contains: notesContains,
    },
    mustNotInvent: {
      expected: groundTruth.mustNotInvent,
      violations: [...ingredientResult.violations, ...stepViolations, ...noteViolations],
    },
  }
}

function emptyOutcome(spec: ModelSpec): ModelOutcome {
  return {
    model: spec.id,
    label: spec.label,
    api: spec.api,
    status: 'api-error',
    latencyMs: 0,
    httpStatus: null,
    usage: emptyUsage(),
    estimatedNeurons: null,
    responseSource: null,
    jsonStrategy: null,
    recipe: null,
    metrics: null,
    apiNote: spec.apiNote,
  }
}

function evaluateModel(
  spec: ModelSpec,
  groundTruth: GroundTruth,
  call: ModelCall,
  rawStoredAs: string | undefined,
  rawStorageError: string | undefined,
): ModelOutcome {
  const outcome: ModelOutcome = {
    ...emptyOutcome(spec),
    latencyMs: call.latencyMs,
    httpStatus: call.httpStatus,
    ...(rawStoredAs ? { rawStoredAs } : {}),
    ...(rawStorageError ? { rawStorageError } : {}),
  }

  let result: Record<string, unknown>
  try {
    result = readResultObject(call.body)
  } catch (error) {
    return { ...outcome, status: 'api-error', error: describeError(error) }
  }

  const usage = extractUsage(result)
  outcome.usage = usage
  outcome.estimatedNeurons = estimateNeurons(spec, usage)

  const extracted = extractModelText(result, spec)
  outcome.responseSource = extracted.source
  if (!extracted.text.trim()) {
    return {
      ...outcome,
      status: 'format-error',
      error: 'Die Modellantwort enthält keinen auswertbaren Text.',
    }
  }

  let extraction: JsonExtraction
  try {
    extraction = extractJsonRobust(extracted.text, spec.reasoningModel)
  } catch (error) {
    return {
      ...outcome,
      status: 'format-error',
      error: `JSON-Extraktion fehlgeschlagen: ${describeError(error)}`,
      rawPreview: truncate(extracted.text.replace(/\s+/g, ' '), MAX_RAW_PREVIEW_CHARS),
    }
  }
  outcome.jsonStrategy = extraction.strategy

  let recipe: OcrRecipe
  try {
    // Produktionsnähe: strikt validieren und deterministische Zusatzprüfungen
    // anwenden. Die Zusatzprüfungen ändern keine der verglichenen Felder.
    recipe = applyOcrConsistencyChecks(validateOcrRecipe(extraction.value))
  } catch (error) {
    return {
      ...outcome,
      status: 'format-error',
      error: `Schema-Validierung fehlgeschlagen: ${describeError(error)}`,
      rawPreview: truncate(extracted.text.replace(/\s+/g, ' '), MAX_RAW_PREVIEW_CHARS),
    }
  }
  outcome.recipe = recipe

  try {
    outcome.metrics = evaluateRecipe(groundTruth, recipe)
  } catch (error) {
    return {
      ...outcome,
      status: 'format-error',
      error: `Auswertung fehlgeschlagen: ${describeError(error)}`,
    }
  }
  outcome.status = 'ok'
  return outcome
}

async function runModel(spec: ModelSpec): Promise<ModelOutcome> {
  const groundTruth = requireGroundTruth()
  const startedAt = Date.now()

  let call: ModelCall
  try {
    call = OFFLINE_RAW ? readOfflineModelResponse(spec) : await callModelLive(spec)
  } catch (error) {
    return {
      ...emptyOutcome(spec),
      latencyMs: Date.now() - startedAt,
      error: describeError(error),
    }
  }

  let rawStoredAs: string | undefined
  let rawStorageError: string | undefined
  if (!OFFLINE_RAW) {
    try {
      rawStoredAs = storeRawResponse(spec, call)
    } catch (error) {
      rawStorageError = describeError(error)
    }
  }

  try {
    return evaluateModel(spec, groundTruth, call, rawStoredAs, rawStorageError)
  } catch (error) {
    return {
      ...emptyOutcome(spec),
      status: 'format-error',
      latencyMs: call.latencyMs,
      httpStatus: call.httpStatus,
      error: `Auswertung fehlgeschlagen: ${describeError(error)}`,
      ...(rawStoredAs ? { rawStoredAs } : {}),
      ...(rawStorageError ? { rawStorageError } : {}),
    }
  }
}

// ===========================================================================
// Bericht (Markdown + JSON ausschließlich unter PHOTO_OCR_COMPARE_OUT)
// ===========================================================================

const results: ModelOutcome[] = []

function average(values: number[]): number | null {
  if (values.length === 0) return null
  return Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 1000) / 1000
}

function modelDescriptors(): ModelDescriptor[] {
  return MODELS.map((spec) => ({
    id: spec.id,
    label: spec.label,
    api: spec.api,
    maxTokensField: spec.maxTokensField,
    neuronsPerMillionInput: spec.neuronsPerMillionInput,
    neuronsPerMillionOutput: spec.neuronsPerMillionOutput,
    apiNote: spec.apiNote,
  }))
}

function buildReport(): CompareReport {
  const okResults = results.filter((result) => result.status === 'ok')
  const estimatedNeuronsTotal =
    Math.round(
      results.reduce((sum, result) => sum + (result.estimatedNeurons ?? 0), 0) * 100,
    ) / 100

  return {
    status: 'compare-run',
    generatedAt: new Date().toISOString(),
    contractVersion: PHOTO_OCR_CONTRACT_VERSION,
    models: modelDescriptors(),
    input: {
      image: basename(IMAGE_PATH),
      imagePresent: IMAGE_PRESENT,
      imageBytes,
      groundTruth: basename(GROUND_TRUTH_PATH),
      groundTruthSha256: GT_LOAD.ok ? GT_LOAD.sha256 : null,
      outputDirectory: OUTPUT_DIR,
      offlineRawDirectory: OFFLINE_RAW ? RAW_DIR : null,
    },
    budget: {
      modelCalls: results.length,
      models: MODELS.length,
      requestTimeoutMs: REQUEST_TIMEOUT_MS,
      noRetries: true,
      freeDailyNeurons: FREE_DAILY_NEURON_BUDGET,
      estimatedNeuronsTotal,
      estimatedFreeDailyBudgetPercent:
        estimatedNeuronsTotal > 0
          ? Math.round((estimatedNeuronsTotal / FREE_DAILY_NEURON_BUDGET) * 10000) / 100
          : null,
    },
    groundTruth: requireGroundTruth(),
    results,
    summary: {
      models: results.length,
      evaluable: okResults.length,
      formatErrors: results.filter((result) => result.status === 'format-error').length,
      apiErrors: results.filter((result) => result.status === 'api-error').length,
      averageLatencyMs: okResults.length
        ? Math.round(
            okResults.reduce((sum, result) => sum + result.latencyMs, 0) / okResults.length,
          )
        : 0,
      estimatedNeuronsTotal,
      allEvaluable: okResults.length === MODELS.length,
      note:
        'Neuronen-/Kostenschätzung aus den usage-Tokens mit den modellspezifischen ' +
        'Neuronen pro Million Token; die tatsächliche Abrechnung kann abweichen. ' +
        'Genau ein Aufruf pro Modell, keine Wiederholungen. Rezepttexte sind privat ' +
        'und dürfen nicht committet werden.',
    },
  }
}

function formatPercent(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '–'
  return `${Math.round(value * 100)} %`
}

function yesNo(value: boolean | null): string {
  return value === null ? '–' : value ? 'ja' : 'nein'
}

function mdCell(value: string): string {
  return value.replace(/\r?\n/g, ' ').replace(/\|/g, '/').trim()
}

function listOrDash(values: string[]): string {
  return values.length > 0 ? values.map(mdCell).join(', ') : '–'
}

function statusLabel(status: ModelStatus): string {
  if (status === 'ok') return 'ok'
  if (status === 'format-error') return 'Formatfehler'
  return 'API-Fehler'
}

function formatModelSection(outcome: ModelOutcome): string[] {
  const lines: string[] = [`### ${outcome.label}`, '']
  lines.push(`- Modell-ID: \`${outcome.model}\``)
  lines.push(
    `- Status: ${statusLabel(outcome.status)} · Latenz ${outcome.latencyMs} ms · ` +
      `HTTP ${outcome.httpStatus ?? '–'}`,
  )
  lines.push(
    `- Antworttext: ${outcome.responseSource ?? '–'} · JSON-Strategie: ${
      outcome.jsonStrategy ?? '–'
    }`,
  )
  if (outcome.rawStoredAs) lines.push(`- Rohantwort: ${outcome.rawStoredAs}`)
  if (outcome.rawStorageError) {
    lines.push(`- Rohantwort konnte nicht gespeichert werden: ${mdCell(outcome.rawStorageError)}`)
  }
  if (outcome.error) lines.push(`- Fehler: ${mdCell(outcome.error)}`)
  lines.push(
    `- usage: prompt ${outcome.usage.promptTokens ?? '–'} · completion ${
      outcome.usage.completionTokens ?? '–'
    } · total ${outcome.usage.totalTokens ?? '–'}`,
  )
  lines.push(`- Neuronen-Schätzung: ${outcome.estimatedNeurons ?? '–'}`)
  lines.push('')

  const metrics = outcome.metrics
  if (!metrics) return lines

  lines.push(
    `- Titel: Soll „${mdCell(metrics.title.expected)}“ / Ist „${mdCell(
      metrics.title.detected,
    )}“ → exakt: ${yesNo(metrics.title.exact)}, enthält: ${yesNo(metrics.title.contains)}`,
  )
  lines.push(
    `- Zutaten: ${metrics.ingredients.matchedCount}/${metrics.ingredients.expectedCount} ` +
      `Soll-Zutaten gematcht, ${metrics.ingredients.detectedCount} erkannt · ` +
      `Precision ${formatPercent(metrics.ingredients.precision)} · ` +
      `Recall ${formatPercent(metrics.ingredients.recall)}`,
  )
  lines.push(
    `- Menge/Einheit bei gematchten Zutaten: ${formatPercent(
      metrics.ingredients.quantityAccuracy,
    )} / ${formatPercent(metrics.ingredients.unitAccuracy)}`,
  )
  lines.push(
    `- Schritte: Soll ${metrics.steps.expectedCount}, Ist ${metrics.steps.detectedCount} ` +
      `(${metrics.steps.countDelta >= 0 ? '+' : ''}${metrics.steps.countDelta}) · ` +
      `Schritte mit fremdem Zutaten-/Mengenmaterial: ${metrics.steps.withForeignMaterial}`,
  )
  lines.push(`- Fehlende Zutaten: ${listOrDash(metrics.ingredients.missing)}`)
  lines.push(`- Falsch erkannte Zutaten: ${listOrDash(metrics.ingredients.wrong)}`)
  lines.push(`- Erfundene Zutaten: ${listOrDash(metrics.ingredients.invented)}`)
  lines.push(
    `- Notizen: Soll „${mdCell(metrics.notes.expected)}“ / Ist „${mdCell(
      metrics.notes.detected,
    )}“ → vorhanden: ${yesNo(metrics.notes.present)}, enthält: ${yesNo(
      metrics.notes.contains,
    )}`,
  )
  if (metrics.mustNotInvent.violations.length > 0) {
    const violations = metrics.mustNotInvent.violations
      .map((violation) => `${violation.entry} (${violation.where})`)
      .join(', ')
    lines.push(`- mustNotInvent-Verstöße: ${violations}`)
  } else {
    lines.push('- mustNotInvent-Verstöße: keine')
  }
  lines.push('')
  lines.push(
    '| Zutat (Soll) | Soll Menge | Soll Einheit | Ist Menge | Ist Einheit | Match | Menge ok | Einheit ok |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
  )
  for (const comparison of metrics.ingredients.comparisons) {
    lines.push(
      `| ${mdCell(comparison.expected.name)} | ${mdCell(
        comparison.expected.quantity || '–',
      )} | ${mdCell(comparison.expected.unit || '–')} | ${mdCell(
        comparison.detected?.quantity || '–',
      )} | ${mdCell(comparison.detected?.unit || '–')} | ${
        comparison.matched ? 'ja' : 'nein'
      } | ${yesNo(comparison.quantityOk)} | ${yesNo(comparison.unitOk)} |`,
    )
  }
  lines.push('')
  return lines
}

function formatMarkdown(report: CompareReport): string {
  const lines: string[] = []
  lines.push('# Foto-OCR-Modellvergleich: Llama 4 Scout vs. Gemma 4 vs. Moondream 3.1', '')
  lines.push(`- Erzeugt: ${report.generatedAt}`)
  lines.push(
    `- Bild: ${report.input.image} (${report.input.imageBytes ?? '–'} Bytes, ${
      report.input.offlineRawDirectory ? 'Offline-Auswertung' : 'live gelesen'
    })`,
  )
  lines.push(
    `- Ground Truth: ${report.input.groundTruth} (SHA-256 ${
      report.input.groundTruthSha256?.slice(0, 16) ?? '–'
    }…)`,
  )
  lines.push(
    `- Aufrufe: ${report.budget.modelCalls} (genau 1 pro Modell) · Timeout ${
      report.budget.requestTimeoutMs / 1000
    } s · keine Wiederholungen`,
  )
  if (report.input.offlineRawDirectory) {
    lines.push(`- Offline-Rohantworten: ${report.input.offlineRawDirectory}`)
  }
  lines.push(
    `- Neuronen-Schätzung gesamt: ${report.budget.estimatedNeuronsTotal} ` +
      `(${report.budget.estimatedFreeDailyBudgetPercent ?? '–'} % des Free-Tier-Tagesbudgets ` +
      `von ${report.budget.freeDailyNeurons})`,
  )
  lines.push('')
  lines.push('## Übersicht', '')
  lines.push(
    '| Modell | Status | Titel | Zutaten P | Zutaten R | Menge | Einheit | ' +
      'Schritte Soll/Ist | Fehlend | Falsch | Erfunden | Fremdmaterial in Schritten | ' +
      'Latenz ms | Tokens in/out | Neuronen |',
  )
  lines.push(
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
  )
  for (const outcome of report.results) {
    const metrics = outcome.metrics
    const status = statusLabel(outcome.status)
    if (!metrics) {
      lines.push(
        `| ${outcome.label} | ${status} | – | – | – | – | – | – | – | – | – | – | ` +
          `${outcome.latencyMs} | ${outcome.usage.promptTokens ?? '–'}/${
            outcome.usage.completionTokens ?? '–'
          } | ${outcome.estimatedNeurons ?? '–'} |`,
      )
      continue
    }
    const title = metrics.title.exact ? 'exakt' : metrics.title.contains ? 'enthält' : '–'
    lines.push(
      `| ${outcome.label} | ${status} | ${title} | ` +
        `${formatPercent(metrics.ingredients.precision)} | ` +
        `${formatPercent(metrics.ingredients.recall)} | ` +
        `${formatPercent(metrics.ingredients.quantityAccuracy)} | ` +
        `${formatPercent(metrics.ingredients.unitAccuracy)} | ` +
        `${metrics.steps.expectedCount}/${metrics.steps.detectedCount} | ` +
        `${metrics.ingredients.missing.length} | ${metrics.ingredients.wrong.length} | ` +
        `${metrics.ingredients.invented.length} | ${metrics.steps.withForeignMaterial} | ` +
        `${outcome.latencyMs} | ${outcome.usage.promptTokens ?? '–'}/${
          outcome.usage.completionTokens ?? '–'
        } | ${outcome.estimatedNeurons ?? '–'} |`,
    )
  }
  lines.push('')
  lines.push('## Modelldetails', '')
  for (const outcome of report.results) {
    lines.push(...formatModelSection(outcome))
  }
  lines.push('## Ground Truth (Soll)', '')
  lines.push(`- Titel: ${mdCell(report.groundTruth.title) || '–'}`)
  lines.push(
    `- Zutaten: ${report.groundTruth.ingredients.length} · Schritte: ` +
      `${report.groundTruth.steps.length} · Notizen: ${
        report.groundTruth.notes.trim() ? 'vorhanden' : 'leer'
      }`,
  )
  lines.push(
    `- Darf nicht erfunden werden: ${listOrDash(report.groundTruth.mustNotInvent)}`,
  )
  lines.push('')
  lines.push('## API-Unterschiede der verglichenen Modelle', '')
  for (const model of report.models) {
    lines.push(
      `- **${model.label}** (\`${model.id}\`, ${model.api}): ${model.apiNote} ` +
        `Feld für das Ausgabelimit: \`${model.maxTokensField}\`.`,
    )
  }
  lines.push('')
  lines.push(
    '> Alle Rezepttexte in dieser Datei stammen aus privaten Eingaben. Diese Datei ' +
      'liegt außerhalb des Repositories und darf nicht committet werden.',
  )
  return `${lines.join('\n')}\n`
}

function persistResults(): void {
  if (!RUN_ENABLED || results.length === 0) return
  try {
    mkdirSync(OUTPUT_DIR, { recursive: true })
    const report = buildReport()
    writeFileSync(
      join(OUTPUT_DIR, 'photo-ocr-compare.json'),
      `${JSON.stringify(report, null, 2)}\n`,
      'utf8',
    )
    writeFileSync(join(OUTPUT_DIR, 'photo-ocr-compare.md'), formatMarkdown(report), 'utf8')
  } catch (error) {
    // Berichtsspeicherung ist ein Konfigurationsproblem; der Testlauf bleibt
    // auswertbar. Der Fehler wird sichtbar gemeldet, aber nicht als Rezepttext.
    console.error(
      `[photo-ocr-compare] Bericht konnte nicht unter ${OUTPUT_DIR} geschrieben werden: ${describeError(
        error,
      )}`,
    )
  }
}

function printConsoleSummary(): void {
  console.info('[photo-ocr-compare] Ergebnis (Details nur in der Berichtsdatei):')
  for (const outcome of results) {
    const metrics = outcome.metrics
    if (!metrics) {
      console.info(`  - ${outcome.label}: ${statusLabel(outcome.status)}`)
      continue
    }
    console.info(
      `  - ${outcome.label}: Zutaten P ${formatPercent(metrics.ingredients.precision)} / ` +
        `R ${formatPercent(metrics.ingredients.recall)} · ` +
        `Menge ${formatPercent(metrics.ingredients.quantityAccuracy)} / ` +
        `Einheit ${formatPercent(metrics.ingredients.unitAccuracy)} · ` +
        `Schritte ${metrics.steps.expectedCount}/${metrics.steps.detectedCount} · ` +
        `fehlend ${metrics.ingredients.missing.length} · ` +
        `falsch ${metrics.ingredients.wrong.length} · ` +
        `erfunden ${metrics.ingredients.invented.length} · ` +
        `${outcome.usage.promptTokens ?? '–'}/${outcome.usage.completionTokens ?? '–'} Tokens · ` +
        `${outcome.estimatedNeurons ?? '–'} Neuronen · ${outcome.latencyMs} ms`,
    )
  }
  console.info(`[photo-ocr-compare] Markdown: ${join(OUTPUT_DIR, 'photo-ocr-compare.md')}`)
  console.info(`[photo-ocr-compare] JSON: ${join(OUTPUT_DIR, 'photo-ocr-compare.json')}`)
}

// ===========================================================================
// Suite
// ===========================================================================

describe.skipIf(!RUN_ENABLED)('Foto-OCR-Modellvergleich (Cloudflare Workers AI, opt-in)', () => {
  beforeAll(() => {
    expect(RUN_ENABLED, skipReason()).toBe(true)
    expect(MODELS.length, 'Es sollen genau drei Modelle verglichen werden.').toBe(3)
    mkdirSync(OUTPUT_DIR, { recursive: true })
    if (!OFFLINE_RAW) {
      const bytes = readFileSync(IMAGE_PATH)
      imageBytes = bytes.length
      imageMime = detectImageMime(bytes, IMAGE_PATH)
      imageDataUri = `data:${imageMime};base64,${bytes.toString('base64')}`
    }
    console.info(
      `[photo-ocr-compare] Start: ${MODELS.length} Modelle, je 1 Aufruf, Timeout ${
        REQUEST_TIMEOUT_MS / 1000
      } s, Ausgabe unter ${OUTPUT_DIR}.`,
    )
  })

  for (const spec of MODELS) {
    it(`vergleicht ${spec.label} (genau ein Aufruf)`, async () => {
      // Genau ein Aufruf, keine Wiederholung, keine automatische Alternativroute.
      const outcome = await runModel(spec)
      results.push(outcome)
      persistResults()
      console.info(
        `[photo-ocr-compare] ${spec.label}: ${statusLabel(outcome.status)} (${outcome.latencyMs} ms)`,
      )
    }, MODEL_CALL_TIMEOUT_MS)
  }

  it('mindestens ein Modell war auswertbar', () => {
    const evaluable = results.filter((outcome) => outcome.status === 'ok').length
    expect(
      evaluable,
      `Kein Modell auswertbar: ${results.length} Aufrufe, ` +
        `${results.length - evaluable} Fehler. Zugangsdaten, Kontingent, Modell-` +
        'verfügbarkeit und Rohantworten prüfen.',
    ).toBeGreaterThan(0)
  })

  afterAll(() => {
    if (results.length === 0) return
    persistResults()
    printConsoleSummary()
  })
})

if (!RUN_ENABLED) {
  // Einmalige, nicht-irritierende Notiz statt Fehler: Der Skip ist beabsichtigt.
  console.info(`[photo-ocr-compare] Übersprungen: ${skipReason()}`)
}
