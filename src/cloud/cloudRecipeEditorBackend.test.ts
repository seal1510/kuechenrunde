import { describe, expect, it } from 'vitest'
import type { CloudRecipeRepository } from '../data/cloudRecipes'
import type { Recipe } from '../types'
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

class FakeRepository {
  existing: Recipe | null = null
  rev = 3
  created: Recipe | null = null
  updated: { recipe: Recipe; rev: number } | null = null
  removed: { id: string; rev: number } | null = null

  async load() {
    return this.existing
      ? { recipe: this.existing, rev: this.rev }
      : null
  }

  async create(next: Recipe) {
    this.created = next
    return { recipe: next, rev: 1 }
  }

  async update(next: Recipe, rev: number) {
    this.updated = { recipe: next, rev }
    return { recipe: next, rev: rev + 1 }
  }

  async remove(id: string, rev: number) {
    this.removed = { id, rev }
  }
}

function backendFor(repository: FakeRepository) {
  return createCloudRecipeEditorBackend(
    repository as unknown as CloudRecipeRepository,
  )
}

describe('Cloud-Rezepteditor-Backend', () => {
  it('deaktiviert Bilder und liefert Cloud-Hinweise', () => {
    const backend = backendFor(new FakeRepository())
    expect(backend.supportsImages).toBe(false)
    expect(backend.storageHint).toMatch(/Familien-Cloud/)
  })

  it('lädt ein neues Rezept ohne Daten', async () => {
    const backend = backendFor(new FakeRepository())
    await expect(backend.load()).resolves.toEqual({
      recipe: null,
      images: [],
    })
  })

  it('lädt ein bestehendes Rezept mit Revision und ohne Bilder', async () => {
    const repository = new FakeRepository()
    repository.existing = recipe('r1', 'Alt')
    const backend = backendFor(repository)

    await expect(backend.load('r1')).resolves.toEqual({
      recipe: repository.existing,
      images: [],
      rev: 3,
    })
  })

  it('legt neu an und aktualisiert bestehende Rezepte mit Revision', async () => {
    const repository = new FakeRepository()
    const backend = backendFor(repository)
    const next = recipe('r1', 'Neu')

    await backend.save(next, [], { isNew: true })
    expect(repository.created).toBe(next)

    await backend.save(next, [], { isNew: false, expectedRev: 3 })
    expect(repository.updated).toEqual({ recipe: next, rev: 3 })
  })

  it('verweigert Updates und Löschen ohne Revision', async () => {
    const backend = backendFor(new FakeRepository())
    const next = recipe('r1', 'Neu')

    await expect(
      backend.save(next, [], { isNew: false }),
    ).rejects.toThrow(/Revisionsnummer/)
    await expect(backend.remove('r1')).rejects.toThrow(/Revisionsnummer/)
  })

  it('löscht mit der geladenen Revision', async () => {
    const repository = new FakeRepository()
    const backend = backendFor(repository)

    await backend.remove('r1', 3)
    expect(repository.removed).toEqual({ id: 'r1', rev: 3 })
  })
})
