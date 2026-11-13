import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  MAX_REQUEST_BYTES,
  PHOTO_OCR_RATE_LIMITS,
  handleRecipeOcr,
  resetPhotoOcrRateLimits,
  type Env,
  type RecipeOcrDependencies,
} from './recipe-ocr'
import { HttpError } from '../lib/http'
import { PHOTO_AI_TRUNCATED_MESSAGE, type AiBinding } from '../lib/photo-ai'
import type { AuthorizedMember } from '../lib/supabase-auth'
import {
  OCR_ASSEMBLY_SYSTEM_PROMPT,
  PHOTO_OCR_CONTRACT_VERSION,
  PHOTO_OCR_ERROR_MESSAGES,
  PHOTO_OCR_MODEL,
  OCR_SYSTEM_PROMPT,
  buildOcrUserPrompt,
} from '../../src/import/photo-ocr'

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])
const JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10])
const token = 'test-token-abcdefghijklmnopqrstuvwxyz'
const url = 'https://app.example.com/api/recipe-ocr'

function base64Of(bytes: Uint8Array): string {
  let binary = ''
  const chunkSize = 0x8000
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize))
  }
  return btoa(binary)
}

const pngBase64 = base64Of(PNG_BYTES)
const jpegBase64 = base64Of(JPEG_BYTES)

function pngPage(): { mimeType: string; dataBase64: string } {
  return { mimeType: 'image/png', dataBase64: pngBase64 }
}

/** Antwort des vertraglich erwarteten Modells; unbekannte Felder werden verworfen. */
const recipeJson: Record<string, unknown> = {
  recognized: true,
  title: 'Apfelkuchen vom Blech',
  description: '',
  servingsText: '12 Stück',
  prepTime: '20 Min.',
  cookTime: '45 Min.',
  totalTime: '',
  notes: '',
  ingredients: [
    {
      group: '',
      quantity: '250',
      unit: 'g',
      name: 'Mehl',
      purchaseNote: '',
      preparationNote: '',
      uncertain: false,
      uncertainty: '',
      unknownField: 'wird verworfen',
    },
  ],
  steps: [{ text: 'Teig kneten.', uncertain: false, uncertainty: '' }],
  uncertainties: [{ reference: 'Seite 1', note: 'Menge schwer lesbar' }],
  warnings: [],
  pages: [{ index: 0, kind: 'recipe', note: '' }],
}

const modelText = 'Hier ist das Rezept:\n```json\n' + JSON.stringify(recipeJson) + '\n```'
const modelResponse = {
  response: modelText,
  usage: { prompt_tokens: 1234, completion_tokens: 567 },
}

interface RequestOptions {
  method?: string
  origin?: string
  secFetchSite?: string
  authorization?: string
  contentType?: string
  contentLength?: string
}

function request(body: unknown, options: RequestOptions = {}): Request {
  const method = options.method ?? 'POST'
  const headers: Record<string, string> = {
    'Content-Type': options.contentType ?? 'application/json',
    Origin: options.origin ?? 'https://app.example.com',
    'CF-Connecting-IP': '203.0.113.10',
  }
  if (options.secFetchSite) headers['Sec-Fetch-Site'] = options.secFetchSite
  if (options.authorization) headers.Authorization = options.authorization
  if (options.contentLength) headers['Content-Length'] = options.contentLength
  const init: RequestInit = { method, headers }
  if (method !== 'GET' && body !== undefined) init.body = JSON.stringify(body)
  return new Request(url, init)
}

function validRequest(pages: unknown = [pngPage()]): Request {
  return request({ pages }, { authorization: `Bearer ${token}` })
}

function envWith(run: AiBinding['run'] = async () => modelResponse): Env {
  return { AI: { run } }
}

function deps(overrides: Partial<RecipeOcrDependencies> = {}): RecipeOcrDependencies {
  const authorize = async (): Promise<AuthorizedMember> => ({ id: 'user-1', email: null })
  return {
    authorize: authorize as unknown as RecipeOcrDependencies['authorize'],
    now: () => 1_000_000,
    ...overrides,
  }
}

