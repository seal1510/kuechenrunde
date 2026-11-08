import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../db'
import { deleteAllData } from './importer'
import { extractRecipeCandidates } from './jsonld'
import { saveRecipeWithImages } from '../recipe/repository'
import {
  buildUrlRecipe,
  candidateImportKey,
  downloadCandidateImages,
  draftFromUrlCandidate,
  findUrlImportDuplicates,
  importIdForCandidate,
  type UrlImportContext,
} from './url-import'
import type { Recipe } from '../types'
import type { RecipeUrlFetcher } from './url-fetcher'

const jsonLd = {
  '@context': 'https://schema.org',
  '@type': 'Recipe',
  '@id': 'https://example.com/rezept#recipe',
  name: 'Ofengemüse',
  description: 'Einfach und lecker.',
  recipeYield: '4 Portionen',
  totalTime: 'PT50M',
  recipeCategory: 'Hauptgericht',
  recipeCuisine: 'Mediterran',
  keywords: 'vegetarisch, schnell',
  recipeIngredient: ['2 Zwiebeln', '500 g Kartoffeln'],
  recipeInstructions: [
    { '@type': 'HowToStep', text: 'Gemüse schneiden.' },
    { '@type': 'HowToStep', text: 'Im Ofen backen.' },
  ],
  image: ['https://example.com/bild.jpg'],
}

function html(): string {
  return `<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>`
}

function context(overrides: Partial<UrlImportContext> = {}): UrlImportContext {
  const finalUrl = 'https://example.com/rezept'
  const candidate = extractRecipeCandidates(html(), finalUrl).candidates[0]!
  return {
    originalUrl: 'https://example.com/rezept?utm=1',
    finalUrl,
    fetchedAt: 1234,
    candidate,
    ...overrides,
  }
}

async function seedUrlRecipe(): Promise<Recipe> {
  const ctx = context()
  const draft = draftFromUrlCandidate(ctx)
  const recipe = buildUrlRecipe({ draft, context: ctx, imageWarnings: [] })
  await saveRecipeWithImages(recipe, [
    {
      id: 'img-url-1',
      bytes: new Uint8Array([1, 2, 3]).buffer,
      mimeType: 'image/png',
    },
  ])
  return recipe
}

beforeEach(async () => {
  await deleteAllData()
})

afterAll(async () => {
  await deleteAllData()
  db.close()
})

