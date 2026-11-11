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
import { readFileSync } from 'node:fs'
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
  },
)

if (!LIVE_RUN_CONFIGURED) {
  console.info(`[photo-ocr-handler-live] ${SKIP_REASON}`)
}
