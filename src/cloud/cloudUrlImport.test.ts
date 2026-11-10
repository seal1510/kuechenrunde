import { beforeEach, describe, expect, it } from 'vitest'
import { CloudRecipeRepository } from '../data/cloudRecipes'
import { CloudRecipeImageService } from '../data/cloudImages'
import type { ImageStoragePort } from '../data/imageStorage'
import { createTestStore, TestRecordsBackend } from './recordsTestBackend'
import {
  findCloudUrlImportDuplicates,
  saveCloudUrlImportedRecipe,
} from './cloudUrlImport'
import type { Recipe } from '../types'

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

function urlRecipe(id: string, importId: string, title: string, sourceUrl: string): Recipe {
  return {
    id,
    importId,
    importSource: 'url',
    title,
    description: '',
    ingredientGroups: [],
    ingredients: [],
    instructions: [],
    servingsText: '2 Portionen',
    servingsNumber: 2,
    prepTime: '',
    cookTime: '',
    totalTime: '',
    categories: [],
    cuisine: [],
    dishType: [],
    effort: '',
    tags: [],
    notes: '',
    nutrition: '',
    sourceUrl,
    importUrl: sourceUrl,
    importMeta: {
      source: 'url',
      originalUrl: sourceUrl,
      finalUrl: sourceUrl,
      candidateKey: 'id:recipe',
      fetchedAt: 1,
      imageSourceUrls: [],
      imageWarnings: [],
    },
    favorite: false,
    wantToCook: false,
    melaDate: null,
    raw: { source: 'jsonld' },
    createdAt: 1,
    updatedAt: 1,
  }
}

function manualRecipe(id: string, title: string, sourceUrl: string): Recipe {
  return {
    ...urlRecipe(id, `manual-${id}`, title, sourceUrl),
    importSource: 'manual',
    importId: `manual-${id}`,
    importUrl: undefined,
    importMeta: undefined,
  }
}

const pngBytes = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4,
]).buffer

let backend: TestRecordsBackend
let storage: TestImageStorage
let store: Awaited<ReturnType<typeof createTestStore>>
let images: CloudRecipeImageService
let repository: CloudRecipeRepository

beforeEach(async () => {
  backend = new TestRecordsBackend()
  storage = new TestImageStorage()
  store = await createTestStore(backend)
  images = new CloudRecipeImageService({ records: store, storage, now: () => 500 })
  repository = new CloudRecipeRepository(store)
})

describe('cloud URL import', () => {
  it('applies the local duplicate rules to the loaded cloud snapshot', async () => {
    const exact = urlRecipe('r1', 'url-1', 'Ofengemüse', 'https://example.com/rezept')
    const other = urlRecipe('r2', 'url-2', 'Anderes', 'https://example.com/anderes')
    const manual = manualRecipe('r3', 'Manuell', 'https://example.com/rezept')
    const otherStore = await createTestStore(backend, [
      ['recipes', exact.id, exact],
      ['recipes', other.id, other],
      ['recipes', manual.id, manual],
    ])
    const otherRepository = new CloudRecipeRepository(otherStore)

    const info = findCloudUrlImportDuplicates(
      otherRepository,
      'https://example.com/rezept#hash',
      'id:recipe',
    )
    expect(info.exact?.id).toBe('r1')
    expect(info.sameSource.map((recipe) => recipe.id)).toEqual(['r3'])

    const differentCandidate = findCloudUrlImportDuplicates(
      otherRepository,
      'https://example.com/rezept',
      'title:anderes-rezept',
    )
    expect(differentCandidate.exact).toBeNull()
    expect(differentCandidate.sameSource.map((recipe) => recipe.id)).toEqual(['r1', 'r3'])
  })

  it('stores the recipe and its image through the existing Supabase image path', async () => {
    const recipe = urlRecipe('r1', 'url-1', 'Ofengemüse', 'https://example.com/rezept')
    const warnings = await saveCloudUrlImportedRecipe(images, recipe, [
      { id: 'img-1', bytes: pngBytes, mimeType: 'image/png' },
    ])
    expect(warnings).toEqual([])

    const storedRecipe = backend.row<Recipe>('recipes', 'r1')
    expect(storedRecipe?.data.title).toBe('Ofengemüse')
    expect(storedRecipe?.data.importMeta?.candidateKey).toBe('id:recipe')
    const storedImage = backend.row<{ storagePath: string; mimeType: string }>('images', 'img-1')
    expect(storedImage?.data.storagePath).toBe('r1/img-1')
    expect(storedImage?.data.mimeType).toBe('image/png')
    expect(storage.files.get('r1/img-1')?.bytes).toBe(pngBytes)
  })

  it('saves a recipe without images and allows a confirmed second copy', async () => {
    const first = urlRecipe('r1', 'url-1', 'Ofengemüse', 'https://example.com/rezept')
    const second = urlRecipe('r2', 'url-2', 'Ofengemüse', 'https://example.com/rezept')
    await saveCloudUrlImportedRecipe(images, first, [])
    await saveCloudUrlImportedRecipe(images, second, [])
    expect(backend.rows.size).toBe(2)
    expect(repository.list()).toHaveLength(2)
  })

  it('leaves no recipe behind when an image upload fails', async () => {
    storage.failUpload = true
    const recipe = urlRecipe('r1', 'url-1', 'Ofengemüse', 'https://example.com/rezept')
    await expect(
      saveCloudUrlImportedRecipe(images, recipe, [
        { id: 'img-1', bytes: pngBytes, mimeType: 'image/png' },
      ]),
    ).rejects.toThrow(/Upload/)
    expect(backend.row('recipes', 'r1')).toBeUndefined()
    expect(backend.row('images', 'img-1')).toBeUndefined()
  })

  it('removes uploaded files when the metadata transaction fails', async () => {
    const recipe = urlRecipe('r1', 'url-1', 'Ofengemüse', 'https://example.com/rezept')
    backend.failNext = new Error('Metadaten-Transaktion fehlgeschlagen')
    await expect(
      saveCloudUrlImportedRecipe(images, recipe, [
        { id: 'img-1', bytes: pngBytes, mimeType: 'image/png' },
      ]),
    ).rejects.toThrow(/Metadaten/)
    expect(backend.row('recipes', 'r1')).toBeUndefined()
    expect(storage.files.size).toBe(0)
  })

  it('rejects importing anything that is not a URL recipe', async () => {
    const manual = manualRecipe('m1', 'Manuell', 'https://example.com/rezept')
    await expect(saveCloudUrlImportedRecipe(images, manual, [])).rejects.toThrow(
      /nur URL-Rezepte/,
    )
    expect(backend.rows.size).toBe(0)
  })
})
