import { describe, expect, it } from 'vitest'
import type { Ingredient, Recipe } from '../types'
import {
  buildRecipeFromDraft,
  draftFromRecipe,
  emptyDraft,
  matchesRecipeFilters,
  parseQuantityInput,
} from './editor'

function ingredient(overrides: Partial<Ingredient> = {}): Ingredient {
  return {
    id: 'ing-1',
    groupId: null,
    position: 0,
    raw: '2 Zwiebeln',
    name: 'Zwiebeln',
    quantity: 2,
    quantityText: '2',
    unit: null,
    parseStatus: 'parsed',
    links: [],
    ...overrides,
  }
}

function makeRecipe(overrides: Partial<Recipe> = {}): Recipe {
  return {
    id: 'r1',
    importId: 'mela-r1',
    importSource: 'mela',
    title: 'Importiertes Rezept',
    description: 'Beschreibung',
    ingredientGroups: [],
    ingredients: [ingredient()],
    instructions: [{ id: 's1', position: 0, raw: 'Schritt', text: 'Schritt' }],
    servingsText: '2',
    servingsNumber: 2,
    prepTime: '10 min',
    cookTime: '20 min',
    totalTime: '30 min',
    categories: ['Mela-Kategorie'],
    cuisine: [],
    dishType: [],
    effort: '',
    tags: [],
    notes: '',
    nutrition: 'Kalorien: 300',
    sourceUrl: '',
    favorite: false,
    wantToCook: false,
    melaDate: 700000000,
    raw: { id: 'mela-r1', title: 'Original' },
    createdAt: 5,
    updatedAt: 5,
    ...overrides,
  }
}

