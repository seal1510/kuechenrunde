import { describe, expect, it, vi } from 'vitest'
import {
  buildPhotoOcrInput,
  classifyPhotoAiError,
  decodeBase64Strict,
  extractModelText,
  extractPhotoAiUsage,
  runPhotoOcr,
  validatePhotoPages,
  type AiBinding,
} from './photo-ai'
import { HttpError } from './http'
import {
  OCR_SYSTEM_PROMPT,
  PHOTO_OCR_ERROR_MESSAGES,
  PHOTO_OCR_MAX_PAGE_BYTES,
  PHOTO_OCR_MODEL,
  buildOcrUserPrompt,
} from '../../src/import/photo-ocr'

const PNG_HEADER = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
const JPEG_HEADER = [0xff, 0xd8, 0xff, 0xe0]
const WEBP_HEADER = [
  0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
]

function bytesOf(header: readonly number[], padding = 8): Uint8Array {
  const bytes = new Uint8Array(header.length + padding)
  bytes.set(header)
  return bytes
}

function pngOfSize(size: number): Uint8Array {
  const bytes = new Uint8Array(size)
  bytes.set(PNG_HEADER)
  return bytes
}

function base64Of(bytes: Uint8Array): string {
  let binary = ''
  const chunkSize = 0x8000
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize))
  }
  return btoa(binary)
}

function page(mimeType: string, bytes: Uint8Array): { mimeType: string; dataBase64: string } {
  return { mimeType, dataBase64: base64Of(bytes) }
}

const validPngPage = page('image/png', bytesOf(PNG_HEADER))
const validJpegPage = page('image/jpeg', bytesOf(JPEG_HEADER))
const validWebpPage = page('image/webp', bytesOf(WEBP_HEADER))

function captureHttpError(fn: () => unknown): HttpError {
  try {
    fn()
  } catch (error) {
    expect(error).toBeInstanceOf(HttpError)
    return error as HttpError
  }
  throw new Error('Erwarteter HttpError wurde nicht geworfen.')
}

function expectHttpError(fn: () => unknown, status: number, code: string): HttpError {
  const error = captureHttpError(fn)
  expect(error.status).toBe(status)
  expect(error.code).toBe(code)
  return error
}

describe('decodeBase64Strict', () => {
  it('decodes padded standard base64 byte-exactly', () => {
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d])
    const decoded = decodeBase64Strict(base64Of(bytes))
    expect(decoded).not.toBeNull()
    expect(Array.from(decoded!)).toEqual(Array.from(bytes))
  })

  it('rejects unpadded, padded-lenient and non-base64 input', () => {
    expect(decodeBase64Strict('')).toBeNull()
    expect(decodeBase64Strict('abc')).toBeNull()
    expect(decodeBase64Strict('ab-c')).toBeNull()
    expect(decodeBase64Strict('!!!!')).toBeNull()
    expect(decodeBase64Strict('AAA A')).toBeNull()
    expect(decodeBase64Strict('A===')).toBeNull()
    expect(decodeBase64Strict('====')).toBeNull()
    expect(decodeBase64Strict(42)).toBeNull()
    expect(decodeBase64Strict(undefined)).toBeNull()
  })

  it('accepts unpadded-length-correct base64 with padding bytes', () => {
    // "AA==" decodiert zu einem Null-Byte.
    expect(Array.from(decodeBase64Strict('AA==')!)).toEqual([0])
  })
})

