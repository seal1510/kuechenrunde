import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  handleRecipeFetch,
  RATE_LIMITS,
  resetRecipeFetchRateLimits,
  type Env,
  type RecipeFetchDependencies,
} from './recipe-fetch'
import { HttpError } from '../lib/http'
import { CloudFetchError } from '../lib/remote-fetch'
import type { AuthorizedMember } from '../lib/supabase-auth'

const env: Env = {
  SUPABASE_URL: 'https://project.supabase.co',
  SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_abcdefghijklmnopqrstuvwxyz',
}
const token = 'test-token-abcdefghijklmnopqrstuvwxyz'

const jsonLd = {
  '@context': 'https://schema.org',
  '@type': 'Recipe',
  '@id': 'https://example.com/rezept#recipe',
  name: 'Ofengemüse',
  recipeYield: '4 Portionen',
  recipeIngredient: ['2 Zwiebeln', '500 g Kartoffeln'],
  recipeInstructions: [{ '@type': 'HowToStep', text: 'Gemüse schneiden.' }],
  image: 'https://cdn.example.com/bild.png',
}

const html = `<html><head><script type="application/ld+json">${JSON.stringify(
  jsonLd,
)}</script></head><body>Rezept</body></html>`

const pngBytes = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4,
])

function request(
  body: unknown,
  options: { method?: string; origin?: string; authorization?: string; contentType?: string } = {},
): Request {
  const headers: Record<string, string> = {
    'Content-Type': options.contentType ?? 'application/json',
    Origin: options.origin ?? 'https://app.example.com',
    'CF-Connecting-IP': '203.0.113.10',
  }
  if (options.authorization) headers.Authorization = options.authorization
  return new Request('https://app.example.com/api/recipe-fetch', {
    method: options.method ?? 'POST',
    headers,
    body: options.method === 'GET' ? undefined : JSON.stringify(body),
  })
}

function validRequest(kind: 'html' | 'image' = 'html'): Request {
  return request(
    { url: kind === 'html' ? 'https://example.com/rezept' : 'https://cdn.example.com/bild.png', kind },
    { authorization: `Bearer ${token}` },
  )
}

function deps(overrides: Partial<RecipeFetchDependencies> = {}): RecipeFetchDependencies {
  const authorize = async (): Promise<AuthorizedMember> => ({ id: 'user-1', email: null })
  const fetchHtml = async () => ({
    html,
    finalUrl: 'https://example.com/rezept',
    contentType: 'text/html; charset=utf-8',
    bytes: html.length,
  })
  const fetchImage = async () => ({
    bytes: pngBytes,
    mimeType: 'image/png',
    finalUrl: 'https://cdn.example.com/bild.png',
  })
  return {
    authorize: authorize as unknown as RecipeFetchDependencies['authorize'],
    fetchHtml: fetchHtml as unknown as RecipeFetchDependencies['fetchHtml'],
    fetchImage: fetchImage as unknown as RecipeFetchDependencies['fetchImage'],
    now: () => 1_000_000,
    ...overrides,
  }
}

beforeEach(() => {
  resetRecipeFetchRateLimits()
})