describe('recipe editor mapping', () => {
  it('preserves Mela id, raw data and imported categories while editing', () => {
    const existing = makeRecipe()
    const draft = draftFromRecipe(existing)
    draft.title = 'Bearbeitet'
    draft.cuisine = ['Italienisch']
    draft.tags = ['schnell']
    draft.ingredients[0]!.quantity = '1/2'
    draft.ingredients[0]!.unit = 'TL'
    draft.ingredients[0]!.name = 'Zucker'

    const built = buildRecipeFromDraft(draft, existing)
    expect(built.id).toBe('r1')
    expect(built.importId).toBe('mela-r1')
    expect(built.importSource).toBe('mela')
    expect(built.raw).toEqual({ id: 'mela-r1', title: 'Original' })
    expect(built.categories).toEqual(['Mela-Kategorie'])
    expect(built.nutrition).toBe('Kalorien: 300')
    expect(built.melaDate).toBe(700000000)
    expect(built.createdAt).toBe(5)
    expect(built.title).toBe('Bearbeitet')
    expect(built.cuisine).toEqual(['Italienisch'])
    expect(built.tags).toEqual(['schnell'])
    expect(built.ingredients[0]?.quantity).toBe(0.5)
    expect(built.ingredients[0]?.unit).toBe('TL')
    expect(built.ingredients[0]?.name).toBe('Zucker')
  })

  it('creates a manual recipe with a stable manual import id', () => {
    const draft = emptyDraft()
    draft.title = 'Manuell'
    draft.cuisine = ['Indisch']
    draft.dishType = ['Curry']
    draft.effort = 'einfach'
    draft.tags = ['Meal Prep']
    draft.ingredients = [
      {
        key: 'a',
        group: 'Curry',
        quantity: '1 1/2',
        unit: 'TL',
        name: 'Kurkuma',
        purchaseNote: '',
        preparationNote: '',
      },
      {
        key: 'b',
        group: 'Curry',
        quantity: '',
        unit: '',
        name: 'Salz',
        purchaseNote: '',
        preparationNote: '',
      },
      {
        key: 'c',
        group: 'Topping',
        quantity: '1',
        unit: 'Bund',
        name: 'Koriander',
        purchaseNote: '',
        preparationNote: '',
      },
    ]
    draft.steps = [{ key: 's', text: 'Alles kochen.', references: [] }]

    const built = buildRecipeFromDraft(draft)
    expect(built.importSource).toBe('manual')
    expect(built.importId).toMatch(/^manual-/)
    expect(built.title).toBe('Manuell')
    expect(built.ingredientGroups.map((group) => group.title)).toEqual(['Curry', 'Topping'])
    expect(built.ingredients).toHaveLength(3)
    expect(built.ingredients[0]?.quantity).toBe(1.5)
    expect(built.ingredients[0]?.groupId).toBe(built.ingredientGroups[0]?.id)
    expect(built.ingredients[2]?.groupId).toBe(built.ingredientGroups[1]?.id)
    expect(built.ingredients[1]?.parseStatus).toBe('plain')
    expect(built.raw).toEqual({ source: 'manual' })
  })

  it('keeps groups when loading an existing recipe into the editor', () => {
    const existing = makeRecipe({
      ingredientGroups: [
        { id: 'g1', title: 'Teig', position: 0, rawHeading: '# Teig' },
      ],
      ingredients: [ingredient({ groupId: 'g1', name: 'Mehl' })],
    })
    const draft = draftFromRecipe(existing)
    expect(draft.ingredients[0]?.group).toBe('Teig')
    const built = buildRecipeFromDraft(draft, existing)
    expect(built.ingredientGroups[0]?.title).toBe('Teig')
    expect(built.ingredients[0]?.groupId).toBe(built.ingredientGroups[0]?.id)
  })

  it('stores purchase and preparation notes separately and keeps the raw line intact', () => {
    const draft = emptyDraft()
    draft.title = 'Tomaten'
    draft.ingredients = [
      {
        key: 'a',
        group: '',
        quantity: '350',
        unit: 'ml',
        name: 'passierte Tomaten',
        purchaseNote: 'bevorzugt Mutti',
        preparationNote: 'passiert',
      },
    ]
    draft.steps = [{ key: 's', text: 'Kochen.', references: [] }]

    const built = buildRecipeFromDraft(draft)
    expect(built.ingredients[0]?.purchaseNote).toBe('bevorzugt Mutti')
    expect(built.ingredients[0]?.preparationNote).toBe('passiert')
    expect(built.ingredients[0]?.raw).toBe('350 ml passierte Tomaten')

    const roundtrip = draftFromRecipe(built)
    expect(roundtrip.ingredients[0]?.purchaseNote).toBe('bevorzugt Mutti')
    expect(roundtrip.ingredients[0]?.preparationNote).toBe('passiert')
  })

  it('does not rewrite an imported raw line when only notes change', () => {
    const existing = makeRecipe({
      ingredients: [
        ingredient({
          raw: '**2** Zwiebeln',
          name: 'Zwiebeln',
          quantity: 2,
          quantityText: '2',
        }),
      ],
    })
    const draft = draftFromRecipe(existing)
    draft.ingredients[0]!.purchaseNote = 'bevorzugt Bio'
    draft.ingredients[0]!.preparationNote = 'fein gewürfelt'

    const built = buildRecipeFromDraft(draft, existing)
    expect(built.ingredients[0]?.raw).toBe('**2** Zwiebeln')
    expect(built.ingredients[0]?.name).toBe('Zwiebeln')
    expect(built.ingredients[0]?.purchaseNote).toBe('bevorzugt Bio')
    expect(built.ingredients[0]?.preparationNote).toBe('fein gewürfelt')
  })

  it('parses quantities conservatively', () => {
    expect(parseQuantityInput('2')).toBe(2)
    expect(parseQuantityInput('1/2')).toBe(0.5)
    expect(parseQuantityInput('1 1/2')).toBe(1.5)
    expect(parseQuantityInput('0,5')).toBe(0.5)
    expect(parseQuantityInput('2-3')).toBe(2)
    expect(parseQuantityInput('½')).toBe(0.5)
    expect(parseQuantityInput('etwas')).toBeNull()
  })
})

