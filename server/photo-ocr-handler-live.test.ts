/*
 * Küchenrunde – Live-Integrationstest der Foto-Erkennungs-Function
 * Copyright (C) 2026 openCook Web contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Dieser Opt-in-Test führt den echten Handler aus
 * `functions/api/recipe-ocr.ts` aus – inklusive Body-Limit, Seitenprüfung,
 * Prompt-Aufbau, Modellaufruf, JSON-Extraktion und Vertragsvalidierung – und
 * ersetzt nur zwei Randbedingungen der Cloudflare-Pages-Runtime:
 *
 *  1. `env.AI.run` wird über die offizielle Workers-AI-REST-API mit demselben
 *     Eingabeobjekt aufgerufen, das das Binding erhalten würde. Der Handler
 *     bleibt unverändert.
 *  2. Die Supabase-Haushaltsprüfung ist gemockt, damit für den Test keine
 *     Familien-Zugangsdaten nötig sind und keine echten Daten verändert
 *     werden. Der Produktionspfad ist durch die Unit-Tests in
 *     `functions/api/recipe-ocr.test.ts` abgedeckt; der veröffentlichte
 *     Endpunkt verlangt zusätzlich ein gültiges Haushalts-Token.
 *
 * Aufruf (nur mit ausdrücklicher Freigabe und unter Beachtung des
 * Free-Tier-Kontingents):
 *
 *   CLOUDFLARE_ACCOUNT_ID=... CLOUDFLARE_API_TOKEN=... \
 *     pnpm vitest run server/photo-ocr-handler-live.test.ts
 *
 * Ohne diese Variablen wird die Suite vollständig übersprungen. Es werden
 * ausschließlich synthetische Fixtures verwendet; Fotos und Rezeptinhalte
 * werden nicht gespeichert oder geloggt.
 */

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'
import {
  PHOTO_OCR_CONTRACT_VERSION,
  PHOTO_OCR_MODEL,
  validateOcrPageReports,
  validateOcrRecipe,
} from '../src/import/photo-ocr'
import {
  handleRecipeOcr,
  resetPhotoOcrRateLimits,
  type Env,
} from '../functions/api/recipe-ocr'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const FIXTURE_DIR = join(REPO_ROOT, 'tests', 'fixtures', 'photo-ocr')

const ACCOUNT_ID = (process.env.CLOUDFLARE_ACCOUNT_ID ?? '').trim()
const API_TOKEN = (process.env.CLOUDFLARE_API_TOKEN ?? '').trim()
const LIVE_RUN_CONFIGURED = ACCOUNT_ID.length > 0 && API_TOKEN.length > 0

