/*
 * Küchenrunde – Live-Testharness für den Foto-/Scan-Import
 * Copyright (C) 2026 openCook Web contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Misst die tatsächliche Erkennungsqualität des Workers-AI-Modells
 * `@cf/meta/llama-4-scout-17b-16e-instruct` gegen die synthetischen Fixtures
 * unter `tests/fixtures/photo-ocr/`.
 *
 * Der Lauf ist absichtlich ein Opt-in:
 *   - Ohne `CLOUDFLARE_ACCOUNT_ID` und `CLOUDFLARE_API_TOKEN` wird die Suite
 *     komplett übersprungen (`describe.skipIf`), es entstehen keine Kosten.
 *   - Zugangsdaten werden ausschließlich aus der Umgebung gelesen und niemals
 *     geloggt, in den Bericht geschrieben oder in Fehlermeldungen ausgegeben.
 *   - Pro Lauf sind höchstens `MAX_MODEL_CALLS` Modellaufrufe erlaubt
 *     (Free-Tier: 10.000 Neuronen/Tag), ein Aufruf darf bis zu 120 s dauern.
 *
 * Aufruf:
 *   CLOUDFLARE_ACCOUNT_ID=... CLOUDFLARE_API_TOKEN=... \
 *     pnpm vitest run server/photo-ocr-trial.test.ts
 *
 * Ergebnisbericht (nur synthetische Daten, keine Secrets):
 *   docs/photo-ocr-trial-results.json
 */

import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  OCR_SYSTEM_PROMPT,
  PHOTO_OCR_CONTRACT_VERSION,
  applyOcrConsistencyChecks,
  PHOTO_OCR_MAX_OUTPUT_TOKENS,
  PHOTO_OCR_MAX_PAGES,
  PHOTO_OCR_MODEL,
  PHOTO_OCR_TEMPERATURE,
  buildOcrUserPrompt,
  extractJsonObject,
  validateOcrPageReports,
  validateOcrRecipe,
  type OcrIngredient,
  type OcrPageReport,
  type OcrRecipe,
} from '../src/import/photo-ocr'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const FIXTURE_DIR = join(REPO_ROOT, 'tests', 'fixtures', 'photo-ocr')
const GROUND_TRUTH_PATH = join(FIXTURE_DIR, 'ground-truth.json')
const REPORT_PATH = join(REPO_ROOT, 'docs', 'photo-ocr-trial-results.json')

const API_BASE = 'https://api.cloudflare.com/client/v4'
const REQUEST_TIMEOUT_MS = 120_000
const MAX_RAW_RESPONSE_CHARS = 4_096
const MAX_MODEL_CALLS = 8

/** Kostenformel des Workers-AI-Free-Tiers (Neuronen pro Million Tokens). */
const NEURONS_PER_MILLION_INPUT = 24_545
const NEURONS_PER_MILLION_OUTPUT = 77_273
const FREE_DAILY_NEURON_BUDGET = 10_000

const ACCOUNT_ID = (process.env.CLOUDFLARE_ACCOUNT_ID ?? '').trim()
const API_TOKEN = (process.env.CLOUDFLARE_API_TOKEN ?? '').trim()
/**
 * Optionaler Offline-Auswertungsmodus: Wurden die Modell-Rohantworten bereits
 * mit `curl` geholt und unter diesem Verzeichnis abgelegt, wertet der Harness
 * nur noch aus und macht keine Netzwerkaufrufe. Das entkoppelt die
 * Qualitätsmessung von Node-Fetch-Flakiness und spart Kontingent.
 */
const RAW_DIR = (process.env.PHOTO_OCR_RAW_DIR ?? '').trim()
const OFFLINE_RAW = RAW_DIR.length > 0
const LIVE_RUN_CONFIGURED =
  (ACCOUNT_ID.length > 0 && API_TOKEN.length > 0) || OFFLINE_RAW

const API_URL = `${API_BASE}/accounts/${encodeURIComponent(ACCOUNT_ID)}/ai/run/${PHOTO_OCR_MODEL}`
const SKIP_REASON =
  'CLOUDFLARE_ACCOUNT_ID/CLOUDFLARE_API_TOKEN bzw. PHOTO_OCR_RAW_DIR fehlen – Live-Lauf ausstehend.'

// --------------------------------------------------------------------------
// Ground Truth
// --------------------------------------------------------------------------

interface GroundTruthIngredient {
  group?: string
  quantity: string
  unit: string
  name: string
}

interface ExpectedUncertainty {
  reference: string
  kind: string
  expectUncertain: boolean
  mustNotInvent: string[]
}

interface GroundTruthCase {
  title: string
  servingsText: string
  prepTime: string
  cookTime: string
  totalTime: string
  ingredients: GroundTruthIngredient[]
  steps: string[]
  expectedUncertainties: ExpectedUncertainty[]
  notes?: string
}

interface GroundTruthFile {
  version: number
  fixtures: Record<string, GroundTruthCase>
  combined: Record<string, GroundTruthCase & { pages: string[] }>
}

interface TrialCase {
  name: string
  files: string[]
  /** `fixtures:<datei>` oder `combined:<schluessel>` */
  groundTruthSource: string
}

/**
 * Sieben Fälle, sieben Modellaufrufe. Die beiden Seiten des mehrseitigen
 * Rezepts werden bewusst in EINER Anfrage in der Reihenfolge Seite 1, Seite 2
 * übergeben, damit die Zusammenführung getestet wird.
 */
