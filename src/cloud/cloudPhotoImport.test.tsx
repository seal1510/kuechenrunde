import { afterEach, describe, expect, it, vi } from 'vitest'
import { CloudRecipeImageService } from '../data/cloudImages'
import type { ImageStoragePort } from '../data/imageStorage'
import type { PhotoOcrPage } from '../import/photo-ocr'
import { createTestStore, TestRecordsBackend } from './recordsTestBackend'
import {
  requestCloudPhotoOcr,
  saveCloudPhotoImportedRecipe,
} from './CloudPhotoImportPage'
import type { Recipe } from '../types'

vi.mock('../supabase/auth', () => ({
  getAccessToken: async () => 'token-123',
}))

vi.mock('../components/Markdown', () => ({
  Markdown: ({ text }: { text: string }) => <div data-markdown>{text}</div>,
  useImageUrl: () => null,
}))

class TestImageStorage implements ImageStoragePort {
  readonly files = new Map<string, { bytes: ArrayBuffer; mimeType: string }>()
  failUpload = false
  failRemove = false

  async upload(path: string, bytes: ArrayBuffer, mimeType: string): Promise<void> {
    if (this.failUpload) throw new Error('Upload fehlgeschlagen.')
    this.files.set(path, { bytes, mimeType })
  }

  async createSignedUrl(): Promise<string> {
    return 'https://signed.example/image'
  }

  async download(path: string): Promise<ArrayBuffer> {
    const file = this.files.get(path)
    if (!file) throw new Error(`Datei fehlt: ${path}`)
    return file.bytes
  }

  async remove(paths: readonly string[]): Promise<void> {
    if (this.failRemove) throw new Error('Entfernen fehlgeschlagen.')
    for (const path of paths) this.files.delete(path)
  }
}

function photoRecipe(id = 'photo-recipe'): Recipe {
  return {
    id,
    importId: 'photo-1700000000000-abcdef',
    importSource: 'photo',
    title: 'Omas Apfelkuchen',
    description: 'Aus dem Familienalbum.',
    ingredientGroups: [],
    ingredients: [],
    instructions: [],
    servingsText: '4 Portionen',
    servingsNumber: 4,
    prepTime: '20 Min.',
    cookTime: '50 Min.',
    totalTime: '',
    categories: [],
    cuisine: [],
    dishType: [],
    effort: '',
    tags: [],
    notes: '',
    nutrition: '',
    sourceUrl: '',
    favorite: false,
    wantToCook: false,
    melaDate: null,
    raw: {
      source: 'photo-ocr',
      model: '@cf/meta/llama-4-scout-17b-16e-instruct',
      pageCount: 2,
      recognizedAt: 1_700_000_000_000,
    },
    createdAt: 1,
    updatedAt: 1,
  }
}

function jpegImage(id: string): {
  id: string
  name: string
  bytes: ArrayBuffer
  mimeType: string
} {
  return {
    id,
    name: `${id}.jpg`,
    bytes: new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3]).buffer as ArrayBuffer,
    mimeType: 'image/jpeg',
  }
}

async function setup() {
  const backend = new TestRecordsBackend()
  const storage = new TestImageStorage()
  const store = await createTestStore(backend)
  const images = new CloudRecipeImageService({ records: store, storage, now: () => 500 })
  return { backend, storage, store, images }
}

describe('cloud photo import save path', () => {
  it('saves the recipe and only the confirmed page images atomically', async () => {
    const { store, storage, images } = await setup()
    const recipe = photoRecipe()
    const warnings = await saveCloudPhotoImportedRecipe(images, recipe, [
      jpegImage('page-1'),
      jpegImage('page-2'),
    ])

    expect(warnings).toEqual([])
    const stored = store.get<Recipe>('recipes', recipe.id)
    expect(stored?.data.importSource).toBe('photo')
    expect(stored?.data.title).toBe('Omas Apfelkuchen')
    expect(stored?.data.raw).toMatchObject({ source: 'photo-ocr', pageCount: 2 })

    const metaRows = store
      .list<{ id: string; recipeId: string; position: number; mimeType: string }>('images')
      .filter((row) => row.data.recipeId === recipe.id)
    expect(metaRows).toHaveLength(2)
    expect(metaRows.map((row) => row.data.position).sort()).toEqual([0, 1])
    expect(metaRows.every((row) => row.data.mimeType === 'image/jpeg')).toBe(true)
    expect(storage.files.size).toBe(2)
    // Keine zweite Rezeptdatenstruktur und kein doppeltes Speichern.
    expect(store.list('recipes')).toHaveLength(1)
  })

  it('saves the recipe without images when the checkbox stays off', async () => {
    const { store, storage, images } = await setup()
    const recipe = photoRecipe('photo-ohne-bilder')
    await saveCloudPhotoImportedRecipe(images, recipe, [])

    expect(store.get('recipes', recipe.id)).toBeDefined()
    expect(storage.files.size).toBe(0)
    expect(store.list('images')).toHaveLength(0)
  })

  it('rejects non-photo recipes instead of silently importing them', async () => {
    const { images } = await setup()
    const recipe = { ...photoRecipe(), importSource: 'url' as const }
    await expect(saveCloudPhotoImportedRecipe(images, recipe, [])).rejects.toThrow(
      /nur Foto-Rezepte/,
    )
  })

  it('does not persist the recipe when an image upload fails', async () => {
    const { store, storage, images } = await setup()
    storage.failUpload = true
    await expect(
      saveCloudPhotoImportedRecipe(images, photoRecipe('photo-fehler'), [jpegImage('page-1')]),
    ).rejects.toThrow(/Upload fehlgeschlagen/)
    expect(store.get('recipes', 'photo-fehler')).toBeUndefined()
    expect(store.list('images')).toHaveLength(0)
  })
})

describe('cloud OCR call', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('uses POST /api/recipe-ocr with the current access token', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          ok: true,
          contractVersion: 1,
          model: '@cf/meta/llama-4-scout-17b-16e-instruct',
          recipe: {
            recognized: true,
            title: 'Test',
            ingredients: [],
            steps: [],
            uncertainties: [],
            warnings: [],
          },
          pages: [{ index: 0, kind: 'recipe', note: '' }],
          usage: { promptTokens: null, completionTokens: null },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    )
    vi.stubGlobal('fetch', fetchMock)
    const page: PhotoOcrPage = {
      mimeType: 'image/jpeg',
      dataBase64: btoa('bild'),
      width: 10,
      height: 10,
    }
    const result = await requestCloudPhotoOcr([page])
    expect(result.recipe.title).toBe('Test')
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/recipe-ocr')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer token-123')
  })
})