describe('validatePhotoPages', () => {
  it('accepts one to four supported pages and normalizes the MIME type', () => {
    const pages = validatePhotoPages([
      validPngPage,
      validJpegPage,
      validWebpPage,
      { mimeType: ' IMAGE/PNG ', dataBase64: validPngPage.dataBase64 },
    ])
    expect(pages).toHaveLength(4)
    expect(pages[0]).toEqual({ mimeType: 'image/png', dataBase64: validPngPage.dataBase64 })
    expect(pages[2]!.mimeType).toBe('image/webp')
    expect(pages[3]!.mimeType).toBe('image/png')
  })

  it('rejects a missing, empty or too long page list as invalid request', () => {
    expectHttpError(() => validatePhotoPages(undefined), 400, 'invalid-request')
    expectHttpError(() => validatePhotoPages('foto'), 400, 'invalid-request')
    expectHttpError(() => validatePhotoPages([]), 400, 'invalid-request')
    expectHttpError(
      () =>
        validatePhotoPages([
          validPngPage,
          validPngPage,
          validPngPage,
          validPngPage,
          validPngPage,
        ]),
      400,
      'invalid-request',
    )
  })

  it('rejects unsupported MIME types and HEIC as unsupported image', () => {
    expectHttpError(
      () => validatePhotoPages([page('image/heic', bytesOf([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63]))]),
      415,
      'unsupported-image',
    )
    expectHttpError(() => validatePhotoPages([page('image/gif', bytesOf([0x47, 0x49, 0x46, 0x38]))]), 415, 'unsupported-image')
    expectHttpError(() => validatePhotoPages([page('application/pdf', bytesOf(PNG_HEADER))]), 415, 'unsupported-image')
    expectHttpError(() => validatePhotoPages([{ mimeType: 7, dataBase64: validPngPage.dataBase64 }]), 415, 'unsupported-image')
  })

  it('rejects invalid base64 and mismatched magic bytes as unsupported image', () => {
    expectHttpError(
      () => validatePhotoPages([{ mimeType: 'image/png', dataBase64: '!!!kein-base64!!!' }]),
      415,
      'unsupported-image',
    )
    expectHttpError(
      () => validatePhotoPages([{ mimeType: 'image/png', dataBase64: '' }]),
      415,
      'unsupported-image',
    )
    // JPEG-Bytes als PNG deklariert.
    expectHttpError(
      () => validatePhotoPages([{ mimeType: 'image/png', dataBase64: validJpegPage.dataBase64 }]),
      415,
      'unsupported-image',
    )
    // Zufallsdaten ohne Bildsignatur.
    expectHttpError(
      () => validatePhotoPages([{ mimeType: 'image/webp', dataBase64: base64Of(new Uint8Array(16)) }]),
      415,
      'unsupported-image',
    )
  })

  it('rejects a single page above the decoded page limit', () => {
    expectHttpError(
      () => validatePhotoPages([page('image/png', pngOfSize(PHOTO_OCR_MAX_PAGE_BYTES + 1))]),
      413,
      'too-large',
    )
  })

  it('rejects a total decoded size above the total limit', () => {
    const pageSize = Math.floor((2.9 * 1024 * 1024) / 4) * 4
    expectHttpError(
      () =>
        validatePhotoPages([
          page('image/png', pngOfSize(pageSize)),
          page('image/png', pngOfSize(pageSize)),
          page('image/png', pngOfSize(pageSize)),
        ]),
      413,
      'too-large',
    )
  })
})

describe('buildPhotoOcrInput', () => {
  it('builds the multimodal request from the shared contract', () => {
    const pages = validatePhotoPages([validPngPage, validJpegPage])
    const input = buildPhotoOcrInput(pages)

    expect(input.temperature).toBe(0.1)
    expect(input.max_tokens).toBe(3000)
    expect(input.messages).toHaveLength(2)
    expect(input.messages[0]).toEqual({ role: 'system', content: OCR_SYSTEM_PROMPT })

    const user = input.messages[1]!
    expect(user.role).toBe('user')
    const parts = user.content as unknown as Array<Record<string, unknown>>
    expect(parts).toHaveLength(3)
    expect(parts[0]).toEqual({ type: 'text', text: buildOcrUserPrompt(2) })
    expect((parts[0]!.text as string)).toContain('2 Seiten')
    expect(parts[1]).toEqual({
      type: 'image_url',
      image_url: { url: `data:image/png;base64,${validPngPage.dataBase64}` },
    })
    expect(parts[2]).toEqual({
      type: 'image_url',
      image_url: { url: `data:image/jpeg;base64,${validJpegPage.dataBase64}` },
    })
  })
})