const TRIAL_CASES: TrialCase[] = [
  { name: 'printed-basic', files: ['printed-basic.jpg'], groundTruthSource: 'fixtures:printed-basic.jpg' },
  { name: 'printed-photo', files: ['printed-photo.jpg'], groundTruthSource: 'fixtures:printed-photo.jpg' },
  {
    name: 'handwritten-basic',
    files: ['handwritten-basic.jpg'],
    groundTruthSource: 'fixtures:handwritten-basic.jpg',
  },
  {
    name: 'handwritten-hard',
    files: ['handwritten-hard.jpg'],
    groundTruthSource: 'fixtures:handwritten-hard.jpg',
  },
  {
    name: 'multi-page-kombiniert',
    files: ['multi-page-1.jpg', 'multi-page-2.jpg'],
    groundTruthSource: 'combined:multi-page',
  },
  {
    name: 'unclear-quantities',
    files: ['unclear-quantities.jpg'],
    groundTruthSource: 'fixtures:unclear-quantities.jpg',
  },
  {
    name: 'printed-abbreviations',
    files: ['printed-abbreviations.jpg'],
    groundTruthSource: 'fixtures:printed-abbreviations.jpg',
  },
]

function loadGroundTruth(): GroundTruthFile {
  const parsed = JSON.parse(readFileSync(GROUND_TRUTH_PATH, 'utf8')) as GroundTruthFile
  if (!parsed || typeof parsed !== 'object' || !parsed.fixtures || !parsed.combined) {
    throw new Error(`Ground Truth ist unvollständig: ${GROUND_TRUTH_PATH}`)
  }
  return parsed
}

function groundTruthFor(groundTruth: GroundTruthFile, source: string): GroundTruthCase {
  if (source.startsWith('combined:')) {
    const key = source.slice('combined:'.length)
    const entry = groundTruth.combined[key]
    if (!entry) throw new Error(`Ground Truth fehlt: combined.${key}`)
    return entry
  }
  const file = source.slice('fixtures:'.length)
  const entry = groundTruth.fixtures[file]
  if (!entry) throw new Error(`Ground Truth fehlt: fixtures.${file}`)
  return entry
}

// --------------------------------------------------------------------------
// Kleine, nachvollziehbare Metrik-Helfer
// --------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value
  return `${value.slice(0, maxLength)}\n… [gekürzt, ${value.length - maxLength} Zeichen entfernt]`
}

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

/** Sehr leichte Plural-/Endungsnormalisierung, damit z. B. Äpfel ≈ Apfel gilt. */
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
  return value.toLowerCase().replace(/\s+/g, '').replace(/,/g, '.')
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

function timesMatch(expected: string, detected: string): boolean {
  if (!expected.trim() || !detected.trim()) return false
  const expectedNorm = normalize(expected)
  const detectedNorm = normalize(detected)
  if (
    expectedNorm === detectedNorm ||
    detectedNorm.includes(expectedNorm) ||
    expectedNorm.includes(detectedNorm)
  ) {
    return true
  }
  const expectedNumbers = expected.match(/\d+/g) ?? []
  const detectedNumbers = new Set(detected.match(/\d+/g) ?? [])
  return expectedNumbers.length > 0 && expectedNumbers.every((number) => detectedNumbers.has(number))
}

function servingsCorrect(expected: string, detected: string): boolean | null {
  if (!expected.trim()) return null
  const expectedNorm = normalize(expected)
  const detectedNorm = normalize(detected)
  if (!detectedNorm) return false
  if (
    expectedNorm === detectedNorm ||
    detectedNorm.includes(expectedNorm) ||
    expectedNorm.includes(detectedNorm)
  ) {
    return true
  }
  const expectedNumbers: string[] = expected.match(/\d+/g) ?? []
  const detectedNumbers: string[] = detected.match(/\d+/g) ?? []
  return expectedNumbers.length > 0 && expectedNumbers.every((number) => detectedNumbers.includes(number))
}

function jaccardSimilarity(left: string, right: string): number {
  const leftTokens = new Set(tokenize(left))
  const rightTokens = new Set(tokenize(right))
  if (leftTokens.size === 0 && rightTokens.size === 0) return 1
  if (leftTokens.size === 0 || rightTokens.size === 0) return 0
  let intersection = 0
  for (const token of leftTokens) {
    if (rightTokens.has(token)) intersection += 1
  }
  return intersection / (leftTokens.size + rightTokens.size - intersection)
}

/** Ein Schritt gilt als belegt, wenn er inhaltlich an die Ground Truth anschließt. */
function stepSupported(stepText: string, expectedSteps: string[]): boolean {
  if (expectedSteps.length === 0) return true
  const expectedTokenSet = new Set(tokenize(expectedSteps.join(' ')))
  const stepTokens = tokenize(stepText).filter((token) => token.length > 3)
  if (stepTokens.length === 0) return true
  const supported = stepTokens.filter((token) => expectedTokenSet.has(token)).length
  const supportRatio = supported / stepTokens.length
  return (
    supportRatio >= 0.5 ||
    expectedSteps.some((expectedStep) => jaccardSimilarity(stepText, expectedStep) >= 0.3)
  )
}

interface IngredientMatch {
  expectedIndex: number
  detectedIndex: number
  quantityOk: boolean
  unitOk: boolean
}

interface IngredientMatching {
  matches: IngredientMatch[]
  usedDetected: Set<number>
}

