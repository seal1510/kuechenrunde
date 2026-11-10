import { describe, expect, it, vi } from 'vitest'
import { createRecipeFetcher, RecipeFetchError } from './url-fetcher'

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

const pngBytes = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4,
])

describe('recipe fetch client', () => {
  it('posts the URL to the same-origin endpoint without credentials', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ ok: true, html: '<html></html>', finalUrl: 'https://example.com/final' }),
    )
    const fetcher = createRecipeFetcher({ endpoint: '/api/test', fetchImpl: fetchImpl as typeof fetch })
    const page = await fetcher.fetchPage('example.com/rezept#x')

    expect(page.finalUrl).toBe('https://example.com/final')
    expect(page.html).toBe('<html></html>')
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/test')
    expect(init.method).toBe('POST')
    expect(init.credentials).toBe('omit')
    expect(init.redirect).toBe('error')
    expect(JSON.parse(String(init.body))).toEqual({
      url: 'https://example.com/rezept',
      kind: 'html',
    })
  })

  it('rejects invalid URLs before any network call', async () => {
    const fetchImpl = vi.fn()
    const fetcher = createRecipeFetcher({ fetchImpl: fetchImpl as unknown as typeof fetch })
    await expect(fetcher.fetchPage('javascript:alert(1)')).rejects.toMatchObject({
      code: 'invalid-url',
    })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('maps a missing local service to a helpful error', async () => {
    const fetcher = createRecipeFetcher({
      fetchImpl: (async () => jsonResponse({ error: 'not found' }, 404)) as typeof fetch,
    })
    await expect(fetcher.fetchPage('https://example.com/x')).rejects.toMatchObject({
      code: 'unavailable',
    })
  })

  it('maps aborts to a timeout error', async () => {
    const fetchImpl = ((_url: string, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => {
          const error = new Error('aborted')
          error.name = 'AbortError'
          reject(error)
        })
      })) as unknown as typeof fetch
    const fetcher = createRecipeFetcher({ fetchImpl, timeoutMs: 5 })
    await expect(fetcher.fetchPage('https://example.com/x')).rejects.toMatchObject({
      code: 'timeout',
    })
  })

  it('accepts a sniffed raster image and rejects non-images', async () => {
    const imageFetcher = createRecipeFetcher({
      fetchImpl: (async () =>
        new Response(pngBytes, {
          headers: {
            'Content-Type': 'image/png',
            'X-Final-Url': encodeURIComponent('https://cdn.example.com/bild.png'),
          },
        })) as unknown as typeof fetch,
    })
    const image = await imageFetcher.fetchImage('https://example.com/bild.png')
    expect(image.mimeType).toBe('image/png')
    expect(new Uint8Array(image.bytes)).toEqual(pngBytes)
    expect(image.finalUrl).toBe('https://cdn.example.com/bild.png')

    const textFetcher = createRecipeFetcher({
      fetchImpl: (async () =>
        new Response('kein bild', {
          headers: { 'Content-Type': 'text/plain' },
        })) as unknown as typeof fetch,
    })
    await expect(textFetcher.fetchImage('https://example.com/x')).rejects.toBeInstanceOf(
      RecipeFetchError,
    )
  })
})