describe('Pages Function /api/recipe-fetch', () => {
  it('allows only POST', async () => {
    const response = await handleRecipeFetch(request({}, { method: 'GET' }), env, deps())
    expect(response.status).toBe(405)
    expect(response.headers.get('allow')).toBe('POST')
    await expect(response.json()).resolves.toMatchObject({ ok: false, code: 'method-not-allowed' })
  })

  it('rejects cross-origin and non-JSON requests', async () => {
    const cross = await handleRecipeFetch(
      request({}, { origin: 'https://evil.example' }),
      env,
      deps(),
    )
    expect(cross.status).toBe(403)

    const notJson = await handleRecipeFetch(
      request({}, { contentType: 'text/plain' }),
      env,
      deps(),
    )
    expect(notJson.status).toBe(415)
  })

  it('rejects missing authentication and non-members', async () => {
    const unauthorized = await handleRecipeFetch(
      validRequest(),
      env,
      deps({
        authorize: (async () => {
          throw new HttpError(401, 'unauthorized', 'Anmeldung fehlt.')
        }) as unknown as RecipeFetchDependencies['authorize'],
      }),
    )
    expect(unauthorized.status).toBe(401)
    await expect(unauthorized.json()).resolves.toMatchObject({ code: 'unauthorized' })

    const forbidden = await handleRecipeFetch(
      validRequest(),
      env,
      deps({
        authorize: (async () => {
          throw new HttpError(403, 'not-a-member', 'Kein Familienmitglied.')
        }) as unknown as RecipeFetchDependencies['authorize'],
      }),
    )
    expect(forbidden.status).toBe(403)
    await expect(forbidden.json()).resolves.toMatchObject({ code: 'not-a-member' })
  })

  it('passes the bearer token to the membership check and returns parsed recipes without raw HTML', async () => {
    const authorize = vi.fn(async (_request: Request) => ({ id: 'user-1', email: null }))
    const fetchHtml = vi.fn(async () => ({
      html,
      finalUrl: 'https://example.com/rezept',
      contentType: 'text/html; charset=utf-8',
      bytes: html.length,
    }))
    const response = await handleRecipeFetch(
      validRequest(),
      env,
      deps({
        authorize: authorize as unknown as RecipeFetchDependencies['authorize'],
        fetchHtml: fetchHtml as unknown as RecipeFetchDependencies['fetchHtml'],
      }),
    )
    expect(response.status).toBe(200)
    expect(authorize).toHaveBeenCalledTimes(1)
    const passedRequest = authorize.mock.calls[0]![0]
    expect(passedRequest.headers.get('authorization')).toBe(`Bearer ${token}`)
    expect(fetchHtml).toHaveBeenCalledWith('https://example.com/rezept')

    const payload = (await response.json()) as Record<string, unknown>
    expect(payload.ok).toBe(true)
    expect(payload.html).toBeUndefined()
    expect(payload.finalUrl).toBe('https://example.com/rezept')
    const extraction = payload.extraction as {
      candidates: Array<{ title: string; ingredients: unknown[]; images: string[] }>
    }
    expect(extraction.candidates).toHaveLength(1)
    expect(extraction.candidates[0]!.title).toBe('Ofengemüse')
    expect(extraction.candidates[0]!.ingredients).toHaveLength(2)
    expect(extraction.candidates[0]!.images).toEqual(['https://cdn.example.com/bild.png'])
  })

  it('returns parser warnings for malformed JSON-LD instead of throwing', async () => {
    const malformed = '<html><script type="application/ld+json">{not valid json</script></html>'
    const response = await handleRecipeFetch(
      validRequest(),
      env,
      deps({
        fetchHtml: (async () => ({
          html: malformed,
          finalUrl: 'https://example.com/kaputt',
          contentType: 'text/html',
          bytes: malformed.length,
        })) as unknown as RecipeFetchDependencies['fetchHtml'],
      }),
    )
    expect(response.status).toBe(200)
    const payload = (await response.json()) as {
      extraction: { candidates: unknown[]; warnings: string[] }
    }
    expect(payload.extraction.candidates).toHaveLength(0)
    expect(payload.extraction.warnings.join(' ')).toMatch(/JSON/)
    expect(JSON.stringify(payload)).not.toContain(malformed)
  })

  it('returns image bytes with a safe type and final URL', async () => {
    const response = await handleRecipeFetch(validRequest('image'), env, deps())
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('image/png')
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(response.headers.get('x-final-url')).toBe(
      encodeURIComponent('https://cdn.example.com/bild.png'),
    )
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(pngBytes)
  })

  it('rejects unsafe URLs before fetching', async () => {
    const fetchHtml = vi.fn()
    const response = await handleRecipeFetch(
      request(
        { url: 'http://169.254.169.254/latest/meta-data', kind: 'html' },
        { authorization: `Bearer ${token}` },
      ),
      env,
      deps({
        fetchHtml: fetchHtml as unknown as RecipeFetchDependencies['fetchHtml'],
      }),
    )
    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({ code: 'unsafe-url' })
    expect(fetchHtml).not.toHaveBeenCalled()
  })

  it('maps remote content, size, timeout and network failures', async () => {
    const cases: Array<[CloudFetchError, number, string]> = [
      [new CloudFetchError('not-html', 'kein HTML'), 415, 'not-html'],
      [new CloudFetchError('too-large', 'zu groß'), 413, 'too-large'],
      [new CloudFetchError('timeout', 'zu langsam'), 504, 'timeout'],
      [new CloudFetchError('http', 'HTTP 500'), 502, 'http'],
      [new CloudFetchError('network', 'Netzwerk'), 502, 'network'],
      [new CloudFetchError('redirect', 'Weiterleitung'), 502, 'redirect'],
    ]
    for (const [error, status, code] of cases) {
      const response = await handleRecipeFetch(
        validRequest(),
        env,
        deps({
          fetchHtml: (async () => {
            throw error
          }) as unknown as RecipeFetchDependencies['fetchHtml'],
        }),
      )
      expect(response.status, code).toBe(status)
      await expect(response.json()).resolves.toMatchObject({ code })
    }
  })

  it('rejects an oversized request body', async () => {
    const response = await handleRecipeFetch(
      request({ url: 'https://example.com/', padding: 'x'.repeat(20 * 1024) }),
      env,
      deps(),
    )
    expect(response.status).toBe(413)
    await expect(response.json()).resolves.toMatchObject({ code: 'too-large' })
  })

  it('rate-limits repeated requests per IP', async () => {
    for (let index = 0; index < RATE_LIMITS.perIpPerMinute; index += 1) {
      const response = await handleRecipeFetch(validRequest(), env, deps())
      expect(response.status).toBe(200)
    }
    const limited = await handleRecipeFetch(validRequest(), env, deps())
    expect(limited.status).toBe(429)
    await expect(limited.json()).resolves.toMatchObject({ code: 'rate-limited' })
  })

  it('returns a generic error for unexpected failures without leaking details', async () => {
    const response = await handleRecipeFetch(
      validRequest(),
      env,
      deps({
        fetchHtml: (async () => {
          throw new Error('secret internal detail')
        }) as unknown as RecipeFetchDependencies['fetchHtml'],
      }),
    )
    expect(response.status).toBe(500)
    const payload = (await response.json()) as { error: string; code: string }
    expect(payload.code).toBe('internal')
    expect(payload.error).not.toContain('secret internal detail')
  })
})