function matchIngredients(
  expectedIngredients: GroundTruthIngredient[],
  detectedIngredients: OcrIngredient[],
): IngredientMatching {
  const usedDetected = new Set<number>()
  const matches: IngredientMatch[] = []
  expectedIngredients.forEach((expected, expectedIndex) => {
    const detectedIndex = detectedIngredients.findIndex(
      (detected, index) => !usedDetected.has(index) && namesMatch(expected.name, detected.name),
    )
    if (detectedIndex < 0) return
    usedDetected.add(detectedIndex)
    matches.push({
      expectedIndex,
      detectedIndex,
      quantityOk: quantitiesMatch(expected.quantity, detectedIngredients[detectedIndex].quantity),
      unitOk: unitsMatch(expected.unit, detectedIngredients[detectedIndex].unit),
    })
  })
  return { matches, usedDetected }
}

function referenceKeywords(reference: string): string[] {
  const normalized = normalize(reference)
  return ['menge', 'einheit', 'temperatur', 'portion', 'zeit'].filter((keyword) =>
    normalized.includes(keyword),
  )
}

function uncertaintySearchText(recipe: OcrRecipe): string {
  return [
    ...recipe.uncertainties.map((entry) => `${entry.reference} ${entry.note}`),
    ...recipe.ingredients.filter((entry) => entry.uncertain).map((entry) => `${entry.name} ${entry.uncertainty}`),
    ...recipe.steps.filter((entry) => entry.uncertain).map((entry) => `${entry.text} ${entry.uncertainty}`),
  ].join(' | ')
}

interface UncertaintyEvaluation {
  expectedRequired: number
  covered: number
  missing: string[]
  detectedCount: number
  detectedReferences: string[]
  expectedFlags: Array<{
    reference: string
    kind: string
    required: boolean
    expectUncertain: boolean
    covered: boolean
  }>
}

function evaluateUncertainties(
  expected: ExpectedUncertainty[],
  recipe: OcrRecipe,
  matches: IngredientMatch[],
): UncertaintyEvaluation {
  const matchByExpected = new Map(matches.map((match) => [match.expectedIndex, match.detectedIndex]))
  const searchText = normalize(uncertaintySearchText(recipe))
  const hasNumber = (text: string, value: string): boolean =>
    new RegExp(`(^|\\D)${value}(\\D|$)`).test(text)

  const expectedFlags = expected.map((entry) => {
    const keywords = referenceKeywords(entry.reference)
    let covered = false

    const ingredientReference = /zutat\s+(\d+)/i.exec(entry.reference)
    const stepReference = /schritt\s+(\d+)/i.exec(entry.reference)

    if (ingredientReference) {
      const expectedIndex = Number(ingredientReference[1]) - 1
      const detectedIndex = matchByExpected.get(expectedIndex)
      const detected = detectedIndex === undefined ? undefined : recipe.ingredients[detectedIndex]
      if (detected) {
        covered =
          detected.uncertain ||
          (keywords.length > 0 &&
            keywords.every((keyword) => normalize(`${detected.uncertainty}`).includes(keyword)))
      }
      if (!covered && keywords.length > 0) {
        covered =
          keywords.every((keyword) => searchText.includes(keyword)) &&
          hasNumber(searchText, ingredientReference[1])
      }
    } else if (stepReference) {
      const expectedIndex = Number(stepReference[1]) - 1
      const detected = recipe.steps[expectedIndex]
      if (detected) {
        covered =
          detected.uncertain ||
          keywords.every((keyword) => normalize(`${detected.uncertainty} ${detected.text}`).includes(keyword))
      }
      if (!covered && keywords.length > 0) {
        covered =
          keywords.every((keyword) => searchText.includes(keyword)) &&
          hasNumber(searchText, stepReference[1])
      }
    } else {
      const digits = entry.reference.match(/\d+/g) ?? []
      covered =
        digits.every((digit) => hasNumber(searchText, digit)) &&
        keywords.every((keyword) => searchText.includes(keyword))
    }

    return {
      reference: entry.reference,
      kind: entry.kind,
      required: entry.expectUncertain,
      expectUncertain: entry.expectUncertain,
      covered,
    }
  })

  const requiredFlags = expectedFlags.filter((flag) => flag.required)
  return {
    expectedRequired: requiredFlags.length,
    covered: requiredFlags.filter((flag) => flag.covered).length,
    missing: requiredFlags.filter((flag) => !flag.covered).map((flag) => flag.reference),
    detectedCount: recipe.uncertainties.length,
    detectedReferences: recipe.uncertainties.map((entry) => entry.reference),
    expectedFlags,
  }
}

interface InventionEvaluation {
  inventedQuantities: string[]
  inventedUnits: string[]
  inventedTemperatures: string[]
  correctedUnits: string[]
}

/**
 * Prüft gezielt die Stellen, an denen das Modell laut Ground Truth NICHTS
 * erfinden darf. Die abstrakten `mustNotInvent`-Texte werden dabei in konkrete,
 * maschinell prüfbare Kriterien übersetzt.
 */
