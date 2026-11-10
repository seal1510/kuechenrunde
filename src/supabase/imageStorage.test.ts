import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { CloudImageError } from '../data/cloudErrors'
import { RECIPE_IMAGES_BUCKET } from '../data/imageStorage'
import { createSupabaseImageStorage } from './imageStorage'

function fakeClient(options: {
  uploadError?: { message: string; code?: string } | null
  signedError?: { message: string; code?: string } | null
  removeError?: { message: string; code?: string } | null
  signedUrl?: string
} = {}) {
  const calls = {
    buckets: [] as string[],
    uploads: [] as Array<{ path: string; bytes: ArrayBuffer; options: unknown }>,
    signed: [] as Array<{ path: string; expiresIn: number }>,
    removals: [] as string[][],
  }
  const client = {
    storage: {
      from(bucket: string) {
        calls.buckets.push(bucket)
        return {
          async upload(path: string, bytes: ArrayBuffer, uploadOptions: unknown) {
            calls.uploads.push({ path, bytes, options: uploadOptions })
            return options.uploadError
              ? { data: null, error: options.uploadError }
              : { data: { path }, error: null }
          },
          async createSignedUrl(path: string, expiresIn: number) {
            calls.signed.push({ path, expiresIn })
            return options.signedError
              ? { data: null, error: options.signedError }
              : { data: { signedUrl: options.signedUrl ?? 'https://signed.invalid/x' }, error: null }
          },
          async remove(paths: string[]) {
            calls.removals.push([...paths])
            return options.removeError
              ? { data: null, error: options.removeError }
              : { data: paths.map((path) => ({ name: path })), error: null }
          },
        }
      },
    },
  } as unknown as SupabaseClient
  return { client, calls }
}

describe('Supabase-Bildspeicher', () => {
  it('lädt in den privaten Bucket hoch und überschreibt nichts', async () => {
    const { client, calls } = fakeClient()
    const storage = createSupabaseImageStorage(client)
    const bytes = new Uint8Array([1, 2, 3]).buffer

    await storage.upload('r1/img-a', bytes, 'image/png')

    expect(calls.buckets).toEqual([RECIPE_IMAGES_BUCKET])
    expect(calls.uploads).toEqual([
      {
        path: 'r1/img-a',
        bytes,
        options: {
          contentType: 'image/png',
          upsert: false,
          cacheControl: '3600',
        },
      },
    ])
  })

  it('erzeugt Signed URLs ausschließlich über die Storage-API', async () => {
    const { client, calls } = fakeClient({ signedUrl: 'https://signed.invalid/abc' })
    const storage = createSupabaseImageStorage(client)

    await expect(storage.createSignedUrl('r1/img-a', 3600)).resolves.toBe(
      'https://signed.invalid/abc',
    )
    expect(calls.signed).toEqual([{ path: 'r1/img-a', expiresIn: 3600 }])
  })

  it('entfernt doppelte Pfade in einem Aufruf', async () => {
    const { client, calls } = fakeClient()
    const storage = createSupabaseImageStorage(client)

    await storage.remove(['r1/img-a', 'r1/img-a', 'r1/img-b', ''])
    expect(calls.removals).toEqual([['r1/img-a', 'r1/img-b']])
  })

  it('übersetzt Storage-Fehler in verständliche Bildfehler', async () => {
    const upload = createSupabaseImageStorage(
      fakeClient({ uploadError: { message: 'Row level security', code: '42501' } }).client,
    )
    await expect(
      upload.upload('r1/img-a', new ArrayBuffer(1), 'image/png'),
    ).rejects.toBeInstanceOf(CloudImageError)

    const signed = createSupabaseImageStorage(
      fakeClient({ signedError: { message: 'not found', code: '404' } }).client,
    )
    await expect(signed.createSignedUrl('r1/img-a', 60)).rejects.toThrow(
      /konnte nicht aus dem Familienspeicher geladen werden/,
    )

    const remove = createSupabaseImageStorage(
      fakeClient({ removeError: { message: 'denied', code: '42501' } }).client,
    )
    await expect(remove.remove(['r1/img-a'])).rejects.toThrow(
      /konnte nicht aus dem Familienspeicher entfernt werden/,
    )
  })
})
