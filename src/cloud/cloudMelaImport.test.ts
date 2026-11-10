import { beforeEach, describe, expect, it } from 'vitest'
import type { ImageStoragePort } from '../data/imageStorage'
import { CloudRecipeImageService } from '../data/cloudImages'
import type { CloudRecordsStore } from '../data/cloudRecords'
import { createTestStore, TestRecordsBackend } from './recordsTestBackend'
import { recipeFromParsedMela } from '../import/melaRecipe'
import {
  existingCloudImportIds,
  importMelaRecipesToCloud,
} from './cloudMelaImport'
import type { ParsedMelaRecipe, ParsedImage, Recipe } from '../types'

class TestStorage implements ImageStoragePort {
  readonly objects = new Map<string, { bytes: Uint8Array; mimeType: string }>()
  readonly uploaded: string[] = []
  failUpload: Error | null = null

  async upload(path: string, bytes: ArrayBuffer, mimeType: string): Promise<void> {
    if (this.failUpload) {
      const error = this.failUpload
      this.failUpload = null
      throw error
    }
    this.uploaded.push(path)
    this.objects.set(path, { bytes: new Uint8Array(bytes), mimeType })
  }

  async createSignedUrl(): Promise<string> {
    return 'https://signed.example/image'
  }

  async download(path: string): Promise<ArrayBuffer> {
    const object = this.objects.get(path)
    if (!object) throw new Error(`Datei fehlt: ${path}`)
    return object.bytes.slice().buffer as ArrayBuffer
  }

  async remove(paths: readonly string[]): Promise<void> {
    for (const path of paths) this.objects.delete(path)
  }
}

function image(mimeType: string, bytes: number[]): ParsedImage {
  return { mimeType, bytes: new Uint8Array(bytes).buffer }
}

function parsed(
  importId: string,
  title: string,
  images: ParsedImage[] = [],
  warnings: string[] = [],
): ParsedMelaRecipe {
  return {
    importId,
    title,
    description: `${title} Beschreibung`,
    ingredientGroups: [],
    ingredients: [
      {
        id: 'i1',
        groupId: null,
        position: 0,
        raw: '2 Zwiebeln',
        name: 'Zwiebeln',
        quantity: 2,
        quantityText: '2',
        unit: null,
        parseStatus: 'parsed',
        links: [],
      },
    ],
    instructions: [{ id: 's1', position: 0, raw: 'Kochen', text: 'Kochen' }],
    servingsText: '2',
    servingsNumber: 2,
    prepTime: '5 Min.',
    cookTime: '',
    totalTime: '5 Min.',
    categories: ['Mela'],
    notes: '',
    nutrition: '',
    sourceUrl: '',
    favorite: false,
    wantToCook: false,
    melaDate: null,
    images,
    warnings,
    raw: { source: 'mela', title },
  }
}

let backend: TestRecordsBackend
let store: CloudRecordsStore
let storage: TestStorage
let images: CloudRecipeImageService

beforeEach(async () => {
  backend = new TestRecordsBackend()
  store = await createTestStore(backend)
  storage = new TestStorage()
  images = new CloudRecipeImageService({ records: store, storage, now: () => 500 })
})

describe('cloud Mela import', () => {
  it('finds existing import ids in the loaded cloud snapshot', async () => {
    const existing = parsed('mela-1', 'Vorhanden')
    backend.seed('recipes', 'r1', recipeFromParsedMela(existing, 'r1') satisfies Recipe)
    await store.load()
    const found = await existingCloudImportIds(store, ['mela-1', 'mela-2'])
    expect([...found]).toEqual(['mela-1'])
  })

  it('imports a recipe without images into the shared library', async () => {
    const result = await importMelaRecipesToCloud(store, images, [
      parsed('mela-1', 'Ohne Bild'),
    ])
    expect(result).toMatchObject({ imported: 1, duplicates: 0, images: 0 })
    expect(result.failed).toEqual([])
    const row = backend.row<Recipe>('recipes', store.list<Recipe>('recipes')[0]!.id)
    expect(row?.data.importSource).toBe('mela')
    expect(row?.data.importId).toBe('mela-1')
    expect(row?.data.title).toBe('Ohne Bild')
    expect(row?.data.ingredients[0]?.quantity).toBe(2)
  })

  it('imports recipe images through the existing Supabase storage path', async () => {
    const result = await importMelaRecipesToCloud(store, images, [
      parsed('mela-1', 'Mit Bild', [image('image/png', [1, 2, 3])]),
    ])
    expect(result).toMatchObject({ imported: 1, images: 1 })
    const recipe = store.list<Recipe>('recipes')[0]!.data
    const imageRows = store.list<{ id: string; recipeId: string; storagePath: string }>('images')
    expect(imageRows).toHaveLength(1)
    expect(imageRows[0]!.data.recipeId).toBe(recipe.id)
    expect(imageRows[0]!.data.storagePath).toBe(`${recipe.id}/${imageRows[0]!.id}`)
    expect(storage.objects.get(imageRows[0]!.data.storagePath)?.bytes).toEqual(
      new Uint8Array([1, 2, 3]),
    )
  })

  it('imports several recipes and skips existing duplicates', async () => {
    backend.seed(
      'recipes',
      'existing',
      recipeFromParsedMela(parsed('mela-old', 'Schon da'), 'existing') satisfies Recipe,
    )
    await store.load()

    const seen: string[] = []
    const result = await importMelaRecipesToCloud(
      store,
      images,
      [
        parsed('mela-old', 'Schon da'),
        parsed('mela-2', 'Zweites'),
        parsed('mela-3', 'Drittes'),
      ],
      (progress) => seen.push(`${progress.current}/${progress.total}:${progress.title}`),
    )
    expect(result.imported).toBe(2)
    expect(result.duplicates).toBe(1)
    expect(store.list<Recipe>('recipes')).toHaveLength(3)
    expect(seen).toEqual([
      '1/3:Schon da',
      '2/3:Zweites',
      '3/3:Drittes',
    ])
  })

  it('keeps the recipe when an unsupported image is skipped with a warning', async () => {
    const result = await importMelaRecipesToCloud(store, images, [
      parsed('mela-1', 'HEIC-Rezept', [image('image/heic', [1, 2, 3])]),
    ])
    expect(result.imported).toBe(1)
    expect(result.images).toBe(0)
    expect(result.warnings).toHaveLength(1)
    expect(result.warnings[0]?.message).toMatch(/nicht erlaubtes Format/)
    expect(store.list('images')).toHaveLength(0)
  })

  it('reports a failed image upload and leaves no partial recipe behind', async () => {
    storage.failUpload = new Error('Netzwerkfehler')
    const result = await importMelaRecipesToCloud(store, images, [
      parsed('mela-1', 'Mit Bild', [image('image/png', [1, 2, 3])]),
    ])
    expect(result.imported).toBe(0)
    expect(result.failed).toHaveLength(1)
    expect(result.failed[0]?.message).toMatch(/Netzwerkfehler/)
    expect(store.list('recipes')).toHaveLength(0)
    expect(store.list('images')).toHaveLength(0)
    expect(storage.objects.size).toBe(0)
  })

  it('keeps parsed warnings in the import result', async () => {
    const result = await importMelaRecipesToCloud(store, images, [
      parsed('mela-1', 'Mit Hinweis', [], ['Eine Zutat war unklar.']),
    ])
    expect(result.warnings).toEqual([
      { title: 'Mit Hinweis', message: 'Eine Zutat war unklar.' },
    ])
  })
})