function evaluateInventions(
  expected: ExpectedUncertainty[],
  groundTruth: GroundTruthCase,
  recipe: OcrRecipe,
  matches: IngredientMatch[],
): InventionEvaluation {
  const matchByExpected = new Map(matches.map((match) => [match.expectedIndex, match.detectedIndex]))
  const expectedByIngredient = new Map<number, ExpectedUncertainty>()
  for (const entry of expected) {
    const reference = /zutat\s+(\d+)/i.exec(entry.reference)
    if (reference) expectedByIngredient.set(Number(reference[1]) - 1, entry)
  }

  const inventedQuantities: string[] = []
  const inventedUnits: string[] = []
  const correctedUnits: string[] = []

  groundTruth.ingredients.forEach((ingredient, expectedIndex) => {
    const expectedEntry = expectedByIngredient.get(expectedIndex)
    if (!expectedEntry) return
    const detectedIndex = matchByExpected.get(expectedIndex)
    const detected = detectedIndex === undefined ? undefined : recipe.ingredients[detectedIndex]
    if (!detected) {
      return
    }
    if (expectedEntry.expectUncertain && !ingredient.quantity.trim() && detected.quantity.trim()) {
      inventedQuantities.push(`${ingredient.name}: ${detected.quantity} ${detected.unit}`.trim())
    }
    if (expectedEntry.expectUncertain && !ingredient.unit.trim() && detected.unit.trim()) {
      inventedUnits.push(`${ingredient.name}: ${detected.unit}`)
    }
    if (
      /unplausibel/i.test(expectedEntry.kind) &&
      ingredient.unit.trim() &&
      detected.unit.trim() &&
      !unitsMatch(ingredient.unit, detected.unit)
    ) {
      correctedUnits.push(`${ingredient.name}: ${ingredient.unit} → ${detected.unit}`)
    }
  })

  const inventedTemperatures: string[] = []
  const temperatureEntry = expected.find(
    (entry) => /temperatur/i.test(entry.reference) && entry.expectUncertain,
  )
  if (temperatureEntry) {
    const stepReference = /schritt\s+(\d+)/i.exec(temperatureEntry.reference)
    const stepIndex = stepReference ? Number(stepReference[1]) - 1 : -1
    const detectedStep = stepIndex >= 0 ? recipe.steps[stepIndex] : undefined
    if (detectedStep && !detectedStep.uncertain && /\d{2,3}\s*°?\s*c/i.test(detectedStep.text)) {
      inventedTemperatures.push(detectedStep.text.slice(0, 160))
    }
  }

  return { inventedQuantities, inventedUnits, inventedTemperatures, correctedUnits }
}

// --------------------------------------------------------------------------
// Bewertung
// --------------------------------------------------------------------------

interface ApiUsage {
  promptTokens: number | null
  completionTokens: number | null
  totalTokens: number | null
}

interface CaseMetrics {
  title: { expected: string; detected: string; exact: boolean; contains: boolean }
  ingredients: {
    expected: number
    detected: number
    matched: number
    precision: number | null
    recall: number | null
    quantityAccuracy: number | null
    unitAccuracy: number | null
  }
  steps: { expected: number; detected: number; countDelta: number; textJaccard: number }
  servings: { expected: string; detected: string; correct: boolean | null }
  times: {
    expected: { prepTime: string; cookTime: string; totalTime: string }
    detected: { prepTime: string; cookTime: string; totalTime: string }
    matched: number
    total: number
  }
  uncertainties: UncertaintyEvaluation
  hallucinations: {
    ingredients: string[]
    steps: string[]
    inventedQuantities: string[]
    inventedUnits: string[]
    inventedTemperatures: string[]
    correctedUnits: string[]
  }
  usage: ApiUsage
  estimatedNeurons: number | null
}

function estimateNeurons(usage: ApiUsage): number | null {
  if (usage.promptTokens === null && usage.completionTokens === null) return null
  const inputNeurons = ((usage.promptTokens ?? 0) / 1_000_000) * NEURONS_PER_MILLION_INPUT
  const outputNeurons = ((usage.completionTokens ?? 0) / 1_000_000) * NEURONS_PER_MILLION_OUTPUT
  return Math.round((inputNeurons + outputNeurons) * 100) / 100
}

function evaluateCase(
  groundTruth: GroundTruthCase,
  recipe: OcrRecipe,
  usage: ApiUsage,
): CaseMetrics {
  const detectedIngredients = recipe.ingredients
  const { matches, usedDetected } = matchIngredients(groundTruth.ingredients, detectedIngredients)

  const matchedDetected = usedDetected.size
  const precision =
    detectedIngredients.length > 0 ? matchedDetected / detectedIngredients.length : null
  const recall = groundTruth.ingredients.length > 0 ? matches.length / groundTruth.ingredients.length : null
  const quantityAccuracy =
    matches.length > 0 ? matches.filter((match) => match.quantityOk).length / matches.length : null
  const unitAccuracy =
    matches.length > 0 ? matches.filter((match) => match.unitOk).length / matches.length : null

  const detectedTitle = recipe.title
  const expectedTitle = groundTruth.title
  const normalizedExpectedTitle = normalize(expectedTitle)
  const normalizedDetectedTitle = normalize(detectedTitle)
  const titleExact = normalizedExpectedTitle.length > 0 && normalizedExpectedTitle === normalizedDetectedTitle
  const titleContains =
    normalizedExpectedTitle.length > 0 &&
    (normalizedDetectedTitle.includes(normalizedExpectedTitle) ||
      normalizedExpectedTitle.includes(normalizedDetectedTitle))

  const expectedStepText = groundTruth.steps.join(' ')
  const detectedStepText = recipe.steps.map((step) => step.text).join(' ')
  const hallucinatedSteps = recipe.steps
    .filter((step) => !stepSupported(step.text, groundTruth.steps))
    .map((step) => step.text.slice(0, 160))

  const times: CaseMetrics['times'] = {
    expected: {
      prepTime: groundTruth.prepTime,
      cookTime: groundTruth.cookTime,
      totalTime: groundTruth.totalTime,
    },
    detected: {
      prepTime: recipe.prepTime,
      cookTime: recipe.cookTime,
      totalTime: recipe.totalTime,
    },
    matched: 0,
    total: 0,
  }
  const timeEntries: Array<[string, string]> = [
    [groundTruth.prepTime, recipe.prepTime],
    [groundTruth.cookTime, recipe.cookTime],
    [groundTruth.totalTime, recipe.totalTime],
  ]
  for (const [expected, detected] of timeEntries) {
    if (!expected.trim()) continue
    times.total += 1
    if (timesMatch(expected, detected)) times.matched += 1
  }

  const uncertainties = evaluateUncertainties(groundTruth.expectedUncertainties, recipe, matches)
  const inventions = evaluateInventions(groundTruth.expectedUncertainties, groundTruth, recipe, matches)
  const hallucinatedIngredients = detectedIngredients
    .filter((_, index) => !usedDetected.has(index))
    .map((ingredient) => ingredient.name)

  return {
    title: { expected: expectedTitle, detected: detectedTitle, exact: titleExact, contains: titleContains },
    ingredients: {
      expected: groundTruth.ingredients.length,
      detected: detectedIngredients.length,
      matched: matches.length,
      precision,
      recall,
      quantityAccuracy,
      unitAccuracy,
    },
    steps: {
      expected: groundTruth.steps.length,
      detected: recipe.steps.length,
      countDelta: recipe.steps.length - groundTruth.steps.length,
      textJaccard: jaccardSimilarity(expectedStepText, detectedStepText),
    },
    servings: {
      expected: groundTruth.servingsText,
      detected: recipe.servingsText,
      correct: servingsCorrect(groundTruth.servingsText, recipe.servingsText),
    },
    times,
    uncertainties,
    hallucinations: {
      ingredients: hallucinatedIngredients,
      steps: hallucinatedSteps,
      ...inventions,
    },
    usage,
    estimatedNeurons: estimateNeurons(usage),
  }
}