describe('runPhotoOcr', () => {
  it('calls exactly one model with the contract model id', async () => {
    const run = vi.fn(async (_model: string, _input: unknown) => ({ response: '{"recognized":false}' }))
    const ai: AiBinding = { run }
    const pages = validatePhotoPages([validPngPage])

    await runPhotoOcr(ai, pages)

    expect(run).toHaveBeenCalledTimes(1)
    const [model, input] = run.mock.calls[0]!
    expect(model).toBe(PHOTO_OCR_MODEL)
    const modelInput = input as { temperature: number; max_tokens: number; messages: unknown[] }
    expect(modelInput.temperature).toBe(0.1)
    expect(modelInput.max_tokens).toBe(3000)
    expect(modelInput.messages).toHaveLength(2)
  })
})

describe('extractModelText', () => {
  it('extracts text from plain strings and Workers-AI responses', () => {
    expect(extractModelText('{"a":1}')).toBe('{"a":1}')
    expect(extractModelText({ response: '{"b":2}' })).toBe('{"b":2}')
    expect(extractModelText({ response: { recognized: true } })).toBe('{"recognized":true}')
    expect(extractModelText({ result: { response: 'verschachtelt' } })).toBe('verschachtelt')
    expect(extractModelText({ output_text: 'Responses-API' })).toBe('Responses-API')
    expect(extractModelText({ text: 'flach' })).toBe('flach')
  })

  it('extracts OpenAI-compatible choice content', () => {
    expect(extractModelText({ choices: [{ message: { content: 'OpenAI' } }] })).toBe('OpenAI')
    expect(
      extractModelText({
        choices: [
          {
            message: {
              content: [
                { type: 'text', text: 'Teil A ' },
                { type: 'text', text: 'Teil B' },
              ],
            },
          },
        ],
      }),
    ).toBe('Teil A Teil B')
    expect(extractModelText({ choices: [{ text: 'Fallback' }] })).toBe('Fallback')
  })

  it('returns an empty string for unusable responses', () => {
    expect(extractModelText({})).toBe('')
    expect(extractModelText(null)).toBe('')
    expect(extractModelText(42)).toBe('')
    expect(extractModelText({ response: null, choices: 'kaputt' })).toBe('')
  })
})

describe('extractPhotoAiUsage', () => {
  it('reads prompt and completion tokens, otherwise null', () => {
    expect(extractPhotoAiUsage({ usage: { prompt_tokens: 12, completion_tokens: 34 } })).toEqual({
      promptTokens: 12,
      completionTokens: 34,
    })
    expect(extractPhotoAiUsage({ usage: { promptTokens: 5 } })).toEqual({
      promptTokens: 5,
      completionTokens: null,
    })
    expect(
      extractPhotoAiUsage({ result: { usage: { prompt_tokens: 7, completion_tokens: 8 } } }),
    ).toEqual({ promptTokens: 7, completionTokens: 8 })
    expect(extractPhotoAiUsage({ response: 'ohne Usage' })).toEqual({
      promptTokens: null,
      completionTokens: null,
    })
    expect(extractPhotoAiUsage({ usage: { prompt_tokens: -1, completion_tokens: '9' } })).toEqual({
      promptTokens: null,
      completionTokens: null,
    })
    expect(extractPhotoAiUsage(undefined)).toEqual({ promptTokens: null, completionTokens: null })
  })
})

