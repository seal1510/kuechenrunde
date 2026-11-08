import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../db'
import type { Recipe } from '../types'
import { loadRecipeEditorData, saveRecipeWithImages } from './repository'

function makeRecipe(overrides: Partial<Recipe> = {}): Recipe {
  return {
    id: 'r1',
    importId: 'manual-r1',
    importSource: 'manual',
    title: 'Rezept',
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
    raw: { source: 'manual' },
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }
}

function bytes(values: number[]): ArrayBuffer {
  const data = new Uint8Array(values)
  return data.buffer as ArrayBuffer
}

beforeEach(async () => {
  await db.recipes.clear()
  await db.images.clear()
})

describe('recipe image repository', () => {
  it('saves ordered images and removes deselected ones', async () => {
    const recipe = makeRecipe()
    await saveRecipeWithImages(recipe, [
      { id: 'img-a', bytes: bytes([1, 2]), mimeType: 'image/png' },
      { id: 'img-b', bytes: bytes([3, 4]), mimeType: 'image/jpeg' },
    ])

    const loaded = await loadRecipeEditorData('r1')
    expect(loaded?.images.map((image) => image.id)).toEqual(['img-a', 'img-b'])
    expect(loaded?.images[0]?.position).toBe(0)
    expect(new Uint8Array(loaded!.images[1]!.bytes)).toEqual(new Uint8Array([3, 4]))

    await saveRecipeWithImages(
      { ...recipe, title: 'Geändert', updatedAt: 2 },
      [{ id: 'img-b', bytes: bytes([3, 4]), mimeType: 'image/jpeg' }],
    )
    const after = await loadRecipeEditorData('r1')
    expect(after?.recipe.title).toBe('Geändert')
    expect(after?.images.map((image) => image.id)).toEqual(['img-b'])
    expect(after?.images[0]?.position).toBe(0)
  })

  it('returns null for a missing recipe', async () => {
    expect(await loadRecipeEditorData('missing')).toBeNull()
  })
})
