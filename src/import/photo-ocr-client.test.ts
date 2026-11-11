import { describe, expect, it, vi } from 'vitest'
import type { OcrRecipe, PhotoOcrPage, PhotoOcrSuccess } from './photo-ocr'
import {
  PHOTO_OCR_ERROR_MESSAGES,
  PHOTO_OCR_MAX_PAGES,
  PHOTO_OCR_MAX_PAGE_BYTES,
} from './photo-ocr'
import {
  PhotoOcrAbortedError,
  PhotoOcrRequestError,
  buildPhotoOcrRequest,
  isPhotoOcrAbort,
  parsePhotoOcrResponse,
  photoOcrErrorMessage,
  requestPhotoOcr,
  validatePhotoOcrPages,
} from './photo-ocr-client'

const sampleBase64 = btoa('synthetisches-bild')

function page(overrides: Partial<PhotoOcrPage> = {}): PhotoOcrPage {
  return {
    mimeType: 'image/jpeg',
    dataBase64: sampleBase64,
    width: 2048,
    height: 1536,
    ...overrides,
  }
}

function ocrRecipe(): OcrRecipe {
  return {
    recognized: true,
    title: 'Omas Apfelkuchen',
    description: 'Familienrezept.',
    servingsText: '4 Portionen',
    prepTime: '20 Min.',
    cookTime: '50 Min.',
    totalTime: '',
    notes: '',
    ingredients: [
      {
        group: 'Teig',
        quantity: '250',
        unit: 'g',
        name: 'Mehl',
        purchaseNote: '',
        preparationNote: '',
        uncertain: false,
        uncertainty: '',
      },
    ],
    steps: [{ text: 'Alles verkneten und backen.', uncertain: false, uncertainty: '' }],
    uncertainties: [{ reference: 'Zutat 1, Menge', note: 'Menge schwer lesbar.' }],
    warnings: [],
  }
}

