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
