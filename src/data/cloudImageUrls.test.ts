import { describe, expect, it } from 'vitest'
import { CloudImageUrlCache } from './cloudImageUrls'
import type { ImageStoragePort } from './imageStorage'

class SignedUrlStorage {
  calls: Array<{ path: string; expiresIn: number }> = []
  failNext: Error | null = null
  private counter = 0

  async upload(): Promise<void> {
    throw new Error('not used')
  }

  async remove(): Promise<void> {
    throw new Error('not used')
  }

  async createSignedUrl(path: string, expiresIn: number): Promise<string> {
    this.calls.push({ path, expiresIn })
    if (this.failNext) {
      const error = this.failNext
      this.failNext = null
      throw error
    }
    this.counter += 1
    return `https://signed.invalid/${encodeURIComponent(path)}?v=${this.counter}`
  }
}

function storagePort(storage: SignedUrlStorage): Pick<ImageStoragePort, 'createSignedUrl'> {
  return { createSignedUrl: (path, expiresIn) => storage.createSignedUrl(path, expiresIn) }
}

describe('CloudImageUrlCache', () => {
  it('teilt Anfragen für dasselbe Bild und cached die Signed URL', async () => {
    const storage = new SignedUrlStorage()
    const cache = new CloudImageUrlCache({
      storage: storagePort(storage),
      lifetimeSeconds: 3600,
      refreshMarginSeconds: 300,
      now: () => 1_000,
    })

    const [first, second] = await Promise.all([
      cache.getUrl('r1/img-a'),
      cache.getUrl('r1/img-a'),
    ])

    expect(first.url).toBe(second.url)
    expect(storage.calls).toEqual([{ path: 'r1/img-a', expiresIn: 3600 }])
    expect((await cache.getUrl('r1/img-a')).url).toBe(first.url)
    expect(storage.calls).toHaveLength(1)
    expect(cache.peek('r1/img-a')?.url).toBe(first.url)
  })

  it('erneuert die Signed URL vor dem Ablauf', async () => {
    const storage = new SignedUrlStorage()
    let now = 0
    const cache = new CloudImageUrlCache({
      storage: storagePort(storage),
      lifetimeSeconds: 100,
      refreshMarginSeconds: 10,
      now: () => now,
    })

    const first = await cache.getUrl('r1/img-a')
    now = 89_000
    expect((await cache.getUrl('r1/img-a')).url).toBe(first.url)
    expect(storage.calls).toHaveLength(1)

    now = 91_000
    const renewed = await cache.getUrl('r1/img-a')
    expect(renewed.url).not.toBe(first.url)
    expect(storage.calls).toHaveLength(2)
    expect(cache.peek('r1/img-a')?.url).toBe(renewed.url)
  })

  it('verwendet bei einem Erneuerungsfehler die noch gültige alte URL', async () => {
    const storage = new SignedUrlStorage()
    let now = 0
    const cache = new CloudImageUrlCache({
      storage: storagePort(storage),
      lifetimeSeconds: 100,
      refreshMarginSeconds: 10,
      now: () => now,
    })

    const first = await cache.getUrl('r1/img-a')
    now = 95_000
    storage.failNext = new Error('Netzwerkfehler')

    const fallback = await cache.getUrl('r1/img-a')
    expect(fallback.url).toBe(first.url)
    expect(fallback.refreshAt).toBeLessThanOrEqual(first.expiresAt)
    expect(fallback.refreshAt).toBeGreaterThan(now)

    now = 100_000
    storage.failNext = new Error('weiterhin nicht erreichbar')
    await expect(cache.getUrl('r1/img-a')).rejects.toThrow()
  })

  it('verwirft URLs bei clear und nach dispose', async () => {
    const storage = new SignedUrlStorage()
    let now = 0
    const cache = new CloudImageUrlCache({
      storage: storagePort(storage),
      lifetimeSeconds: 100,
      refreshMarginSeconds: 10,
      now: () => now,
    })

    await cache.getUrl('r1/img-a')
    cache.clear()
    expect(cache.peek('r1/img-a')).toBeNull()
    now = 1
    await cache.getUrl('r1/img-a')
    expect(storage.calls).toHaveLength(2)

    cache.dispose()
    await expect(cache.getUrl('r1/img-a')).rejects.toThrow(/beendet/)
  })

  it('invalidiert einen einzelnen Pfad', async () => {
    const storage = new SignedUrlStorage()
    const cache = new CloudImageUrlCache({
      storage: storagePort(storage),
      lifetimeSeconds: 100,
      refreshMarginSeconds: 10,
      now: () => 0,
    })

    await cache.getUrl('r1/img-a')
    cache.invalidate('r1/img-a')
    expect(cache.peek('r1/img-a')).toBeNull()
    await cache.getUrl('r1/img-a')
    expect(storage.calls).toHaveLength(2)
  })

  it('lehnt ungültige Laufzeiten ab', () => {
    const storage = new SignedUrlStorage()
    expect(
      () =>
        new CloudImageUrlCache({
          storage: storagePort(storage),
          lifetimeSeconds: 60,
          refreshMarginSeconds: 60,
        }),
    ).toThrow(/vorlaufzeit/i)
    expect(
      () =>
        new CloudImageUrlCache({
          storage: storagePort(storage),
          lifetimeSeconds: 0,
        }),
    ).toThrow(/Gültigkeitsdauer/)
  })
})