const API_URL = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(
  ACCOUNT_ID,
)}/ai/run/${PHOTO_OCR_MODEL}`
const SKIP_REASON =
  'CLOUDFLARE_ACCOUNT_ID und/oder CLOUDFLARE_API_TOKEN fehlen – Live-Lauf ausstehend.'

interface RestCallUsage {
  promptTokens: number | null
  completionTokens: number | null
  neurons: number | null
}

interface LiveCase {
  name: string
  file: string
  expectedTitle: string
}

const LIVE_CASES: LiveCase[] = [
  {
    name: 'gedrucktes Rezept durch den echten Handler',
    file: 'printed-basic.jpg',
    expectedTitle: 'Cremige Kürbis-Kokos-Suppe',
  },
  {
    name: 'handschriftliches Rezept durch den echten Handler',
    file: 'handwritten-basic.jpg',
    expectedTitle: 'Gedeckter Apfelkuchen',
  },
  {
    // Gegenprobe für die Aufbereitung: schwierige Handschrift, anderes Rezept.
    name: 'schwierige Handschrift als Gegenprobe',
    file: 'handwritten-hard.jpg',
    expectedTitle: 'Mohn-Zitronen-Kuchen',
  },
]

function imagePage(file: string) {
  const bytes = readFileSync(join(FIXTURE_DIR, file))
  return {
    mimeType: 'image/jpeg' as const,
    dataBase64: bytes.toString('base64'),
    width: 1654,
    height: 2339,
  }
}

/* ------------------------------------------------------------------ *
 * Optionale Qualitätsabnahme mit einem echten Familienfoto
 *
 * Das private Foto wird nie committet. Der Lauf ist nur aktiv, wenn
 * PHOTO_OCR_PRIVATE_IMAGE auf eine vorbereitete JPEG-Datei zeigt (wie im
 * Browser: EXIF-korrekt, lange Kante 2048 px). Optional lassen sich
 * Grundwahrheit und Schritt-Anforderungen als JSON übergeben.
 * ------------------------------------------------------------------ */

const PRIVATE_IMAGE = (process.env.PHOTO_OCR_PRIVATE_IMAGE ?? '').trim()
const PRIVATE_GROUND_TRUTH = (process.env.PHOTO_OCR_PRIVATE_GROUND_TRUTH ?? '').trim()
const PRIVATE_STEP_REQUIREMENTS = (process.env.PHOTO_OCR_PRIVATE_STEP_REQUIREMENTS ?? '').trim()
const PRIVATE_RUNS = Math.max(
  1,
  Math.min(5, Number(process.env.PHOTO_OCR_PRIVATE_RUNS ?? '1') || 1),
)
const PRIVATE_CONFIGURED = LIVE_RUN_CONFIGURED && PRIVATE_IMAGE.length > 0

function readPage(path: string) {
  const bytes = readFileSync(path)
  return { mimeType: 'image/jpeg' as const, dataBase64: bytes.toString('base64') }
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8')) as unknown
}

/** Vergleichsform für Prüfungen (klein, ohne Umlaute/Satzzeichen). */
function normalize(value: string): string {
  return value
    .toLocaleLowerCase('de')
    .replace(/ß/g, 'ss')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

interface StepRequirement {
  id: string
  label: string
  all: string[]
  optional?: boolean
}

function requirementSatisfied(
  requirement: StepRequirement,
  steps: readonly string[],
): boolean {
  const normalized = steps.map((step) => normalize(step)).join('\n')
  return requirement.all.every((pattern) => new RegExp(pattern, 'i').test(normalized))
}

function stepIndex(steps: readonly string[], pattern: RegExp): number {
  return steps.findIndex((step) => pattern.test(normalize(step)))
}

/** Prüft die im Auftrag genannten Qualitätskriterien am fertigen Rezept. */
function assertRecipeQuality(
  recipe: {
    title: string
    ingredients: Array<{ name: string }>
    steps: Array<{ text: string }>
  },
  context: string,
): void {
  const steps = recipe.steps.map((step) => step.text)
  const allText = normalize(steps.join('\n'))
  const ingredientNames = recipe.ingredients.map((ingredient) => normalize(ingredient.name))

  // 1. Rechtschreibung: der Herbstoff darf nicht als „Pfefferminte“ o. Ä.
  //    erscheinen; „Pfefferminze“ (oder eine belegte Variante wie
  //    „Pfefferminzblätter“) muss vorkommen.
  expect(allText, `${context}: falsche Schreibweise „Pfefferminte“`).not.toContain(
    'pfefferminte',
  )
  expect(allText, `${context}: unvollständige Schreibweise „Pfefferminz“`).not.toMatch(
    /\bpfefferminz\b/,
  )
  expect(allText, `${context}: Pfefferminze fehlt`).toMatch(/pfefferminz/)

  // 2. Reihenfolge: Soße zubereiten, dann Joghurt, dann Fleisch zurück.
  const sauceIndex = stepIndex(
    steps,
    /(so(ss|ß)e|mischung).*(puri|anbrat|ablosch|lösch|kochen)/,
  )
  const yoghurtIndex = stepIndex(steps, /joghurt/)
  const reAddIndex = stepIndex(
    steps,
    /hahnchenbrust.*(wieder|zuruck|untermisch|vermisch)/,
  )
  const herbIndex = stepIndex(steps, /pfefferminz/)
  expect(sauceIndex, `${context}: Soßenschritt fehlt`).toBeGreaterThanOrEqual(0)
  expect(yoghurtIndex, `${context}: Joghurt-Schritt fehlt`).toBeGreaterThanOrEqual(0)
  expect(reAddIndex, `${context}: Fleisch wird nicht zurückgegeben`).toBeGreaterThanOrEqual(0)
  expect(sauceIndex, `${context}: Soße nach Fleisch-Rückführung`).toBeLessThan(reAddIndex)
  expect(yoghurtIndex, `${context}: Joghurt nach Fleisch-Rückführung`).toBeLessThan(reAddIndex)
  expect(herbIndex, `${context}: Pfefferminze wird nicht darübergestreut`).toBeGreaterThan(
    reAddIndex,
  )

  // 3. Vollständigkeit: alle wesentlichen Zutaten sind vorhanden.
  for (const required of ['hahnchenbrust', 'ingwer', 'zwiebel', 'joghurt', 'pfefferminz', 'basmatireis']) {
    expect(
      ingredientNames.some((name) => name.includes(required)),
      `${context}: Zutat „${required}“ fehlt`,
    ).toBe(true)
  }

  // 4. Keine erfundene Anrichte-Handlung: Die Vorlage enthält kein
  //    „anrichten“/„servieren“. (Die Grundwahrheit wird nur geprüft, wenn
  //    ein echter Handschriftfall vorliegt.)
  expect(allText, `${context}: erfundene Anrichte-Handlung`).not.toContain('anrichten')
}

/**
 * Workers-AI-Binding-Ersatz: ruft die offizielle REST-API mit exakt dem
 * Eingabeobjekt auf, das `env.AI.run(model, input)` erhalten würde, und gibt
 * das `result`-Objekt so zurück, wie es auch das Binding liefert.
 *
 * Der Transport läuft über `curl`, weil Node-`fetch` in dieser Umgebung bei
 * großen multimodalen Bodies sporadisch hängt (siehe Live-Trial). Für den
 * Handler ist das irrelevant: er übergibt denselben Input an `run()`.
 */
function createRestAiBinding(calls: RestCallUsage[]) {
  return {
    async run(model: string, input: unknown): Promise<unknown> {
      expect(model).toBe(PHOTO_OCR_MODEL)
      let bodyText: string
      try {
        bodyText = execFileSync(
          'curl',
          [
            '-sS',
            '--max-time',
            '240',
            '-X',
            'POST',
            API_URL,
            '-H',
            `Authorization: Bearer ${API_TOKEN}`,
            '-H',
            'Content-Type: application/json',
            '--data-binary',
            '@-',
          ],
          {
            input: JSON.stringify(input),
            encoding: 'utf8',
            maxBuffer: 16 * 1024 * 1024,
            timeout: 260_000,
          },
        )
      } catch (cause) {
        throw new Error(`Workers-AI-Aufruf fehlgeschlagen: ${(cause as Error).message}`)
      }
      const parsed = JSON.parse(bodyText) as {
        success?: boolean
        errors?: unknown
        result?: {
          usage?: { prompt_tokens?: number; completion_tokens?: number; neurons?: number }
        }
      }
      if (parsed.success === false || !parsed.result) {
        throw new Error(`Workers AI meldet einen Fehler: ${JSON.stringify(parsed.errors)}`)
      }
      calls.push({
        promptTokens: parsed.result.usage?.prompt_tokens ?? null,
        completionTokens: parsed.result.usage?.completion_tokens ?? null,
        neurons: parsed.result.usage?.neurons ?? null,
      })
      return parsed.result
    },
  }
}

/**
 * Baut eine echte HTTP-Anfrage an den Handler. Die Anmeldung ist über
 * `deps.authorize` gemockt; der Handler selbst prüft weiterhin Methode,
 * Origin, Content-Type, Body-Limit und alle Seitenregeln.
 */
function buildRequest(file: string): Request {
  const page = imagePage(file)
  return new Request('https://kuechenrunde.pages.dev/api/recipe-ocr', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: 'https://kuechenrunde.pages.dev',
      Authorization: 'Bearer live-trial-token',
    },
    body: JSON.stringify({ pages: [page] }),
  })
}

describe.skipIf(!LIVE_RUN_CONFIGURED)(
  'Foto-OCR Live-Integration (echter Pages-Function-Handler)',
  () => {
    beforeAll(() => {
      resetPhotoOcrRateLimits()
    })

    for (const liveCase of LIVE_CASES) {
      it(liveCase.name, async () => {
        const aiCalls: RestCallUsage[] = []
        const env: Env = { AI: createRestAiBinding(aiCalls) }
        const response = await handleRecipeOcr(buildRequest(liveCase.file), env, {
          authorize: async () => ({ id: 'live-trial-member', email: null }),
        })

        expect(response.status, await response.clone().text()).toBe(200)
        const body = (await response.json()) as {
          ok?: boolean
          contractVersion?: number
          recipe?: unknown
          pages?: unknown
          usage?: { promptTokens?: number | null; completionTokens?: number | null }
        }
        expect(body.ok).toBe(true)
        expect(body.contractVersion).toBe(PHOTO_OCR_CONTRACT_VERSION)
        // Zwei Aufrufe: Erkennung (mit Bild) und Aufbereitung (text-only).
        expect(aiCalls).toHaveLength(2)
        expect(aiCalls[0]!.promptTokens ?? 0).toBeGreaterThan(0)
        expect(aiCalls[1]!.promptTokens ?? 0).toBeGreaterThan(0)
        expect(body.usage?.promptTokens ?? 0).toBeGreaterThan(aiCalls[0]!.promptTokens ?? 0)

        const recipe = validateOcrRecipe(body.recipe)
        const pages = validateOcrPageReports(body.pages, 1)
        expect(recipe.recognized).toBe(true)
        expect(recipe.ingredients.length).toBeGreaterThan(0)
        expect(recipe.steps.length).toBeGreaterThan(0)
        expect(pages).toHaveLength(1)
        expect(recipe.title.toLocaleLowerCase('de')).toContain(
          liveCase.expectedTitle.toLocaleLowerCase('de'),
        )

        for (const [index, step] of recipe.steps.entries()) {
          console.log(`  ${index + 1}. ${step.text}`)
        }

        const recognition = aiCalls[0]!
        const assembly = aiCalls[1]!
        const totalNeurons = (recognition.neurons ?? 0) + (assembly.neurons ?? 0)
        console.log(
          `[handler-live] ${liveCase.file}: ${recipe.title} · ${recipe.ingredients.length} Zutaten · ` +
            `${recipe.steps.length} Schritte · Erkennung ${recognition.promptTokens} prompt / ` +
            `${recognition.completionTokens} completion · Aufbereitung ${assembly.promptTokens} prompt / ` +
            `${assembly.completionTokens} completion · ${totalNeurons.toFixed(2)} Neuronen`,
        )
      }, 180_000)
    }

    for (let run = 1; PRIVATE_CONFIGURED && run <= PRIVATE_RUNS; run += 1) {
      it(`echtes Familienfoto: Qualitätskriterien (Lauf ${run}/${PRIVATE_RUNS})`, async () => {
        const aiCalls: RestCallUsage[] = []
        const env: Env = { AI: createRestAiBinding(aiCalls) }
        const request = new Request('https://kuechenrunde.pages.dev/api/recipe-ocr', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Origin: 'https://kuechenrunde.pages.dev',
            Authorization: 'Bearer live-trial-token',
          },
          body: JSON.stringify({ pages: [readPage(PRIVATE_IMAGE)] }),
        })
        const response = await handleRecipeOcr(request, env, {
          authorize: async () => ({ id: 'live-trial-member', email: null }),
        })
        expect(response.status, await response.clone().text()).toBe(200)
        const body = (await response.json()) as { recipe?: unknown }
        const recipe = validateOcrRecipe(body.recipe)
        const steps = recipe.steps.map((step) => step.text)

        console.log(
          `[handler-live-private] ${recipe.title} · ${recipe.ingredients.length} Zutaten · ` +
            `${recipe.steps.length} Schritte · ${
              aiCalls.reduce((sum, call) => sum + (call.neurons ?? 0), 0).toFixed(2)
            } Neuronen`,
        )
        console.log(
          `  Zutaten: ${recipe.ingredients
            .map((ingredient) =>
              [ingredient.quantity, ingredient.unit, ingredient.name]
                .filter((part) => part.trim())
                .join(' '),
            )
            .join(' | ')}`,
        )
        for (const [index, step] of steps.entries()) {
          console.log(`  ${index + 1}. ${step}${recipe.steps[index]?.uncertain ? ' (unsicher)' : ''}`)
        }

        assertRecipeQuality(recipe, `privates Rezept, Lauf ${run}`)

        if (PRIVATE_STEP_REQUIREMENTS.length > 0 && existsSync(PRIVATE_STEP_REQUIREMENTS)) {
          const file = readJson(PRIVATE_STEP_REQUIREMENTS) as {
            requirements?: StepRequirement[]
          }
          for (const requirement of file.requirements ?? []) {
            if (requirement.optional) continue
            expect(
              requirementSatisfied(requirement, steps),
              `Anforderung „${requirement.label}“ nicht erfüllt`,
            ).toBe(true)
          }
        }
        if (PRIVATE_GROUND_TRUTH.length > 0 && existsSync(PRIVATE_GROUND_TRUTH)) {
          const groundTruth = readJson(PRIVATE_GROUND_TRUTH) as {
            mustNotInvent?: string[]
          }
          const haystack = normalize(
            [...recipe.ingredients.map((ingredient) => ingredient.name), ...steps].join(' '),
          )
          for (const forbidden of groundTruth.mustNotInvent ?? []) {
            expect(haystack, `erfundene Zutat „${forbidden}“`).not.toContain(
              normalize(forbidden),
            )
          }
        }
      }, 420_000)
    }
  },
)

if (!LIVE_RUN_CONFIGURED) {
  console.info(`[photo-ocr-handler-live] ${SKIP_REASON}`)
}