describe('URL recipe integration', () => {
  it('maps extracted data into the existing recipe model and stores import metadata', async () => {
    const recipe = await seedUrlRecipe()
    const stored = await db.recipes.get(recipe.id)
    expect(stored?.importSource).toBe('url')
    expect(stored?.importId).toMatch(/^url-[0-9a-f]{16}-/)
    expect(stored?.importUrl).toBe('https://example.com/rezept')
    expect(stored?.sourceUrl).toBe('https://example.com/rezept')
    expect(stored?.title).toBe('Ofengemüse')
    expect(stored?.description).toBe('Einfach und lecker.')
    expect(stored?.servingsText).toBe('4 Portionen')
    expect(stored?.servingsNumber).toBe(4)
    expect(stored?.totalTime).toBe('50 Min.')
    expect(stored?.dishType).toEqual(['Hauptgericht'])
    expect(stored?.cuisine).toEqual(['Mediterran'])
    expect(stored?.tags).toEqual(['vegetarisch', 'schnell'])
    expect(stored?.categories).toEqual([])
    expect(stored?.ingredients).toHaveLength(2)
    expect(stored?.ingredients[0]).toMatchObject({ quantity: 2, name: 'Zwiebeln' })
    expect(stored?.instructions.map((step) => step.text)).toEqual([
      'Gemüse schneiden.',
      'Im Ofen backen.',
    ])
    expect(stored?.importMeta).toMatchObject({
      source: 'url',
      originalUrl: 'https://example.com/rezept?utm=1',
      finalUrl: 'https://example.com/rezept',
      candidateKey: 'id:https://example.com/rezept#recipe',
      fetchedAt: 1234,
      imageSourceUrls: ['https://example.com/bild.jpg'],
    })
    expect(stored?.raw).toMatchObject({ source: 'jsonld' })
    expect(await db.images.where('recipeId').equals(recipe.id).count()).toBe(1)
  })

  it('detects the same source and candidate, including after a manual edit', async () => {
    const recipe = await seedUrlRecipe()
    const before = await findUrlImportDuplicates('https://example.com/rezept', 'id:https://example.com/rezept#recipe')
    expect(before.exact?.id).toBe(recipe.id)
    expect(before.sameSource).toEqual([])

    await db.recipes.put({ ...(await db.recipes.get(recipe.id))!, title: 'Manuell bearbeitet' })
    const after = await findUrlImportDuplicates('https://example.com/rezept', 'id:https://example.com/rezept#recipe')
    expect(after.exact?.title).toBe('Manuell bearbeitet')
    expect((await db.recipes.get(recipe.id))?.title).toBe('Manuell bearbeitet')
  })

  it('reports the same page but a different recipe as a hint, not an exact duplicate', async () => {
    await seedUrlRecipe()
    const info = await findUrlImportDuplicates('https://example.com/rezept', 'title:anderes-rezept')
    expect(info.exact).toBeNull()
    expect(info.sameSource).toHaveLength(1)
  })

  it('does not deduplicate by title and never merges different URLs', async () => {
    await seedUrlRecipe()
    const info = await findUrlImportDuplicates('https://example.com/anderes-rezept', 'id:https://example.com/rezept#recipe')
    expect(info.exact).toBeNull()
    expect(info.sameSource).toEqual([])
  })

  it('recognises a manual recipe with the same source URL as a source hint', async () => {
    await db.recipes.put({
      id: 'manual-1',
      importId: 'manual-1',
      importSource: 'manual',
      title: 'Manuell',
      description: '',
      ingredientGroups: [],
      ingredients: [],
      instructions: [],
      servingsText: '',
      servingsNumber: null,
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
      sourceUrl: 'https://example.com/rezept',
      favorite: false,
      wantToCook: false,
      melaDate: null,
      raw: { source: 'manual' },
      createdAt: 1,
      updatedAt: 1,
    })
    const info = await findUrlImportDuplicates('https://example.com/rezept', 'id:https://example.com/rezept#recipe')
    expect(info.exact).toBeNull()
    expect(info.sameSource.map((recipe) => recipe.id)).toEqual(['manual-1'])
  })

  it('creates distinct import ids for repeated imports of the same candidate', () => {
    const first = importIdForCandidate('https://example.com/rezept', 'id:x')
    const second = importIdForCandidate('https://example.com/rezept', 'id:x')
    expect(first).toMatch(/^url-[0-9a-f]{16}-/)
    expect(second).toMatch(/^url-[0-9a-f]{16}-/)
    expect(first).not.toBe(second)
    expect(candidateImportKey('https://example.com/rezept', 'id:x')).toBe(
      'https://example.com/rezept#id:x',
    )
  })

  it('keeps the recipe import possible when an image cannot be downloaded', async () => {
    const fetcher: RecipeUrlFetcher = {
      fetchPage: vi.fn(),
      fetchImage: vi.fn(async (url: string) => {
        if (url.includes('gut')) {
          return {
            bytes: new Uint8Array([1, 2, 3]).buffer,
            mimeType: 'image/png',
            finalUrl: url,
          }
        }
        throw new Error('Netzwerkfehler')
      }),
    }
    const result = await downloadCandidateImages(
      ['https://cdn.example.com/gut.png', 'https://cdn.example.com/schlecht.jpg'],
      fetcher,
    )
    expect(result.images).toHaveLength(1)
    expect(result.warnings).toHaveLength(1)
    expect(result.warnings[0]).toContain('konnte nicht sicher geladen werden')
  })
})
