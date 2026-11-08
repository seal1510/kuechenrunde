import { describe, expect, it } from 'vitest'
import type { FreeDish, Ingredient, MealPlanEntry, Recipe } from '../types'
import {
  dishIdentityFor,
  dishKindFor,
  dishReferenceServings,
  dishShoppingNeeds,
  dishSourceName,
  scaleDishIngredients,
  sessionMatchesEntry,
  type DishSource,
} from './dishSource'
import { scaledIngredientLine } from './scaling'

function ingredient(overrides: Partial<Ingredient> & { raw: string }): Ingredient {
  return {
    id: overrides.id ?? 'ing-1',
    groupId: null,
    position: 0,
    name: overrides.name ?? overrides.raw,
    quantity: overrides.quantity ?? null,
    quantityText: overrides.quantityText ?? null,
    unit: overrides.unit ?? null,
    purchaseNote: '',
    preparationNote: '',
    parseStatus: 'parsed',
    links: [],
    ...overrides,
    raw: overrides.raw,
  }
}

function freeDish(overrides: Partial<FreeDish> = {}): FreeDish {
  return {
    id: 'free-1',
    name: 'Nudeln mit Pesto',
    referenceServings: 3,
    ingredients: [
      ingredient({
        id: 'pasta',
        raw: '300 g Nudeln',
        name: 'Nudeln',
        quantity: 300,
        quantityText: '300',
        unit: 'g',
      }),
    ],
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }
}

function recipe(overrides: Partial<Recipe> = {}): Recipe {
  return {
    id: 'r1',
    importId: 'mela-r1',
    importSource: 'mela',
    title: 'Bibliotheksrezept',
    description: '',
    ingredientGroups: [],
    ingredients: [
      ingredient({
        raw: '400 g Spaghetti',
        name: 'Spaghetti',
        quantity: 400,
        quantityText: '400',
        unit: 'g',
      }),
    ],
    instructions: [],
    servingsText: '4 Portionen',
    servingsNumber: 4,
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
    ...overrides,
  }
}

describe('dish identity', () => {
  it('distinguishes library recipes from free dishes without name-based grouping', () => {
    expect(dishIdentityFor({ recipeId: 'r1', freeDishId: null })).toEqual({
      kind: 'recipe',
      recipeId: 'r1',
    })
    expect(dishIdentityFor({ recipeId: null, freeDishId: 'free-1' })).toEqual({
      kind: 'free',
      freeDishId: 'free-1',
    })
    expect(dishKindFor({ recipeId: 'r1' })).toBe('recipe')
    expect(dishKindFor({ freeDishId: 'free-1' })).toBe('free')
    expect(dishIdentityFor({ recipeId: null, freeDishId: null })).toBeNull()
  })

  it('matches only cooking events and meal entries of the same dish', () => {
    const freeSession = { recipeId: null, freeDishId: 'free-1' }
    const freeEntry = { recipeId: null, freeDishId: 'free-1' }
    const otherFreeEntry = { recipeId: null, freeDishId: 'free-2' }
    const recipeSession = { recipeId: 'r1', freeDishId: null }
    const recipeEntry = { recipeId: 'r1', freeDishId: null }

    expect(sessionMatchesEntry(freeSession, freeEntry)).toBe(true)
    expect(sessionMatchesEntry(freeSession, otherFreeEntry)).toBe(false)
    expect(sessionMatchesEntry(recipeSession, recipeEntry)).toBe(true)
    expect(sessionMatchesEntry(freeSession, recipeEntry)).toBe(false)
  })
})