describe('recipe filters', () => {
  const recipe = makeRecipe({
    title: 'Hähnchen-Curry',
    cuisine: ['Indisch'],
    dishType: ['Curry'],
    effort: 'einfach',
    tags: ['schnell', 'Gäste'],
    categories: ['Mela'],
    ingredients: [ingredient({ name: 'Hähnchenbrust' })],
  })

  it('combines dimensions with AND', () => {
    expect(
      matchesRecipeFilters(recipe, {
        search: 'hähnchen',
        cuisine: 'Indisch',
        dishType: 'Curry',
        effort: 'einfach',
        tag: 'schnell',
        category: 'Mela',
      }),
    ).toBe(true)
    expect(matchesRecipeFilters(recipe, { cuisine: 'Indisch', tag: 'Gäste' })).toBe(true)
    expect(matchesRecipeFilters(recipe, { cuisine: 'Indisch', tag: 'günstig' })).toBe(false)
    expect(matchesRecipeFilters(recipe, { effort: 'aufwendig' })).toBe(false)
  })

  it('searches title, ingredient and tag', () => {
    expect(matchesRecipeFilters(recipe, { search: 'curry' })).toBe(true)
    expect(matchesRecipeFilters(recipe, { search: 'hähnchenbrust' })).toBe(true)
    expect(matchesRecipeFilters(recipe, { search: 'gäste' })).toBe(true)
    expect(matchesRecipeFilters(recipe, { search: 'lachs' })).toBe(false)
  })
})

describe('recipe editor instruction references', () => {
  function recipeWithReference(): Recipe {
    return makeRecipe({
      instructions: [
        {
          id: 's1',
          position: 0,
          raw: 'Die 2 Zwiebeln würfeln.',
          text: 'Die 2 Zwiebeln würfeln.',
          references: [
            {
              id: 'ref-1',
              ingredientId: 'ing-1',
              anchor: '2',
              anchorOffset: 4,
              quantity: { kind: 'full' },
            },
          ],
        },
      ],
    })
  }

  it('preserves references when loading and saving the editor draft', () => {
    const existing = recipeWithReference()
    const draft = draftFromRecipe(existing)
    expect(draft.steps[0]?.references).toHaveLength(1)
    const built = buildRecipeFromDraft(draft, existing)
    expect(built.instructions[0]?.references?.[0]).toMatchObject({
      id: 'ref-1',
      ingredientId: 'ing-1',
      anchor: '2',
      anchorOffset: 4,
      quantity: { kind: 'full' },
    })
  })

  it('re-anchors references after normal text edits instead of losing them', () => {
    const existing = recipeWithReference()
    const draft = draftFromRecipe(existing)
    draft.steps[0]!.text = 'Zuerst die 2 Zwiebeln würfeln.'
    const built = buildRecipeFromDraft(draft, existing)
    expect(built.instructions[0]?.text).toBe('Zuerst die 2 Zwiebeln würfeln.')
    expect(built.instructions[0]?.references?.[0]?.anchorOffset).toBe(11)
  })

  it('keeps a reference visible when its ingredient is removed instead of inventing a value', () => {
    const existing = recipeWithReference()
    const draft = draftFromRecipe(existing)
    draft.ingredients = []
    const built = buildRecipeFromDraft(draft, existing)
    expect(built.ingredients).toEqual([])
    expect(built.instructions[0]?.references?.[0]?.ingredientId).toBe('ing-1')
  })

  it('drops structurally broken references without touching the text', () => {
    const existing = recipeWithReference()
    const draft = draftFromRecipe(existing)
    draft.steps[0]!.references = [
      { id: '', ingredientId: '', anchor: '', anchorOffset: 0, quantity: { kind: 'full' } },
    ]
    const built = buildRecipeFromDraft(draft, existing)
    expect(built.instructions[0]?.references).toEqual([])
    expect(built.instructions[0]?.text).toBe('Die 2 Zwiebeln würfeln.')
  })
})
