import { beforeEach, describe, expect, it } from 'vitest'
import type { Recipe } from '../types'
import { CloudConflictError } from './cloudErrors'
import { CloudRecipeRepository } from './cloudRecipes'
import {
  CloudRecordsStore,
  type ApplyOpsPayload,
  type ApplyOpsResult,
  type RecordRow,
  type RecordsBackend,
  type RecordsSubscriptionHandlers,
} from './cloudRecords'

function recipe(id: string, title: string, updatedAt: number): Recipe {
  return {
    id,
    importId: `mela-${id}`,
    importSource: 'mela',
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
    updatedAt,
  }
}

class MinimalBackend implements RecordsBackend {
  readonly rows = new Map<string, RecordRow>()

  async snapshot(): Promise<RecordRow[]> {
    return [...this.rows.values()].map((row) => structuredClone(row))
  }

  async fetch(_collection: string, id: string): Promise<RecordRow | null> {
    const row = [...this.rows.values()].find((entry) => entry.id === id)
    return row ? structuredClone(row) : null
  }

  async applyOps(payload: ApplyOpsPayload): Promise<ApplyOpsResult> {
    const applied: ApplyOpsResult['applied'] = []
    for (const upsert of payload.upserts) {
      const existing = this.rows.get(upsert.id)
      if (upsert.expected_rev === 0 && existing) throw new CloudConflictError()
      if (upsert.expected_rev > 0 && (!existing || existing.rev !== upsert.expected_rev)) {
        throw new CloudConflictError()
      }
      const rev = existing ? existing.rev + 1 : 1
      this.rows.set(upsert.id, {
        collection: upsert.collection,
        id: upsert.id,
        rev,
        data: structuredClone(upsert.data),
      })
      applied.push({ collection: upsert.collection, id: upsert.id, rev })
    }

    const deleted: ApplyOpsResult['deleted'] = []
    for (const remove of payload.deletes) {
      const existing = this.rows.get(remove.id)
      if (!existing) continue
      if (remove.expected_rev !== null && existing.rev !== remove.expected_rev) {
        throw new CloudConflictError()
      }
      this.rows.delete(remove.id)
      deleted.push({ collection: remove.collection, id: remove.id })
    }
    return { applied, deleted }
  }

  subscribe(_handlers: RecordsSubscriptionHandlers): () => void {
    return () => {}
  }
}

describe('CloudRecipeRepository (vertikaler Pfad)', () => {
  let backend: MinimalBackend
  let repository: CloudRecipeRepository

  beforeEach(async () => {
    backend = new MinimalBackend()
    const store = new CloudRecordsStore(backend)
    await store.load()
    repository = new CloudRecipeRepository(store)
  })

  it('legt ein Rezept mit unveränderter ID an und liest es zurück', async () => {
    const created = await repository.create(recipe('r1', 'Kartoffelsuppe', 10))
    expect(created.recipe.id).toBe('r1')
    expect(created.rev).toBe(1)

    const loaded = await repository.load('r1')
    expect(loaded?.recipe.title).toBe('Kartoffelsuppe')
    expect(loaded?.rev).toBe(1)
    expect(repository.list()).toHaveLength(1)
  })

  it('aktualisiert mit Compare-and-Swap und meldet einen Konflikt', async () => {
    await repository.create(recipe('r1', 'Alt', 10))
    const updated = await repository.update(recipe('r1', 'Neu', 20), 1)
    expect(updated.rev).toBe(2)
    expect(updated.recipe.title).toBe('Neu')

    await expect(repository.update(recipe('r1', 'Veraltet', 30), 1)).rejects.toThrow(
      'zwischenzeitlich geändert',
    )
    expect((await repository.load('r1'))?.recipe.title).toBe('Neu')
  })

  it('löscht nur mit passender Revision', async () => {
    await repository.create(recipe('r2', 'Weg damit', 10))
    await repository.remove('r2', 1)
    expect(await repository.load('r2')).toBeNull()
    expect(backend.rows.size).toBe(0)
  })
})
