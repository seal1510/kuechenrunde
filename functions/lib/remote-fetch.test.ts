import { describe, expect, it, vi } from 'vitest'
import {
  CloudFetchError,
  fetchCloudRecipeHtml,
  fetchCloudRecipeImage,
} from './remote-fetch'
import { UrlSafetyError } from '../../src/import/remote-url-policy'

const pngBytes = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4,
])

function htmlResponse(body = '<html></html>'): Response {
  return new Response(body, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  })
}

describe('Cloudflare remote fetch', () => {
  it('follows redirects manually, revalidates the target and forwards no credentials', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === 'https://example.com/start') {
        return new Response(null, {
          status: 302,
          headers: { Location: 'https://cdn.example.org/final' },
        })
      }
      return htmlResponse('<html><body>Rezept</body></html>')
    }) as unknown as typeof fetch

    const page = await fetchCloudRecipeHtml('https://example.com/start', { fetchImpl })
    expect(page.finalUrl).toBe('https://cdn.example.org/final')
    expect(page.html).toContain('Rezept')
    expect(fetchImpl).toHaveBeenCalledTimes(2)

    const firstInit = (fetchImpl as unknown as { mock: { calls: Array<[string, RequestInit]> } })
      .mock.calls[0]![1]
    expect(firstInit.method).toBe('GET')
    expect(firstInit.redirect).toBe('manual')
    expect(firstInit.cache).toBe('no-store')
    const headers = firstInit.headers as Headers
    expect(headers.get('cookie')).toBeNull()
    expect(headers.get('authorization')).toBeNull()
    expect(headers.get('referer')).toBeNull()
    expect(headers.get('origin')).toBeNull()
    expect(headers.get('host')).toBeNull()
  })

  it('rejects a redirect to a private or non-HTTP target before the next request', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(null, {
        status: 302,
        headers: { Location: 'http://169.254.169.254/latest/meta-data' },
      }),
    ) as unknown as typeof fetch

    await expect(fetchCloudRecipeHtml('https://example.com/start', { fetchImpl })).rejects.toBeInstanceOf(
      UrlSafetyError,
    )
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('rejects redirects without a target and too many hops', async () => {
    const missing = vi.fn(async () => new Response(null, { status: 302 })) as unknown as typeof fetch
    await expect(fetchCloudRecipeHtml('https://example.com/start', { fetchImpl: missing })).rejects.toMatchObject(
      { code: 'redirect' },
    )

    const endless = vi.fn(async () =>
      new Response(null, {
        status: 302,
        headers: { Location: '/again' },
      }),
    ) as unknown as typeof fetch
    await expect(fetchCloudRecipeHtml('https://example.com/start', { fetchImpl: endless })).rejects.toMatchObject(
      { code: 'redirect' },
    )
    expect(endless).toHaveBeenCalledTimes(6)
  })

  it('rejects non-HTML content, HTTP errors and oversized declarations', async () => {
    const json = (async () =>
      new Response('{}', { headers: { 'Content-Type': 'application/json' } })) as unknown as typeof fetch
    await expect(fetchCloudRecipeHtml('https://example.com/', { fetchImpl: json })).rejects.toMatchObject({
      code: 'not-html',
    })

    const notFound = (async () => new Response('nope', { status: 404 })) as unknown as typeof fetch
    await expect(fetchCloudRecipeHtml('https://example.com/', { fetchImpl: notFound })).rejects.toMatchObject({
      code: 'http',
    })

    const huge = (async () =>
      new Response('x', {
        headers: {
          'Content-Type': 'text/html',
          'Content-Length': String(6 * 1024 * 1024),
        },
      })) as unknown as typeof fetch
    await expect(fetchCloudRecipeHtml('https://example.com/', { fetchImpl: huge })).rejects.toMatchObject({
      code: 'too-large',
    })
  })

  it('enforces the byte cap while reading, not only via Content-Length', async () => {
    const chunk = new Uint8Array(1024 * 1024)
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let index = 0; index < 6; index += 1) controller.enqueue(chunk)
        controller.close()
      },
    })
    const fetchImpl = (async () =>
      new Response(stream, {
        headers: { 'Content-Type': 'text/html' },
      })) as unknown as typeof fetch

    await expect(fetchCloudRecipeHtml('https://example.com/', { fetchImpl })).rejects.toMatchObject({
      code: 'too-large',
    })
  })

  it('maps a stalled request to a timeout and a rejected connection to network', async () => {
    const stalled = ((_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const error = new Error('aborted')
          error.name = 'AbortError'
          reject(error)
        })
      })) as unknown as typeof fetch
    await expect(
      fetchCloudRecipeHtml('https://example.com/', { fetchImpl: stalled, timeoutMs: 10 }),
    ).rejects.toMatchObject({ code: 'timeout' })

    const broken = (async () => {
      throw new TypeError('connection refused')
    }) as unknown as typeof fetch
    await expect(fetchCloudRecipeHtml('https://example.com/', { fetchImpl: broken })).rejects.toMatchObject({
      code: 'network',
    })
  })

  it('accepts only raster image signatures', async () => {
    const image = (async () =>
      new Response(pngBytes, { headers: { 'Content-Type': 'image/png' } })) as unknown as typeof fetch
    const fetched = await fetchCloudRecipeImage('https://cdn.example.com/bild.png', {
      fetchImpl: image,
    })
    expect(fetched.mimeType).toBe('image/png')
    expect(fetched.bytes).toEqual(pngBytes)

    const svg = (async () =>
      new Response('<svg></svg>', { headers: { 'Content-Type': 'image/svg+xml' } })) as unknown as typeof fetch
    await expect(
      fetchCloudRecipeImage('https://cdn.example.com/bild.svg', { fetchImpl: svg }),
    ).rejects.toBeInstanceOf(CloudFetchError)

    const disguisedHtml = (async () =>
      new Response('<html></html>', { headers: { 'Content-Type': 'image/png' } })) as unknown as typeof fetch
    await expect(
      fetchCloudRecipeImage('https://cdn.example.com/bild.png', { fetchImpl: disguisedHtml }),
    ).rejects.toMatchObject({ code: 'not-image' })
  })

  it('rejects unsafe start URLs before any network request', async () => {
    const fetchImpl = vi.fn()
    await expect(
      fetchCloudRecipeHtml('http://127.0.0.1/secret', { fetchImpl: fetchImpl as unknown as typeof fetch }),
    ).rejects.toBeInstanceOf(UrlSafetyError)
    expect(fetchImpl).not.toHaveBeenCalled()

    await expect(
      fetchCloudRecipeImage('https://8.8.8.8/bild.png', { fetchImpl: fetchImpl as unknown as typeof fetch }),
    ).rejects.toBeInstanceOf(UrlSafetyError)
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})