function aiError(code: number): Error & { code: number } {
  return Object.assign(new Error(`Workers AI error ${code}`), { code })
}

function oversizedPngPage(): { mimeType: string; dataBase64: string } {
  // Knapp über dem Einzelseiten-Limit, aber noch unter dem 12-MiB-Request-Limit.
  const bytes = new Uint8Array(3 * 1024 * 1024 + 4)
  bytes.set(PNG_BYTES.subarray(0, 8))
  return { mimeType: 'image/png', dataBase64: base64Of(bytes) }
}

function oversizedStreamRequest(): Request {
  const chunk = new Uint8Array(1024 * 1024)
  let sent = 0
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (sent >= 13) {
        controller.close()
        return
      }
      sent += 1
      controller.enqueue(chunk)
    },
  })
  const headers = {
    'Content-Type': 'application/json',
    Origin: 'https://app.example.com',
    'CF-Connecting-IP': '203.0.113.10',
    Authorization: `Bearer ${token}`,
  }
  const init = { method: 'POST', headers, body: stream, duplex: 'half' } as unknown as RequestInit
  return new Request(url, init)
}

beforeEach(() => {
  resetPhotoOcrRateLimits()
})

describe('Pages Function /api/recipe-ocr', () => {
  it('allows only POST', async () => {
    const response = await handleRecipeOcr(request(undefined, { method: 'GET' }), envWith(), deps())
    expect(response.status).toBe(405)
    expect(response.headers.get('allow')).toBe('POST')
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      code: 'method-not-allowed',
    })
  })

  it('rejects cross-origin and non-JSON requests', async () => {
    const crossOrigin = await handleRecipeOcr(
      validRequest(),
      envWith(),
      deps(),
    )
    expect(crossOrigin.status).toBe(200)

    const foreign = await handleRecipeOcr(
      request({ pages: [pngPage()] }, { origin: 'https://evil.example', authorization: `Bearer ${token}` }),
      envWith(),
      deps(),
    )
    expect(foreign.status).toBe(403)
    await expect(foreign.json()).resolves.toMatchObject({ code: 'forbidden-origin' })

    const crossSite = await handleRecipeOcr(
      request({ pages: [pngPage()] }, { secFetchSite: 'cross-site', authorization: `Bearer ${token}` }),
      envWith(),
      deps(),
    )
    expect(crossSite.status).toBe(403)

    const notJson = await handleRecipeOcr(
      request({ pages: [pngPage()] }, { contentType: 'text/plain', authorization: `Bearer ${token}` }),
      envWith(),
      deps(),
    )
    expect(notJson.status).toBe(415)
    await expect(notJson.json()).resolves.toMatchObject({ code: 'invalid-content-type' })
  })

  it('rejects missing authentication before reading the body', async () => {
    const withoutToken = await handleRecipeOcr(request({ pages: [pngPage()] }), envWith())
    expect(withoutToken.status).toBe(401)
    await expect(withoutToken.json()).resolves.toMatchObject({ code: 'unauthorized' })

    // Ein unangemeldeter Aufruf mit riesigem Body wird abgewiesen, ohne ihn zu lesen.
    const withHugeBody = await handleRecipeOcr(
      request(undefined, { contentLength: String(MAX_REQUEST_BYTES + 1) }),
      envWith(),
    )
    expect(withHugeBody.status).toBe(401)
  })

  it('rejects authenticated non-members', async () => {
    const response = await handleRecipeOcr(
      validRequest(),
      envWith(),
      deps({
        authorize: (async () => {
          throw new HttpError(403, 'not-a-member', 'Kein Familienmitglied.')
        }) as unknown as RecipeOcrDependencies['authorize'],
      }),
    )
    expect(response.status).toBe(403)
    const payload = (await response.json()) as { ok: boolean; code: string; error: string }
    expect(payload.ok).toBe(false)
    expect(payload.code).toBe('not-a-member')
    expect(payload.error).toBe(PHOTO_OCR_ERROR_MESSAGES['not-a-member'])
  })

  it('answers 503 when the Workers AI binding is missing', async () => {
    const response = await handleRecipeOcr(validRequest(), {}, deps())
    expect(response.status).toBe(503)
    const payload = (await response.json()) as { code: string; error: string }
    expect(payload.code).toBe('not-configured')
    expect(payload.error).toContain('nicht aktiviert')
  })

  it('rejects zero or too many pages without calling the model', async () => {
    const run = vi.fn(async () => modelResponse)
    const empty = await handleRecipeOcr(validRequest([]), envWith(run), deps())
    expect(empty.status).toBe(400)
    await expect(empty.json()).resolves.toMatchObject({ code: 'invalid-request' })

    const tooMany = await handleRecipeOcr(
      validRequest([pngPage(), pngPage(), pngPage(), pngPage(), pngPage()]),
      envWith(run),
      deps(),
    )
    expect(tooMany.status).toBe(400)
    await expect(tooMany.json()).resolves.toMatchObject({ code: 'invalid-request' })
    expect(run).not.toHaveBeenCalled()
  })

  it('rejects an oversized image, invalid base64, HEIC and MIME mismatches', async () => {
    const run = vi.fn(async () => modelResponse)

    const oversized = await handleRecipeOcr(
      validRequest([oversizedPngPage()]),
      envWith(run),
      deps(),
    )
    expect(oversized.status).toBe(413)
    await expect(oversized.json()).resolves.toMatchObject({ code: 'too-large' })

    const invalidBase64 = await handleRecipeOcr(
      validRequest([{ mimeType: 'image/png', dataBase64: '!!!kein-base64!!!' }]),
      envWith(run),
      deps(),
    )
    expect(invalidBase64.status).toBe(415)
    await expect(invalidBase64.json()).resolves.toMatchObject({ code: 'unsupported-image' })

    const heic = await handleRecipeOcr(
      validRequest([{ mimeType: 'image/heic', dataBase64: pngBase64 }]),
      envWith(run),
      deps(),
    )
    expect(heic.status).toBe(415)

    const mismatch = await handleRecipeOcr(
      validRequest([{ mimeType: 'image/png', dataBase64: jpegBase64 }]),
      envWith(run),
      deps(),
    )
    expect(mismatch.status).toBe(415)
    expect(run).not.toHaveBeenCalled()
  })

  it('returns a normalized recipe for a valid request and sends the multimodal prompt', async () => {
    const run = vi.fn(async (_model: string, _input: unknown) => modelResponse)
    const response = await handleRecipeOcr(validRequest(), envWith(run as AiBinding['run']), deps())

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(response.headers.get('access-control-allow-origin')).toBeNull()

    expect(run).toHaveBeenCalledTimes(1)
    const [model, rawInput] = run.mock.calls[0]!
    expect(model).toBe(PHOTO_OCR_MODEL)
    const input = rawInput as {
      temperature: number
      max_completion_tokens: number
      chat_template_kwargs: Record<string, unknown>
      messages: Array<{ role: string; content: unknown }>
    }
    expect(input.temperature).toBe(0.1)
    expect(input.max_completion_tokens).toBe(6144)
    expect(input.chat_template_kwargs).toEqual({ enable_thinking: false, thinking: false })
    expect(input.messages[0]).toEqual({ role: 'system', content: OCR_SYSTEM_PROMPT })
    const userContent = input.messages[1]!.content as Array<Record<string, unknown>>
    expect(input.messages[1]!.role).toBe('user')
    expect(userContent[0]).toEqual({ type: 'text', text: buildOcrUserPrompt(1) })
    expect(userContent[1]).toEqual({
      type: 'image_url',
      image_url: { url: `data:image/png;base64,${pngBase64}` },
    })

    const payload = (await response.json()) as {
      ok: boolean
      contractVersion: number
      model: string
      recipe: Record<string, unknown>
      pages: Array<Record<string, unknown>>
      usage: Record<string, unknown>
    }
    expect(payload.ok).toBe(true)
    expect(payload.contractVersion).toBe(PHOTO_OCR_CONTRACT_VERSION)
    expect(payload.model).toBe(PHOTO_OCR_MODEL)
    expect(payload.usage).toEqual({ promptTokens: 1234, completionTokens: 567 })
    expect(payload.pages).toEqual([{ index: 0, kind: 'recipe', note: '' }])
    expect(payload.recipe.title).toBe('Apfelkuchen vom Blech')
    expect(payload.recipe.recognized).toBe(true)
    const ingredients = payload.recipe.ingredients as Array<Record<string, unknown>>
    expect(ingredients[0]).toMatchObject({ quantity: '250', unit: 'g', name: 'Mehl' })
    expect(ingredients[0]).not.toHaveProperty('unknownField')
  })

  it('returns a clear 502 when the model response was cut off by the token limit', async () => {
    const truncated = {
      result: {
        choices: [{ message: { role: 'assistant', content: '' }, finish_reason: 'length' }],
      },
    }
    const run = vi.fn(async () => truncated)
    const response = await handleRecipeOcr(validRequest(), envWith(run as AiBinding['run']), deps())

    expect(response.status).toBe(502)
    const payload = (await response.json()) as { ok: boolean; code: string; error: string }
    expect(payload.ok).toBe(false)
    expect(payload.code).toBe('invalid-ai-response')
    expect(payload.error).toBe(PHOTO_AI_TRUNCATED_MESSAGE)
  })

  it('baut die Schritte in einem zweiten, text-only Aufruf neu und summiert die Nutzung', async () => {
    const recipeWithTranscription = {
      ...recipeJson,
      transcription: 'Titel\n250 g Mehl\nAlles verrühren.',
    }
    const recognized = {
      response: 'Hier ist das Rezept:\n```json\n' + JSON.stringify(recipeWithTranscription) + '\n```',
      usage: { prompt_tokens: 1234, completion_tokens: 567 },
    }
    const assembled = {
      response: JSON.stringify({
        steps: [
          {
            text: 'Mehl und Wasser zu einem glatten Teig verrühren und kurz ruhen lassen.',
            uncertain: false,
            uncertainty: '',
          },
        ],
      }),
      usage: { prompt_tokens: 200, completion_tokens: 30 },
    }
    let call = 0
    const run = vi.fn(async (_model: string, _input: unknown) => {
      call += 1
      return call === 1 ? recognized : assembled
    })

    const response = await handleRecipeOcr(validRequest(), envWith(run as AiBinding['run']), deps())
    expect(response.status).toBe(200)
    expect(run).toHaveBeenCalledTimes(2)

    const secondInput = run.mock.calls[1]![1] as {
      temperature: number
      max_completion_tokens: number
      messages: Array<{ role: string; content: unknown }>
    }
    expect(secondInput.temperature).toBe(0)
    expect(secondInput.max_completion_tokens).toBe(2048)
    expect(secondInput.messages[0]).toEqual({
      role: 'system',
      content: OCR_ASSEMBLY_SYSTEM_PROMPT,
    })
    expect(typeof secondInput.messages[1]!.content).toBe('string')
    expect(secondInput.messages[1]!.content as string).toContain('transcriptionLines')

    const payload = (await response.json()) as {
      recipe: { steps: Array<Record<string, unknown>> }
      usage: Record<string, unknown>
    }
    expect(payload.recipe.steps).toEqual([
      {
        text: 'Mehl und Wasser zu einem glatten Teig verrühren und kurz ruhen lassen.',
        uncertain: false,
        uncertainty: '',
      },
    ])
    expect(payload.usage).toEqual({ promptTokens: 1434, completionTokens: 597 })
  })

  it('meldet eine fehlgeschlagene Aufbereitung als Fehler statt die Roherkennung auszugeben', async () => {
    const recipeWithTranscription = {
      ...recipeJson,
      transcription: 'Titel\n250 g Mehl\nAlles verrühren.',
    }
    const recognized = {
      response: JSON.stringify(recipeWithTranscription),
      usage: { prompt_tokens: 1000, completion_tokens: 500 },
    }
    let call = 0
    const run = vi.fn(async (_model: string, _input: unknown) => {
      call += 1
      if (call === 1) return recognized
      throw new Error('kaputte Aufbereitung')
    })

    const response = await handleRecipeOcr(validRequest(), envWith(run as AiBinding['run']), deps())
    expect(response.status).toBe(502)
    expect(run).toHaveBeenCalledTimes(2)
    const payload = (await response.json()) as { ok: boolean; code: string; error: string; recipe?: unknown }
    expect(payload.ok).toBe(false)
    expect(payload.code).toBe('assembly-failed')
    expect(payload.error).toBe(PHOTO_OCR_ERROR_MESSAGES['assembly-failed'])
    expect(payload.recipe).toBeUndefined()
  })

  it('reicht ein erschöpftes Kontingent der Aufbereitung als Quota-Fehler durch', async () => {
    const recipeWithTranscription = {
      ...recipeJson,
      transcription: 'Titel\n250 g Mehl\nAlles verrühren.',
    }
    let call = 0
    const run = vi.fn(async (_model: string, _input: unknown) => {
      call += 1
      if (call === 1) return { response: JSON.stringify(recipeWithTranscription) }
      throw aiError(3036)
    })
    const response = await handleRecipeOcr(validRequest(), envWith(run as AiBinding['run']), deps())
    expect(response.status).toBe(429)
    const payload = (await response.json()) as { code: string }
    expect(payload.code).toBe('quota-exhausted')
  })

  it('übernimmt bereinigte Zutatenbezeichnungen und -gruppen, ohne Mengen zu ändern', async () => {
    const recipeWithTranscription = {
      ...recipeJson,
      transcription: 'Teig\n250 g Mehl\n1 TL Zucker\nAlles verrühren.',
      ingredients: [
        {
          group: 'Teig',
          quantity: '250',
          unit: 'g',
          name: 'Mehl (weizen)',
          purchaseNote: '',
          preparationNote: '',
          uncertain: false,
          uncertainty: '',
        },
        {
          group: 'Füllung',
          quantity: '1',
          unit: 'TL',
          name: 'Zucker',
          purchaseNote: '',
          preparationNote: '',
          uncertain: false,
          uncertainty: '',
        },
      ],
    }
    const assembled = {
      response: JSON.stringify({
        ingredients: [
          { index: 1, name: 'Mehl (Weizen)', group: 'Teig' },
          { index: 2, name: 'Zucker', group: 'Teig' },
        ],
        steps: [
          {
            text: 'Mehl und Zucker zu einem glatten Teig verrühren und kurz ruhen lassen.',
            uncertain: false,
            uncertainty: '',
            sourceLines: [1, 2],
          },
        ],
      }),
      usage: { prompt_tokens: 200, completion_tokens: 30 },
    }
    let call = 0
    const run = vi.fn(async (_model: string, _input: unknown) => {
      call += 1
      return call === 1
        ? { response: JSON.stringify(recipeWithTranscription), usage: { prompt_tokens: 1000, completion_tokens: 500 } }
        : assembled
    })

    const response = await handleRecipeOcr(validRequest(), envWith(run as AiBinding['run']), deps())
    expect(response.status).toBe(200)
    const payload = (await response.json()) as {
      recipe: { ingredients: Array<Record<string, unknown>> }
    }
    expect(payload.recipe.ingredients[0]?.name).toBe('Mehl (Weizen)')
    expect(payload.recipe.ingredients[0]?.quantity).toBe('250')
    expect(payload.recipe.ingredients[0]?.unit).toBe('g')
    expect(payload.recipe.ingredients[1]?.group).toBe('Teig')
  })

  it('meldet eine unplausible Aufbereitung als Fehler', async () => {
    const recipeWithTranscription = {
      ...recipeJson,
      transcription: 'Titel\n250 g Mehl\nAlles verrühren.',
    }
    let call = 0
    const run = vi.fn(async (_model: string, _input: unknown) => {
      call += 1
      if (call === 1) {
        return {
          response: JSON.stringify(recipeWithTranscription),
          usage: { prompt_tokens: 1000, completion_tokens: 500 },
        }
      }
      return {
        response: JSON.stringify({
          steps: [{ text: 'Alles anrichten.', uncertain: false, uncertainty: '' }],
        }),
        usage: { prompt_tokens: 100, completion_tokens: 10 },
      }
    })
    const response = await handleRecipeOcr(validRequest(), envWith(run as AiBinding['run']), deps())
    expect(response.status).toBe(502)
    const payload = (await response.json()) as { code: string }
    expect(payload.code).toBe('assembly-failed')
  })

  it('meldet eine ungültige Aufbereitungsantwort als Fehler', async () => {
    const recipeWithTranscription = {
      ...recipeJson,
      transcription: 'Titel\n250 g Mehl\nAlles verrühren.',
    }
    let call = 0
    const run = vi.fn(async (_model: string, _input: unknown) => {
      call += 1
      if (call === 1) return { response: JSON.stringify(recipeWithTranscription) }
      return { response: 'kein json' }
    })
    const response = await handleRecipeOcr(validRequest(), envWith(run as AiBinding['run']), deps())
    expect(response.status).toBe(502)
    const payload = (await response.json()) as { code: string }
    expect(payload.code).toBe('assembly-failed')
  })

  it('accepts recognized:false as a successful result and fills the page report', async () => {
    const run = vi.fn(async () => ({
      response: JSON.stringify({
        recognized: false,
        title: '',
        ingredients: [],
        steps: [],
        warnings: [],
      }),
    }))
    const response = await handleRecipeOcr(validRequest(), envWith(run as AiBinding['run']), deps())
    expect(response.status).toBe(200)
    const payload = (await response.json()) as {
      recipe: { recognized: boolean; warnings: string[] }
      pages: Array<{ index: number; kind: string }>
      usage: { promptTokens: number | null; completionTokens: number | null }
    }
    expect(payload.recipe.recognized).toBe(false)
    expect(payload.recipe.warnings).toEqual(['Kein Rezept erkannt.'])
    expect(payload.pages).toEqual([{ index: 0, kind: 'recipe', note: '' }])
    expect(payload.usage).toEqual({ promptTokens: null, completionTokens: null })
  })

  it('accepts a plain string model answer and an OpenAI-like response shape', async () => {
    const asString = vi.fn(async () => JSON.stringify(recipeJson))
    const first = await handleRecipeOcr(validRequest(), envWith(asString as AiBinding['run']), deps())
    expect(first.status).toBe(200)

    const asOpenAi = vi.fn(async () => ({
      choices: [{ message: { content: modelText } }],
      usage: { prompt_tokens: 1, completion_tokens: 2 },
    }))
    const second = await handleRecipeOcr(validRequest(), envWith(asOpenAi as AiBinding['run']), deps())
    expect(second.status).toBe(200)
    const payload = (await second.json()) as { usage: Record<string, number> }
    expect(payload.usage).toEqual({ promptTokens: 1, completionTokens: 2 })
  })

  it('returns a generic 502 for unparseable or structurally invalid model answers', async () => {
    const rawAnswer = 'Das ist leider kein JSON: geheimer Modellinhalt'
    const broken = vi.fn(async () => ({ response: rawAnswer }))
    const response = await handleRecipeOcr(validRequest(), envWith(broken as AiBinding['run']), deps())
    expect(response.status).toBe(502)
    const payload = (await response.json()) as { code: string; error: string }
    expect(payload.code).toBe('invalid-ai-response')
    expect(payload.error).toBe(PHOTO_OCR_ERROR_MESSAGES['invalid-ai-response'])
    expect(JSON.stringify(payload)).not.toContain('geheimer Modellinhalt')

    const wrongShape = vi.fn(async () => ({ response: JSON.stringify({ ingredients: 'keine Liste' }) }))
    const second = await handleRecipeOcr(validRequest(), envWith(wrongShape as AiBinding['run']), deps())
    expect(second.status).toBe(502)
    await expect(second.json()).resolves.toMatchObject({ code: 'invalid-ai-response' })

    const wrongPages = vi.fn(async () => ({
      response: JSON.stringify({ recognized: true, title: 'X', pages: [{}, {}] }),
    }))
    const third = await handleRecipeOcr(validRequest(), envWith(wrongPages as AiBinding['run']), deps())
    expect(third.status).toBe(502)
    await expect(third.json()).resolves.toMatchObject({ code: 'invalid-ai-response' })
  })

  it('maps Workers AI quota, capacity and timeout failures', async () => {
    const cases: Array<[Error, number, string]> = [
      [aiError(3036), 429, 'quota-exhausted'],
      [aiError(3040), 503, 'busy'],
      [aiError(3007), 504, 'timeout'],
    ]
    for (const [error, status, code] of cases) {
      const run = vi.fn(async () => {
        throw error
      })
      const response = await handleRecipeOcr(validRequest(), envWith(run as AiBinding['run']), deps())
      expect(response.status, code).toBe(status)
      await expect(response.json()).resolves.toMatchObject({ ok: false, code })
    }

    const quotaRun = vi.fn(async () => {
      throw withMessage('You have used up your daily free allocation of 10,000 neurons')
    })
    const quota = await handleRecipeOcr(validRequest(), envWith(quotaRun as AiBinding['run']), deps())
    expect(quota.status).toBe(429)
    const payload = (await quota.json()) as { code: string; error: string }
    expect(payload.code).toBe('quota-exhausted')
    expect(payload.error).toBe(PHOTO_OCR_ERROR_MESSAGES['quota-exhausted'])
  })

  it('reports a configuration error when the model agreement is missing', async () => {
    const run = vi.fn(async () => {
      throw aiError(5016)
    })
    const response = await handleRecipeOcr(validRequest(), envWith(run as AiBinding['run']), deps())
    expect(response.status).toBe(503)
    const payload = (await response.json()) as { code: string; error: string }
    expect(payload.code).toBe('not-configured')
    expect(payload.error).toContain('Cloudflare-Dashboard')
  })

  it('rate-limits repeated requests per user', async () => {
    const run = vi.fn(async () => modelResponse)
    for (let index = 0; index < PHOTO_OCR_RATE_LIMITS.perUserPerMinute; index += 1) {
      const response = await handleRecipeOcr(validRequest(), envWith(run as AiBinding['run']), deps())
      expect(response.status, String(index)).toBe(200)
    }
    const limited = await handleRecipeOcr(validRequest(), envWith(run as AiBinding['run']), deps())
    expect(limited.status).toBe(429)
    await expect(limited.json()).resolves.toMatchObject({ ok: false, code: 'rate-limited' })
  })

  it('rate-limits repeated requests per IP even for changing members', async () => {
    const run = vi.fn(async () => modelResponse)
    let users = 0
    const authorize = (async (): Promise<AuthorizedMember> => {
      users += 1
      return { id: `user-${users}`, email: null }
    }) as unknown as RecipeOcrDependencies['authorize']

    for (let index = 0; index < PHOTO_OCR_RATE_LIMITS.perIpPerMinute; index += 1) {
      const response = await handleRecipeOcr(
        validRequest(),
        envWith(run as AiBinding['run']),
        deps({ authorize }),
      )
      expect(response.status, String(index)).toBe(200)
    }
    const limited = await handleRecipeOcr(
      validRequest(),
      envWith(run as AiBinding['run']),
      deps({ authorize }),
    )
    expect(limited.status).toBe(429)
    await expect(limited.json()).resolves.toMatchObject({ code: 'rate-limited' })
  })

  it('rejects an oversized request body by Content-Length and by stream', async () => {
    const byHeader = await handleRecipeOcr(
      request(undefined, { contentLength: String(MAX_REQUEST_BYTES + 1) }),
      envWith(),
      deps(),
    )
    expect(byHeader.status).toBe(413)
    await expect(byHeader.json()).resolves.toMatchObject({ code: 'too-large' })

    const byStream = await handleRecipeOcr(oversizedStreamRequest(), envWith(), deps())
    expect(byStream.status).toBe(413)
    await expect(byStream.json()).resolves.toMatchObject({ code: 'too-large' })
  })
})

function withMessage(message: string): Error {
  return new Error(message)
}