describe('classifyPhotoAiError', () => {
  function withCode(code: number): Error & { code: number } {
    return Object.assign(new Error('Workers AI error'), { code })
  }

  it('maps quota, capacity, size and timeout errors', () => {
    const cases: Array<{
      name: string
      error: unknown
      status: number
      code: string
      message?: string
    }> = [
      { name: 'quota code', error: withCode(3036), status: 429, code: 'quota-exhausted', message: PHOTO_OCR_ERROR_MESSAGES['quota-exhausted'] },
      { name: 'quota code in message', error: new Error('AiError: 3036: daily limit reached'), status: 429, code: 'quota-exhausted', message: PHOTO_OCR_ERROR_MESSAGES['quota-exhausted'] },
      { name: 'quota allocation text', error: new Error('You have used up your daily free allocation of 10,000 neurons'), status: 429, code: 'quota-exhausted', message: PHOTO_OCR_ERROR_MESSAGES['quota-exhausted'] },
      { name: 'quota german number', error: new Error('limit von 10.000 neurons erreicht'), status: 429, code: 'quota-exhausted', message: PHOTO_OCR_ERROR_MESSAGES['quota-exhausted'] },
      { name: 'busy code', error: withCode(3040), status: 503, code: 'busy', message: PHOTO_OCR_ERROR_MESSAGES.busy },
      { name: 'busy text', error: new Error('Capacity temporarily exceeded. Please try again.'), status: 503, code: 'busy', message: PHOTO_OCR_ERROR_MESSAGES.busy },
      { name: 'too large code', error: withCode(3006), status: 413, code: 'too-large', message: PHOTO_OCR_ERROR_MESSAGES['too-large'] },
      { name: 'too large text', error: new Error('Request too large for model'), status: 413, code: 'too-large', message: PHOTO_OCR_ERROR_MESSAGES['too-large'] },
      { name: 'timeout code 3007', error: withCode(3007), status: 504, code: 'timeout', message: PHOTO_OCR_ERROR_MESSAGES.timeout },
      { name: 'timeout code 3008', error: withCode(3008), status: 504, code: 'timeout', message: PHOTO_OCR_ERROR_MESSAGES.timeout },
      { name: 'abort error', error: Object.assign(new Error('The operation was aborted'), { name: 'AbortError' }), status: 504, code: 'timeout', message: PHOTO_OCR_ERROR_MESSAGES.timeout },
      { name: 'timed out text', error: new Error('The request timed out'), status: 504, code: 'timeout', message: PHOTO_OCR_ERROR_MESSAGES.timeout },
    ]

    for (const entry of cases) {
      const failure = classifyPhotoAiError(entry.error)
      expect(failure.status, entry.name).toBe(entry.status)
      expect(failure.code, entry.name).toBe(entry.code)
      if (entry.message) expect(failure.message, entry.name).toBe(entry.message)
    }
  })

  it('maps configuration errors with precise German hints', () => {
    const agreement = classifyPhotoAiError(withCode(5016))
    expect(agreement.status).toBe(503)
    expect(agreement.code).toBe('not-configured')
    expect(agreement.message).toContain('Modellbedingungen')
    expect(agreement.message).toContain('Cloudflare-Dashboard')

    const agreementText = classifyPhotoAiError(
      new Error('You must agree to the model agreement before using this model'),
    )
    expect(agreementText.code).toBe('not-configured')
    expect(agreementText.message).toContain('Cloudflare-Dashboard')

    const paid = classifyPhotoAiError(withCode(5035))
    expect(paid.status).toBe(503)
    expect(paid.code).toBe('not-configured')
    expect(paid.message).toContain('Tarif')

    const paidText = classifyPhotoAiError(new Error('This model requires a Workers Paid plan'))
    expect(paidText.code).toBe('not-configured')
    expect(paidText.message).toContain('Tarif')

    for (const code of [5007, 3042, 5018, 3041]) {
      const failure = classifyPhotoAiError(withCode(code))
      expect(failure.status, String(code)).toBe(503)
      expect(failure.code, String(code)).toBe('not-configured')
      expect(failure.message, String(code)).toBe(PHOTO_OCR_ERROR_MESSAGES['not-configured'])
    }
  })

  it('accepts string error codes and nested error objects', () => {
    const stringCode = classifyPhotoAiError({ code: '3036', message: 'quota' })
    expect(stringCode.status).toBe(429)
    expect(stringCode.code).toBe('quota-exhausted')

    const nested = classifyPhotoAiError({
      name: 'AiError',
      message: 'request failed',
      cause: { code: 3040 },
    })
    expect(nested.status).toBe(503)
    expect(nested.code).toBe('busy')
  })

  it('falls back to a generic upstream error for unknown failures', () => {
    for (const error of [
      new Error('irgendetwas Unbekanntes'),
      'kaputt',
      { status: 500 },
      undefined,
      null,
    ]) {
      const failure = classifyPhotoAiError(error)
      expect(failure.status).toBe(502)
      expect(failure.code).toBe('upstream')
      expect(failure.message).toBe(PHOTO_OCR_ERROR_MESSAGES.upstream)
    }
  })

  it('never echoes the original error message to the browser', () => {
    const failure = classifyPhotoAiError(new Error('secret internal model detail'))
    expect(failure.message).not.toContain('secret internal model detail')
  })
})