describe('shared dish scaling', () => {
  it('scales a free dish from its stored reference portions', () => {
    const source: DishSource = { kind: 'free', freeDish: freeDish() }
    const result = scaleDishIngredients(source, 5)

    expect(dishReferenceServings(source)).toBe(3)
    expect(result.factor).toBeCloseTo(5 / 3)
    expect(result.items[0]?.quantityText).toBe('500')
    expect(result.items[0]?.ingredient.quantityText).toBe('300')
    expect(scaledIngredientLine(result.items[0]!)).toBe('500 g Nudeln')
    expect(dishSourceName(source)).toBe('Nudeln mit Pesto')
  })

  it('uses the same rules for a library recipe', () => {
    const source: DishSource = { kind: 'recipe', recipe: recipe() }
    const result = scaleDishIngredients(source, 6)

    expect(dishReferenceServings(source)).toBe(4)
    expect(result.items[0]?.quantityText).toBe('600')
    expect(scaledIngredientLine(result.items[0]!)).toBe('600 g Spaghetti')
  })

  it('scales ranges, fractions and qualifiers but keeps unstructured text', () => {
    const source: DishSource = {
      kind: 'free',
      freeDish: freeDish({
        referenceServings: 2,
        ingredients: [
          ingredient({
            id: 'oil',
            raw: 'ca. 2-3 EL Olivenöl',
            name: 'Olivenöl',
            quantity: 2,
            quantityText: 'ca. 2-3',
            unit: 'EL',
          }),
          ingredient({
            id: 'spice',
            raw: '1/2 TL Muskat',
            name: 'Muskat',
            quantity: 0.5,
            quantityText: '1/2',
            unit: 'TL',
          }),
          ingredient({
            id: 'salt',
            raw: 'Salz nach Geschmack',
            name: 'Salz nach Geschmack',
            parseStatus: 'plain',
          }),
        ],
      }),
    }

    const result = scaleDishIngredients(source, 3)
    expect(result.items[0]?.quantityText).toBe('ca. 3–4,5')
    expect(result.items[0]?.scaled).toBe(true)
    expect(result.items[1]?.quantityText).toBe('0,75')
    expect(result.items[1]?.scaled).toBe(true)
    expect(result.items[2]?.quantityText).toBeNull()
    expect(result.items[2]?.scaled).toBe(false)
    expect(result.items[2]?.note).toBe('missing-quantity')
  })

  it('keeps amounts unchanged when the reference portions are unknown', () => {
    const source: DishSource = {
      kind: 'free',
      freeDish: freeDish({ referenceServings: 0 }),
    }
    const result = scaleDishIngredients(source, 4)
    expect(result.factor).toBeNull()
    expect(result.items[0]?.quantityText).toBe('300')
    expect(dishReferenceServings(source)).toBeNull()
  })
})

describe('shopping demand preparation', () => {
  it('returns amount, unit, ingredient and purchase note exactly once per cooking event', () => {
    const source: DishSource = {
      kind: 'free',
      freeDish: freeDish({
        referenceServings: 3,
        ingredients: [
          ingredient({
            id: 'pesto',
            raw: '1 Glas Pesto',
            name: 'Pesto',
            quantity: 1,
            quantityText: '1',
            unit: 'Glas',
            purchaseNote: 'bevorzugt Barilla',
          }),
          ingredient({
            id: 'parmesan',
            raw: '50 g Parmesan',
            name: 'Parmesan',
            quantity: 50,
            quantityText: '50',
            unit: 'g',
            preparationNote: 'frisch gerieben',
          }),
        ],
      }),
    }

    const demand = dishShoppingNeeds(source, { servings: 6 })
    expect(demand.needs).toEqual([
      {
        name: 'Pesto',
        unit: 'Glas',
        quantityText: '2',
        purchaseNote: 'bevorzugt Barilla',
      },
      {
        name: 'Parmesan',
        unit: 'g',
        quantityText: '100',
        purchaseNote: '',
      },
    ])
    expect(JSON.stringify(demand.needs)).not.toContain('frisch gerieben')
  })

  it('documents that the meal days themselves are not part of the demand input', () => {
    const source: DishSource = { kind: 'free', freeDish: freeDish() }
    const entries: MealPlanEntry[] = [
      {
        id: 'meal-1',
        date: '2026-05-28',
        slot: 'dinner',
        recipeId: null,
        freeDishId: 'free-1',
        servings: 2,
        auto: false,
        pinned: false,
        leftover: false,
        cooked: false,
        reasons: [],
        createdAt: 1,
        updatedAt: 1,
      },
      {
        id: 'meal-2',
        date: '2026-05-30',
        slot: 'dinner',
        recipeId: null,
        freeDishId: 'free-1',
        servings: 1,
        auto: false,
        pinned: false,
        leftover: false,
        cooked: false,
        reasons: [],
        createdAt: 1,
        updatedAt: 1,
      },
    ]

    // Demand is derived once from the cooking event, never once per eat day.
    expect(entries).toHaveLength(2)
    expect(dishShoppingNeeds(source, { servings: 3 }).needs[0]?.quantityText).toBe('300')
  })
})