function successBody(overrides: Partial<PhotoOcrSuccess> = {}): PhotoOcrSuccess {
  return {
    ok: true,
    contractVersion: 1,
    model: '@cf/meta/llama-4-scout-17b-16e-instruct',
    recipe: ocrRecipe(),
    pages: [{ index: 0, kind: 'recipe', note: '' }],
    usage: { promptTokens: 10, completionTokens: 20 },
    ...overrides,
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('photo OCR request', () => {
  it('builds the exact body the Pages Function reads', () => {
    const request = buildPhotoOcrRequest([page()])
    expect(request).toEqual({
      pages: [
        {
          mimeType: 'image/jpeg',
          dataBase64: sampleBase64,
          width: 2048,
          height: 1536,
        },
      ],
    })
    // Der Prompt wird bewusst serverseitig aus dem gemeinsamen Vertrag gebaut.
    expect(JSON.stringify(request)).not.toContain('prompt')
  })

  it('rejects empty, unpadded or unsupported pages before sending', () => {
    expect(() => validatePhotoOcrPages([])).toThrow(/mindestens eine Seite/i)
    expect(() => validatePhotoOcrPages([page({ dataBase64: '' })])).toThrow(
      /keine gültigen Bilddaten/,
    )
    expect(() => validatePhotoOcrPages([page({ dataBase64: '#nicht-base64' })])).toThrow(
      /keine gültigen Bilddaten/,
    )
    expect(() => validatePhotoOcrPages([page({ mimeType: 'image/gif' as never })])).toThrow(
      /kein unterstütztes Bildformat/,
    )
    const tooMany = Array.from({ length: PHOTO_OCR_MAX_PAGES + 1 }, () => page())
    expect(() => validatePhotoOcrPages(tooMany)).toThrow(/höchstens 4 Seiten/)
  })

  it('rejects a page above the per-page byte limit', () => {
    const tooLarge = btoa('x'.repeat(PHOTO_OCR_MAX_PAGE_BYTES + 1))
    expect(() => validatePhotoOcrPages([page({ dataBase64: tooLarge })])).toThrow(
      PhotoOcrRequestError,
    )
    try {
      validatePhotoOcrPages([page({ dataBase64: tooLarge })])
    } catch (cause) {
      expect((cause as PhotoOcrRequestError).code).toBe('too-large')
    }
  })
})

describe('parsePhotoOcrResponse', () => {
  it('validates a successful answer against the shared contract', () => {
    const result = parsePhotoOcrResponse(successBody(), 1)
    expect(result.recipe.title).toBe('Omas Apfelkuchen')
    expect(result.recipe.ingredients[0]?.quantity).toBe('250')
    expect(result.pages).toEqual([{ index: 0, kind: 'recipe', note: '' }])
    expect(result.model).toBe('@cf/meta/llama-4-scout-17b-16e-instruct')
    expect(result.usage).toEqual({ promptTokens: 10, completionTokens: 20 })
  })

  it('maps an error body to its German message and code', () => {
    try {
      parsePhotoOcrResponse(
        { ok: false, code: 'quota-exhausted', error: PHOTO_OCR_ERROR_MESSAGES['quota-exhausted'] },
        1,
      )
      throw new Error('unerwartet')
    } catch (cause) {
      expect(cause).toBeInstanceOf(PhotoOcrRequestError)
      expect((cause as PhotoOcrRequestError).code).toBe('quota-exhausted')
      expect((cause as Error).message).toContain('Tageskontingent')
      expect((cause as Error).message).toContain('keine Kosten')
    }
  })

  it('rejects a malformed AI answer defensively', () => {
    expect(() => parsePhotoOcrResponse({ ok: true, contractVersion: 1, recipe: 'nope' }, 1)).toThrow(
      /nicht zuverlässig gelesen/,
    )
    expect(() =>
      parsePhotoOcrResponse({ ...successBody(), contractVersion: 99 }, 1),
    ).toThrow(/Vertragsversion/)
    expect(() => parsePhotoOcrResponse({ ok: 'ja' }, 1)).toThrow(/keine gültige Antwort/)
    expect(() =>
      parsePhotoOcrResponse({ ...successBody(), pages: [{ index: 0 }, { index: 1 }] }, 1),
    ).toThrow(/nicht zuverlässig gelesen/)
  })

  it('falls back to the contract page reports when the server sends none', () => {
    const body = { ...successBody(), pages: undefined }
    expect(parsePhotoOcrResponse(body, 2)).toEqual(
      expect.objectContaining({
        pages: [
          { index: 0, kind: 'recipe', note: '' },
          { index: 1, kind: 'recipe', note: '' },
        ],
      }),
    )
  })
})

describe('requestPhotoOcr', () => {
  it('posts JSON with the Bearer token to the same-origin endpoint', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(successBody()))
    const getAccessToken = vi.fn(async () => 'supabase-token')
    const result = await requestPhotoOcr([page()], {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      getAccessToken,
      timeoutMs: 5000,
    })

    expect(result.recipe.title).toBe('Omas Apfelkuchen')
    expect(getAccessToken).toHaveBeenCalledTimes(1)
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/recipe-ocr')
    expect(init.method).toBe('POST')
    expect(init.credentials).toBe('omit')
    expect(init.cache).toBe('no-store')
    const headers = init.headers as Record<string, string>
    expect(headers.Authorization).toBe('Bearer supabase-token')
    expect(headers['Content-Type']).toBe('application/json')
    const body = JSON.parse(String(init.body)) as { pages: unknown[] }
    expect(body.pages).toHaveLength(1)
    expect(String(init.body)).not.toContain('data:image')
  })

  it('does not call the endpoint without a token', async () => {
    const fetchImpl = vi.fn()
    await expect(
      requestPhotoOcr([page()], {
        fetchImpl: fetchImpl as unknown as typeof fetch,
        getAccessToken: async () => null,
      }),
    ).rejects.toMatchObject({ code: 'unauthorized' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('maps a failed token check to an understandable login error', async () => {
    await expect(
      requestPhotoOcr([page()], {
        fetchImpl: vi.fn() as unknown as typeof fetch,
        getAccessToken: async () => {
          throw new Error('kaputt')
        },
      }),
    ).rejects.toMatchObject({ code: 'unauthorized' })
  })

  it('maps HTTP errors without leaking raw AI data', async () => {
    const cases: Array<[number, unknown, string]> = [
      [401, null, 'unauthorized'],
      [403, null, 'not-a-member'],
      [413, null, 'too-large'],
      [429, null, 'rate-limited'],
      [429, { ok: false, code: 'quota-exhausted', error: 'Kontingent' }, 'quota-exhausted'],
      [503, null, 'busy'],
      [504, null, 'timeout'],
      [502, { ok: false, code: 'invalid-ai-response' }, 'invalid-ai-response'],
      [500, null, 'internal'],
    ]
    for (const [status, body, code] of cases) {
      const fetchImpl = vi.fn(async () =>
        body === null
          ? new Response('kein json', { status })
          : jsonResponse(body, status),
      )
      await expect(
        requestPhotoOcr([page()], {
          fetchImpl: fetchImpl as unknown as typeof fetch,
          timeoutMs: 5000,
        }),
      ).rejects.toMatchObject({ code })
    }
  })

  it('turns a network failure into an upstream error', async () => {
    await expect(
      requestPhotoOcr([page()], {
        fetchImpl: (async () => {
          throw new TypeError('Failed to fetch')
        }) as unknown as typeof fetch,
        timeoutMs: 5000,
      }),
    ).rejects.toMatchObject({ code: 'upstream' })
  })

  it('aborts with a timeout error when the request hangs', async () => {
    const fetchImpl = (_url: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal
        signal?.addEventListener('abort', () => {
          const error = new Error('aborted')
          error.name = 'AbortError'
          reject(error)
        })
      })
    await expect(
      requestPhotoOcr([page()], {
        fetchImpl: fetchImpl as unknown as typeof fetch,
        timeoutMs: 5,
      }),
    ).rejects.toMatchObject({ code: 'timeout' })
  })

  it('separates a user abort from a timeout', async () => {
    const controller = new AbortController()
    const fetchImpl = (_url: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const error = new Error('aborted')
          error.name = 'AbortError'
          reject(error)
        })
        setTimeout(() => controller.abort(), 5)
      })
    await expect(
      requestPhotoOcr([page()], {
        fetchImpl: fetchImpl as unknown as typeof fetch,
        timeoutMs: 5000,
        signal: controller.signal,
      }),
    ).rejects.toBeInstanceOf(PhotoOcrAbortedError)
  })

  it('refuses a cross-origin token endpoint', async () => {
    await expect(
      requestPhotoOcr([page()], {
        endpoint: 'https://evil.example/api/recipe-ocr',
        fetchImpl: vi.fn() as unknown as typeof fetch,
      }),
    ).rejects.toMatchObject({ code: 'not-configured' })
  })

  it('exposes the shared German messages and abort helper', () => {
    expect(photoOcrErrorMessage('quota-exhausted')).toContain('Tageskontingent')
    expect(photoOcrErrorMessage('unauthorized')).toContain('Anmeldung')
    expect(isPhotoOcrAbort(new PhotoOcrAbortedError())).toBe(true)
    expect(isPhotoOcrAbort(new Error('anders'))).toBe(false)
  })
})
