import { describe, expect, it } from 'vitest'
import type { CloudRecipeImageService, SaveRecipeImagesInput } from '../data/cloudImages'
import type { CloudRecipeRepository } from '../data/cloudRecipes'
import type { Recipe, RecipeImageMeta } from '../types'
import { createCloudRecipeEditorBackend } from './cloudRecipeEditorBackend'

function recipe(id: string, title: string): Recipe {
  return {
    id,
    importId: `manual-${id}`,
    importSource: 'manual',
    title,
    description: '',
    ingredientGroups: [],
    ingredients: [],
    instructions: [],
    servingsText: '2',
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
    sourceUrl: '',
    favorite: false,
    wantToCook: false,
    melaDate: null,
    raw: {},
    createdAt: 1,
    updatedAt: 1,
  }
}

function meta(id: string, position: number): RecipeImageMeta {
  return {
    id,
    recipeId: 'r1',
    position,
    mimeType: 'image/png',
    size: 12,
    storagePath: `r1/${id}`,
    createdAt: 1,
    updatedAt: 1,
  }
}

class FakeRepository {
  existing: Recipe | null = null
  rev = 3

  async load() {
    return this.existing ? { recipe: this.existing, rev: this.rev } : null
  }
}

class FakeImageService {
  metadata: RecipeImageMeta[] = []
  saved: SaveRecipeImagesInput | null = null
  deleted: { id: string; rev: number } | null = null
  warnings: string[] = []

  listForRecipe() {
    return [...this.metadata].sort((a, b) => a.position - b.position)
  }

  async saveRecipeImages(input: SaveRecipeImagesInput) {
    this.saved = input
    return { warnings: this.warnings }
  }

  async deleteRecipe(id: string, rev: number) {
    this.deleted = { id, rev }
    return { warnings: this.warnings }
  }
}

function backendFor(repository: FakeRepository, images: FakeImageService) {
  return createCloudRecipeEditorBackend(
    repository as unknown as CloudRecipeRepository,
    images as unknown as CloudRecipeImageService,
  )
}

describe('Cloud-Rezepteditor-Backend', () => {
  it('aktiviert Bilder und nennt die Bucket-MIME-Typen', () => {
    const backend = backendFor(new FakeRepository(), new FakeImageService())
    expect(backend.supportsImages).toBe(true)
    expect(backend.imageMimeTypes).toContain('image/png')
    expect(backend.imageMimeTypes).not.toContain('image/svg+xml')
    expect(backend.storageHint).toMatch(/Familien-Cloud/)
    expect(backend.storageHint).toMatch(/Familienspeicher/)
  })

  it('lädt ein neues Rezept ohne Daten', async () => {
    const backend = backendFor(new FakeRepository(), new FakeImageService())
    await expect(backend.load()).resolves.toEqual({
      recipe: null,
      images: [],
    })
  })

  it('lädt ein bestehendes Rezept mit Bild-Metadaten und Revision', async () => {
    const repository = new FakeRepository()
    repository.existing = recipe('r1', 'Alt')
    const images = new FakeImageService()
    images.metadata = [meta('img-b', 1), meta('img-a', 0)]
    const backend = backendFor(repository, images)

    await expect(backend.load('r1')).resolves.toEqual({
      recipe: repository.existing,
      images: [
        {
          id: 'img-a',
          mimeType: 'image/png',
          storagePath: 'r1/img-a',
          size: 12,
        },
        {
          id: 'img-b',
          mimeType: 'image/png',
          storagePath: 'r1/img-b',
          size: 12,
        },
      ],
      rev: 3,
    })
  })

  it('speichert Rezept und Bilder über den Bild-Service und reicht Warnungen weiter', async () => {
    const images = new FakeImageService()
    images.warnings = ['Eine alte Datei blieb zurück.']
    const backend = backendFor(new FakeRepository(), images)
    const next = recipe('r1', 'Neu')
    const editorImages = [{ id: 'img-a', bytes: new ArrayBuffer(2), mimeType: 'image/png' }]

    const result = await backend.save(next, editorImages, { isNew: false, expectedRev: 3 })

    expect(images.saved).toEqual({
      recipe: next,
      images: editorImages,
      isNew: false,
      expectedRev: 3,
    })
    expect(result).toEqual({ warnings: ['Eine alte Datei blieb zurück.'] })
  })

  it('legt ein neues Rezept ohne Revision an', async () => {
    const images = new FakeImageService()
    const backend = backendFor(new FakeRepository(), images)
    const next = recipe('r1', 'Neu')

    await backend.save(next, [], { isNew: true })
    expect(images.saved).toEqual({
      recipe: next,
      images: [],
      isNew: true,
      expectedRev: undefined,
    })
  })

  it('verweigert Updates und Löschen ohne Revision', async () => {
    const images = new FakeImageService()
    const backend = backendFor(new FakeRepository(), images)
    const next = recipe('r1', 'Neu')

    await expect(
      backend.save(next, [], { isNew: false }),
    ).rejects.toThrow(/Revisionsnummer/)
    await expect(backend.remove('r1')).rejects.toThrow(/Revisionsnummer/)
    expect(images.saved).toBeNull()
    expect(images.deleted).toBeNull()
  })

  it('löscht Rezept und Bilder mit der geladenen Revision', async () => {
    const images = new FakeImageService()
    images.warnings = ['Eine Datei blieb zurück.']
    const backend = backendFor(new FakeRepository(), images)

    const result = await backend.remove('r1', 3)

    expect(images.deleted).toEqual({ id: 'r1', rev: 3 })
    expect(result).toEqual({ warnings: ['Eine Datei blieb zurück.'] })
  })
})