// --------------------------------------------------------------------------
// Workers-AI-REST-Aufruf
// --------------------------------------------------------------------------

interface ModelResponse {
  text: string
  usage: ApiUsage
  latencyMs: number
}

/**
 * Liest eine zuvor mit `curl` geholte Workers-AI-Rohantwort aus
 * `${PHOTO_OCR_RAW_DIR}/<seite1>+<seite2>.json`. Erwartet
 * `{ latencyMs: number, body: unknown }`.
 */
function readOfflineModelResponse(files: string[]): ModelResponse {
  const file = join(RAW_DIR, `${files.join('+')}.json`)
  let stored: { latencyMs?: unknown; body?: unknown }
  try {
    stored = JSON.parse(readFileSync(file, 'utf8')) as { latencyMs?: unknown; body?: unknown }
  } catch (cause) {
    throw new Error(`Rohantwort ${file} fehlt oder ist kein JSON: ${describeError(cause)}`)
  }
  const body = stored.body
  if (!isRecord(body)) throw new Error(`Rohantwort ${file} enthält keinen Body.`)
  if (body.success === false) {
    throw new Error(
      `Workers AI meldet einen Fehler: ${truncate(JSON.stringify(body.errors ?? body), 400)}`,
    )
  }
  const result = isRecord(body.result) ? body.result : undefined
  if (!result) throw new Error(`Rohantwort ${file} enthält kein result-Objekt.`)
  const text = readResponseText(result)
  if (!text.trim()) throw new Error(`Rohantwort ${file} enthält keinen Text.`)
  return {
    text,
    usage: readApiUsage(result.usage),
    latencyMs: typeof stored.latencyMs === 'number' ? stored.latencyMs : 0,
  }
}

function readApiUsage(value: unknown): ApiUsage {
  const record = isRecord(value) ? value : {}
  const numberOrNull = (key: string): number | null => {
    const candidate = record[key]
    return typeof candidate === 'number' && Number.isFinite(candidate) ? candidate : null
  }
  return {
    promptTokens: numberOrNull('prompt_tokens'),
    completionTokens: numberOrNull('completion_tokens'),
    totalTokens: numberOrNull('total_tokens'),
  }
}

function readResponseText(result: Record<string, unknown>): string {
  if (typeof result.response === 'string') return result.response
  if (isRecord(result.response)) return JSON.stringify(result.response)
  if (typeof result.text === 'string') return result.text
  if (Array.isArray(result.choices) && result.choices.length > 0) {
    const first = result.choices[0]
    if (isRecord(first)) {
      if (typeof first.text === 'string') return first.text
      if (isRecord(first.message) && typeof first.message.content === 'string') {
        return first.message.content
      }
    }
  }
  throw new Error('Unbekanntes Antwortformat der Workers-AI-API.')
}