describe('recipe fetch client in cloud mode', () => {
  it('sends the Supabase token only to the own endpoint', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ ok: true, extraction: { candidates: [], warnings: [], jsonLdBlockCount: 0, recipeObjectCount: 0, baseUrl: 'https://example.com/' }, finalUrl: 'https://example.com/' }),
    )
    const fetcher = createRecipeFetcher({
      endpoint: '/api/recipe-fetch',
      service: 'cloud',
      getAccessToken: async () => 'token-abcdefghijklmnopqrstuvwxyz',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    await fetcher.fetchPage('https://example.com/rezept')

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/recipe-fetch')
    expect((init.headers as Record<string, string>).Authorization).toBe(
      'Bearer token-abcdefghijklmnopqrstuvwxyz',
    )
    expect(init.credentials).toBe('omit')
  })

  it('rejects a missing or failed session before any network request', async () => {
    const fetchImpl = vi.fn()
    const noToken = createRecipeFetcher({
      service: 'cloud',
      getAccessToken: async () => null,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    await expect(noToken.fetchPage('https://example.com/x')).rejects.toMatchObject({
      code: 'unauthorized',
    })
    expect(fetchImpl).not.toHaveBeenCalled()

    const failed = createRecipeFetcher({
      service: 'cloud',
      getAccessToken: async () => {
        throw new Error('session unavailable')
      },
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    await expect(failed.fetchPage('https://example.com/x')).rejects.toMatchObject({
      code: 'unauthorized',
    })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('accepts server-side extraction without raw HTML', async () => {
    const extraction = {
      candidates: [
        {
          key: 'title:ofengemüse',
          title: 'Ofengemüse',
          description: '',
          servingsText: '4',
          servingsNumber: 4,
          prepTime: '',
          cookTime: '',
          totalTime: '',
          ingredientGroups: [],
          ingredients: [],
          instructions: [],
          categories: [],
          cuisine: [],
          dishType: [],
          tags: [],
          images: [],
          warnings: [],
          raw: {},
        },
      ],
      warnings: [],
      jsonLdBlockCount: 1,
      recipeObjectCount: 1,
      baseUrl: 'https://example.com/rezept',
    }
    const fetcher = createRecipeFetcher({
      service: 'cloud',
      getAccessToken: async () => 'token-abcdefghijklmnopqrstuvwxyz',
      fetchImpl: (async () =>
        jsonResponse({ ok: true, finalUrl: 'https://example.com/rezept', extraction })) as unknown as typeof fetch,
    })
    const page = await fetcher.fetchPage('https://example.com/rezept')
    expect(page.html).toBe('')
    expect(page.extraction?.candidates[0]?.title).toBe('Ofengemüse')
  })

  it('maps authentication, membership and rate-limit responses to distinct codes', async () => {
    for (const [status, serverCode, expected] of [
      [401, 'unauthorized', 'unauthorized'],
      [403, 'not-a-member', 'forbidden'],
      [429, 'rate-limited', 'rate-limited'],
    ] as const) {
      const fetcher = createRecipeFetcher({
        service: 'cloud',
        getAccessToken: async () => 'token-abcdefghijklmnopqrstuvwxyz',
        fetchImpl: (async () =>
          jsonResponse({ ok: false, code: serverCode, error: 'Meldung' }, status)) as unknown as typeof fetch,
      })
      await expect(fetcher.fetchPage('https://example.com/x')).rejects.toMatchObject({ code: expected })
    }
  })

  it('keeps the local path free of an Authorization header', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ ok: true, html: '<html></html>', finalUrl: 'https://example.com/' }),
    )
    const fetcher = createRecipeFetcher({
      endpoint: '/api/recipe-fetch',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    await fetcher.fetchPage('https://example.com/')
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined()
  })
})

describe('cloud endpoint origin guard', () => {
  it('refuses to send a token to an absolute foreign endpoint', async () => {
    const fetchImpl = vi.fn()
    const fetcher = createRecipeFetcher({
      endpoint: 'https://evil.example/api',
      service: 'cloud',
      getAccessToken: async () => 'token-abcdefghijklmnopqrstuvwxyz',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    await expect(fetcher.fetchPage('https://example.com/x')).rejects.toMatchObject({
      code: 'unavailable',
    })
    expect(fetchImpl).not.toHaveBeenCalled()

    const protocolRelative = createRecipeFetcher({
      endpoint: '//evil.example/api',
      service: 'cloud',
      getAccessToken: async () => 'token-abcdefghijklmnopqrstuvwxyz',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    await expect(protocolRelative.fetchPage('https://example.com/x')).rejects.toMatchObject({
      code: 'unavailable',
    })
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})