async function requestModel(files: string[]): Promise<ModelResponse> {
  if (!LIVE_RUN_CONFIGURED) throw new Error(SKIP_REASON)
  if (files.length > PHOTO_OCR_MAX_PAGES) {
    throw new Error(`Zu viele Seiten pro Anfrage (${files.length} > ${PHOTO_OCR_MAX_PAGES}).`)
  }
  if (OFFLINE_RAW) {
    return readOfflineModelResponse(files)
  }

  const content: Array<Record<string, unknown>> = [
    { type: 'text', text: buildOcrUserPrompt(files.length) },
  ]
  for (const file of files) {
    const bytes = readFileSync(join(FIXTURE_DIR, file))
    content.push({
      type: 'image_url',
      image_url: { url: `data:image/jpeg;base64,${bytes.toString('base64')}` },
    })
  }
  const messages = [
    { role: 'system', content: OCR_SYSTEM_PROMPT },
    { role: 'user', content },
  ]

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  const startedAt = Date.now()
  console.log(`[trial-debug] request start ${files.join('+')} body~${Math.round(JSON.stringify(messages).length / 1024)}KB`)
  try {
    let response: Response
    try {
      response = await fetch(API_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${API_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messages,
          temperature: PHOTO_OCR_TEMPERATURE,
          max_tokens: PHOTO_OCR_MAX_OUTPUT_TOKENS,
        }),
        signal: controller.signal,
      })
    } catch (error) {
      throw new Error(
        `Netzwerkfehler oder Timeout nach ${Date.now() - startedAt} ms: ${describeError(error)}`,
      )
    }
    const latencyMs = Date.now() - startedAt
    console.log(`[trial-debug] http ${response.status} after ${latencyMs}ms ${files.join('+')}`)
    const bodyText = await response.text()
    console.log(`[trial-debug] body read ${bodyText.length} chars after ${Date.now() - startedAt}ms`)
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} von der Workers-AI-API: ${truncate(bodyText, 400)}`)
    }
    let body: unknown
    try {
      body = JSON.parse(bodyText) as unknown
    } catch {
      throw new Error('Die Workers-AI-Antwort ist kein gültiges JSON.')
    }
    if (isRecord(body) && body.success === false) {
      throw new Error(
        `Workers AI meldet einen Fehler: ${truncate(JSON.stringify(body.errors ?? body), 400)}`,
      )
    }
    const result = isRecord(body) ? body.result : undefined
    if (!isRecord(result)) throw new Error('Die Workers-AI-Antwort enthält kein result-Objekt.')
    const text = readResponseText(result)
    if (!text.trim()) throw new Error('Die Workers-AI-Antwort enthält keinen Text.')
    return { text, usage: readApiUsage(result.usage), latencyMs }
  } finally {
    clearTimeout(timer)
  }
}

// --------------------------------------------------------------------------
// Ein Fall
// --------------------------------------------------------------------------

interface CaseOutcome {
  name: string
  files: string[]
  groundTruthSource: string
  status: 'ok' | 'format-error' | 'api-error'
  error?: string
  latencyMs: number
  rawResponse: string
  recipe: OcrRecipe | null
  pages: OcrPageReport[] | null
  pageError?: string
  metrics: CaseMetrics | null
}

async function runCase(trialCase: TrialCase, groundTruth: GroundTruthFile): Promise<CaseOutcome> {
  const startedAt = Date.now()
  const outcome: CaseOutcome = {
    name: trialCase.name,
    files: trialCase.files,
    groundTruthSource: trialCase.groundTruthSource,
    status: 'api-error',
    latencyMs: 0,
    rawResponse: '',
    recipe: null,
    pages: null,
    metrics: null,
  }

  try {
    console.log(`[trial-debug] runCase ${trialCase.name} request`)
    const model = await requestModel(trialCase.files)
    console.log(`[trial-debug] runCase ${trialCase.name} response`)
    outcome.latencyMs = model.latencyMs
    outcome.rawResponse = truncate(model.text, MAX_RAW_RESPONSE_CHARS)

    let parsed: unknown
    try {
      parsed = extractJsonObject(model.text)
    } catch (error) {
      outcome.status = 'format-error'
      outcome.error = `JSON-Extraktion fehlgeschlagen: ${describeError(error)} | Rohantwort (Anfang): ${truncate(model.text, 240).replace(/\s+/g, ' ')}`
      return outcome
    }

    let recipe: OcrRecipe
    try {
      // Produktionsverhalten: derselbe Handler ergänzt deterministische
      // Prüfungen (z. B. doppelte Zutaten mit unterschiedlichen Mengen).
      recipe = applyOcrConsistencyChecks(validateOcrRecipe(parsed))
    } catch (error) {
      outcome.status = 'format-error'
      outcome.error = `Schema-Validierung fehlgeschlagen: ${describeError(error)} | Rohantwort (Anfang): ${truncate(model.text, 240).replace(/\s+/g, ' ')}`
      return outcome
    }
    outcome.recipe = recipe
    console.log(`[trial-debug] runCase ${trialCase.name} schema ok`)

    try {
      const pagesValue = isRecord(parsed) ? parsed.pages : undefined
      outcome.pages = validateOcrPageReports(pagesValue, trialCase.files.length)
    } catch (error) {
      outcome.pageError = describeError(error)
    }

    outcome.metrics = evaluateCase(
      groundTruthFor(groundTruth, trialCase.groundTruthSource),
      recipe,
      model.usage,
    )
    outcome.status = 'ok'
    return outcome
  } catch (error) {
    outcome.latencyMs = Date.now() - startedAt
    outcome.error = describeError(error)
    return outcome
  }
}

// --------------------------------------------------------------------------
// Bericht
// --------------------------------------------------------------------------

interface TrialReport {
  status: 'live-run'
  generatedAt: string
  model: string
  contractVersion: number
  endpoint: { host: string; route: string }
  input: {
    fixtureDirectory: string
    groundTruth: string
    groundTruthSha256: string
    pagesPerCase: Record<string, number>
  }
  budget: {
    modelCalls: number
    maxModelCalls: number
    neuronsPerMillionInput: number
    neuronsPerMillionOutput: number
    freeDailyNeurons: number
    estimatedNeuronsTotal: number
    estimatedFreeDailyBudgetPercent: number
  }
  cases: CaseOutcome[]
  summary: {
    cases: number
    ok: number
    failed: number
    averageLatencyMs: number
    averageTitleContains: number | null
    averageIngredientPrecision: number | null
    averageIngredientRecall: number | null
    averageStepJaccard: number | null
    uncertaintyCovered: number
    uncertaintyRequired: number
    hallucinatedItems: number
    inventedFields: number
  }
  note: string
}

function average(values: number[]): number | null {
  if (values.length === 0) return null
  return Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 1000) / 1000
}

function groundTruthSha256(): string {
  return createHash('sha256').update(readFileSync(GROUND_TRUTH_PATH)).digest('hex')
}

function buildReport(results: CaseOutcome[]): TrialReport {
  const okResults = results.filter((result) => result.status === 'ok')
  const estimatedNeuronsTotal =
    Math.round(okResults.reduce((sum, result) => sum + (result.metrics?.estimatedNeurons ?? 0), 0) * 100) /
    100
  const uncertaintyRequired = okResults.reduce(
    (sum, result) => sum + (result.metrics?.uncertainties.expectedRequired ?? 0),
    0,
  )
  const uncertaintyCovered = okResults.reduce(
    (sum, result) => sum + (result.metrics?.uncertainties.covered ?? 0),
    0,
  )
  const hallucinatedItems = okResults.reduce((sum, result) => {
    const hallucinations = result.metrics?.hallucinations
    if (!hallucinations) return sum
    return (
      sum +
      hallucinations.ingredients.length +
      hallucinations.steps.length +
      hallucinations.inventedQuantities.length +
      hallucinations.inventedUnits.length +
      hallucinations.inventedTemperatures.length +
      hallucinations.correctedUnits.length
    )
  }, 0)
  const inventedFields = okResults.reduce((sum, result) => {
    const hallucinations = result.metrics?.hallucinations
    if (!hallucinations) return sum
    return (
      sum +
      hallucinations.inventedQuantities.length +
      hallucinations.inventedUnits.length +
      hallucinations.inventedTemperatures.length +
      hallucinations.correctedUnits.length
    )
  }, 0)
  const pagesPerCase: Record<string, number> = {}
  for (const trialCase of TRIAL_CASES) pagesPerCase[trialCase.name] = trialCase.files.length

  return {
    status: 'live-run',
    generatedAt: new Date().toISOString(),
    model: PHOTO_OCR_MODEL,
    contractVersion: PHOTO_OCR_CONTRACT_VERSION,
    endpoint: {
      host: 'api.cloudflare.com',
      route: `/client/v4/accounts/{account_id}/ai/run/${PHOTO_OCR_MODEL}`,
    },
    input: {
      fixtureDirectory: 'tests/fixtures/photo-ocr',
      groundTruth: 'tests/fixtures/photo-ocr/ground-truth.json',
      groundTruthSha256: groundTruthSha256(),
      pagesPerCase,
    },
    budget: {
      modelCalls: results.length,
      maxModelCalls: MAX_MODEL_CALLS,
      neuronsPerMillionInput: NEURONS_PER_MILLION_INPUT,
      neuronsPerMillionOutput: NEURONS_PER_MILLION_OUTPUT,
      freeDailyNeurons: FREE_DAILY_NEURON_BUDGET,
      estimatedNeuronsTotal,
      estimatedFreeDailyBudgetPercent:
        Math.round((estimatedNeuronsTotal / FREE_DAILY_NEURON_BUDGET) * 10000) / 100,
    },
    cases: results,
    summary: {
      cases: results.length,
      ok: okResults.length,
      failed: results.length - okResults.length,
      averageLatencyMs: okResults.length
        ? Math.round(okResults.reduce((sum, result) => sum + result.latencyMs, 0) / okResults.length)
        : 0,
      averageTitleContains: average(
        okResults
          .map((result) => result.metrics?.title.contains)
          .filter((value): value is boolean => typeof value === 'boolean')
          .map((value) => (value ? 1 : 0)),
      ),
      averageIngredientPrecision: average(
        okResults
          .map((result) => result.metrics?.ingredients.precision)
          .filter((value): value is number => typeof value === 'number'),
      ),
      averageIngredientRecall: average(
        okResults
          .map((result) => result.metrics?.ingredients.recall)
          .filter((value): value is number => typeof value === 'number'),
      ),
      averageStepJaccard: average(
        okResults
          .map((result) => result.metrics?.steps.textJaccard)
          .filter((value): value is number => typeof value === 'number'),
      ),
      uncertaintyCovered,
      uncertaintyRequired,
      hallucinatedItems,
      inventedFields,
    },
    note:
      'Nur synthetische Fixtures und Metriken, keine Zugangsdaten. Die Neuronenwerte sind ' +
      'aus den usage-Tokens geschätzt (24.545/M Input, 77.273/M Output); die tatsächliche ' +
      'Abrechnung kann abweichen. Das Tagesbudget von 10.000 Neuronen gilt für das Free-Tier.',
  }
}

function formatPercent(value: number | null): string {
  return value === null || !Number.isFinite(value) ? '–' : `${Math.round(value * 100)} %`
}

function formatMarkdownTable(results: CaseOutcome[]): string {
  const lines = [
    '| Fall | Status | Titel | Zutaten P / R | Menge / Einheit | Schritte (Soll/Ist) | Jaccard | Portionen | Zeiten | Unklarheiten | Halluzinationen/Erfindungen | Neuronen | ms |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
  ]
  for (const result of results) {
    const metrics = result.metrics
    const status = result.status === 'ok' ? 'ok' : result.status === 'format-error' ? 'Formatfehler' : 'API-Fehler'
    if (!metrics) {
      lines.push(
        `| ${result.name} | ${status} | – | – | – | – | – | – | – | – | – | – | ${result.latencyMs} |`,
      )
      continue
    }
    const title = metrics.title.exact ? 'exakt' : metrics.title.contains ? 'enthält' : '–'
    const stepsText = `${metrics.steps.expected}/${metrics.steps.detected}`
    const stepsCell = metrics.steps.countDelta === 0 ? stepsText : `${stepsText} (${metrics.steps.countDelta > 0 ? '+' : ''}${metrics.steps.countDelta})`
    const portions =
      metrics.servings.correct === null ? '–' : metrics.servings.correct ? 'ok' : 'abweichend'
    const timesText = metrics.times.total > 0 ? `${metrics.times.matched}/${metrics.times.total}` : '–'
    const uncertaintiesText = `${metrics.uncertainties.covered}/${metrics.uncertainties.expectedRequired}`
    const hallucinations = metrics.hallucinations
    const inventedCount =
      hallucinations.inventedQuantities.length +
      hallucinations.inventedUnits.length +
      hallucinations.inventedTemperatures.length +
      hallucinations.correctedUnits.length
    const hallucinationText = `${hallucinations.ingredients.length + hallucinations.steps.length}/${inventedCount}`
    const neurons = metrics.estimatedNeurons === null ? '–' : metrics.estimatedNeurons.toFixed(1)
    lines.push(
      `| ${result.name} | ${status} | ${title} | ${formatPercent(metrics.ingredients.precision)} / ${formatPercent(metrics.ingredients.recall)} | ${formatPercent(metrics.ingredients.quantityAccuracy)} / ${formatPercent(metrics.ingredients.unitAccuracy)} | ${stepsCell} | ${formatPercent(metrics.steps.textJaccard)} | ${portions} | ${timesText} | ${uncertaintiesText} | ${hallucinationText} | ${neurons} | ${result.latencyMs} |`,
    )
    if (metrics.uncertainties.missing.length > 0) {
      lines.push(
        `| ↳ fehlende Unklarheiten | | ${metrics.uncertainties.missing.join(', ')} | | | | | | | | | | |`,
      )
    }
    if (result.error) {
      lines.push(`| ↳ Fehler | | ${result.error.replace(/\|/g, '/').slice(0, 300)} | | | | | | | | | | |`)
    }
    if (result.pageError) {
      lines.push(`| ↳ Seitenbericht | | ${result.pageError.replace(/\|/g, '/').slice(0, 300)} | | | | | | | | | | |`)
    }
  }
  return lines.join('\n')
}

// --------------------------------------------------------------------------
// Suite
// --------------------------------------------------------------------------

const results: CaseOutcome[] = []

/**
 * Schreibt den Bericht nach jedem Fall neu. So sind Teilergebnisse auch dann
 * auswertbar, wenn ein späterer Modellaufruf hängt oder das Aufrufbudget endet.
 */
function persistResults(current: CaseOutcome[]): void {
  if (current.length === 0) return
  mkdirSync(dirname(REPORT_PATH), { recursive: true })
  writeFileSync(REPORT_PATH, `${JSON.stringify(buildReport(current), null, 2)}\n`, 'utf8')
}

describe.skipIf(!LIVE_RUN_CONFIGURED)('Foto-OCR Live-Trial (Cloudflare Workers AI)', () => {
  let groundTruth: GroundTruthFile

  beforeAll(() => {
    groundTruth = loadGroundTruth()
    expect(TRIAL_CASES.length, 'Testfälle überschreiten das Aufrufbudget.').toBeLessThanOrEqual(
      MAX_MODEL_CALLS,
    )
  })

  it('konfigurierter Live-Lauf startet', () => {
    // Wird nur im Live-Lauf ausgeführt und dokumentiert dann die Konfiguration,
    // ohne Zugangsdaten auszugeben.
    console.log(`Live-Lauf: ${TRIAL_CASES.length} Fälle, Modell ${PHOTO_OCR_MODEL}, Timeout ${REQUEST_TIMEOUT_MS / 1000}s je Aufruf.`)
  })

  for (const trialCase of TRIAL_CASES) {
    it(`${trialCase.name} (${trialCase.files.join(' + ')})`, async () => {
      const outcome = await runCase(trialCase, groundTruth)
      results.push(outcome)
      persistResults(results)
      if (outcome.status !== 'ok') {
        console.error(`[${trialCase.name}] ${outcome.status}: ${outcome.error ?? 'unbekannt'}`)
      }
    }, REQUEST_TIMEOUT_MS + 30_000)
  }

  it('mindestens ein Fall war auswertbar', () => {
    const okCount = results.filter((result) => result.status === 'ok').length
    expect(
      okCount,
      `Kein Fall auswertbar: ${results.length} Aufrufe, ${results.length - okCount} Fehler. ` +
        'Zugangsdaten, Kontingent und Modellverfügbarkeit prüfen.',
    ).toBeGreaterThan(0)
  })

  afterAll(() => {
    if (results.length === 0) return
    persistResults(results)
    const report = buildReport(results)
    console.log(`\n${formatMarkdownTable(results)}\n`)
    console.log(
      `Neuronen-Schätzung gesamt: ${report.budget.estimatedNeuronsTotal} ` +
        `(${report.budget.estimatedFreeDailyBudgetPercent} % des Free-Tier-Tagesbudgets von ` +
        `${FREE_DAILY_NEURON_BUDGET}).`,
    )
    console.log(`Bericht geschrieben: ${REPORT_PATH}`)
  })
})

if (!LIVE_RUN_CONFIGURED) {
  // Einmalige, nicht-irritierende Notiz statt Fehler: Der Skip ist beabsichtigt.
  console.info(`[photo-ocr-trial] ${SKIP_REASON}`)
}
