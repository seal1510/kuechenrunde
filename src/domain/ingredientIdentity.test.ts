import { describe, expect, it } from 'vitest'
import type {
  CookSession,
  FreeDish,
  Ingredient,
  Recipe,
  ShoppingDemandAllocation,
  ShoppingItemRule,
  ShoppingPurchase,
} from '../types'
import {
  buildShoppingList,
  formatShoppingAmount,
  resolveCanonicalKey,
  shoppingItemKey,
  splitIngredientName,
  type ShoppingListInput,
  type ShoppingListItem,
} from './shopping'
import { resolveShoppingDistribution } from './shoppingLists'
import { catalogShoppingKey } from './ingredientCatalog'
import { parseIngredients } from '../import/ingredients'

function ingredient(overrides: Partial<Ingredient> = {}): Ingredient {
  return {
    id: 'i1',
    groupId: null,
    position: 0,
    raw: '2 Zwiebeln',
    name: 'Zwiebeln',
    quantity: 2,
    quantityText: '2',
    unit: 'Stück',
    purchaseNote: '',
    preparationNote: '',
    parseStatus: 'parsed',
    links: [],
    ...overrides,
  }
}

function recipe(overrides: Partial<Recipe> = {}): Recipe {
  return {
    id: 'r1',
    importId: 'mela-r1',
    importSource: 'mela',
    title: 'Rezept',
    description: '',
    ingredientGroups: [],
    ingredients: [ingredient()],
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
    ...overrides,
  }
}

function session(overrides: Partial<CookSession> = {}): CookSession {
  return {
    id: 's1',
    recipeId: 'r1',
    date: '2026-05-07',
    servings: 2,
    status: 'planned',
    auto: false,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }
}

function build(overrides: Partial<ShoppingListInput> = {}) {
  return buildShoppingList({
    anchor: '2026-05-07',
    weekStartDay: 3,
    recipes: [],
    freeDishes: [],
    cookSessions: [],
    manualItems: [],
    checks: [],
    purchases: [],
    rules: [],
    today: '2026-05-07',
    ...overrides,
  })
}

function byName(result: ReturnType<typeof build>, name: string): ShoppingListItem {
  const found = result.items.find((entry) => entry.name === name)
  if (!found) {
    throw new Error(`Missing ${name}. Present: ${result.items.map((entry) => entry.name).join(', ')}`)
  }
  return found
}

function amounts(item: ShoppingListItem): string[] {
  return item.positions.map(formatShoppingAmount)
}

describe('ingredient identity across multiple recipes', () => {
  const recipeA = recipe({
    id: 'r1',
    importId: 'mela-r1',
    ingredients: [
      ingredient({ name: 'Tomaten', raw: '200 g Tomaten', quantity: 200, quantityText: '200', unit: 'g' }),
      ingredient({ name: 'Tomaten', raw: '1 Dose Tomaten', quantity: 1, quantityText: '1', unit: 'Dose', position: 1 }),
      ingredient({ name: 'Koriander', raw: '½ Bund Koriander', quantity: 0.5, quantityText: '½', unit: 'Bund', position: 2 }),
      ingredient({ name: 'Koriander', raw: '1 TL Koriander', quantity: 1, quantityText: '1', unit: 'TL', position: 3 }),
      ingredient({ name: 'Hähnchenbrust', raw: '500 g Hähnchenbrust', quantity: 500, quantityText: '500', unit: 'g', position: 4 }),
      ingredient({ name: 'Kurkuma', raw: '1 TL Kurkuma', quantity: 1, quantityText: '1', unit: 'TL', position: 5 }),
      ingredient({ name: 'Kreuzkümmel', raw: '1 TL Kreuzkümmel', quantity: 1, quantityText: '1', unit: 'TL', position: 6 }),
      ingredient({ name: 'Pfeffer', raw: 'Pfeffer', quantity: null, quantityText: null, unit: null, position: 7 }),
    ],
  })
  const recipeB = recipe({
    id: 'r2',
    importId: 'mela-r2',
    title: 'Zweites Rezept',
    ingredients: [
      ingredient({ name: 'Tomaten', raw: '300 g Tomaten', quantity: 300, quantityText: '300', unit: 'g' }),
      ingredient({ name: 'Korianderpulver', raw: '2 TL Korianderpulver', quantity: 2, quantityText: '2', unit: 'TL', position: 1 }),
      ingredient({ name: 'Kurkuma', raw: '1 Stück Kurkuma', quantity: 1, quantityText: '1', unit: 'Stück', position: 2 }),
      ingredient({ name: 'Hähnchenbrust', raw: '250 g Hähnchenbrustfilet', quantity: 250, quantityText: '250', unit: 'g', position: 3 }),
      ingredient({ name: 'Cumin gemahlen', raw: '1 TL Cumin gemahlen', quantity: 1, quantityText: '1', unit: 'TL', position: 4 }),
      ingredient({ name: 'Kreuzkümmelsamen', raw: '1 TL Kreuzkümmelsamen', quantity: 1, quantityText: '1', unit: 'TL', position: 5 }),
      ingredient({ name: 'Salz', raw: '1 Prise Salz', quantity: 1, quantityText: '1', unit: 'Prise', position: 6 }),
      ingredient({ name: 'Kichererbsen', raw: '1 Dose Kichererbsen', quantity: 1, quantityText: '1', unit: 'Dose', position: 7 }),
      ingredient({ name: 'Paprikapulver edelsüß', raw: '1 TL Paprikapulver edelsüß', quantity: 1, quantityText: '1', unit: 'TL', position: 8 }),
      ingredient({ name: 'edelsüßes Paprikapulver', raw: '1 TL edelsüßes Paprikapulver', quantity: 1, quantityText: '1', unit: 'TL', position: 9 }),
    ],
  })

  function buildBoth(extra: Partial<ShoppingListInput> = {}) {
    return build({
      recipes: [recipeA, recipeB],
      cookSessions: [session(), session({ id: 's2', recipeId: 'r2', date: '2026-05-08' })],
      ...extra,
    })
  }

  it('merges identical products from several recipes and aggregates their amounts', () => {
    const result = buildBoth()

    const tomatoes = byName(result, 'Tomaten')
    expect(tomatoes.categoryId).toBe('produce')
    expect(amounts(tomatoes)).toEqual(['500 g'])

    const cannedTomatoes = byName(result, 'Tomaten Dose')
    expect(cannedTomatoes.categoryId).toBe('canned')
    expect(amounts(cannedTomatoes)).toEqual(['1 Dose'])

    const coriander = byName(result, 'Koriander')
    expect(coriander.categoryId).toBe('produce')
    expect(amounts(coriander)).toEqual(['0,5 Bund'])

    const groundCoriander = byName(result, 'Koriander gemahlen')
    expect(groundCoriander.categoryId).toBe('spices')
    expect(amounts(groundCoriander)).toEqual(['3 TL'])

    const chicken = byName(result, 'Hähnchenbrust')
    expect(chicken.categoryId).toBe('meat')
    expect(amounts(chicken)).toEqual(['750 g'])

    const turmeric = byName(result, 'Kurkuma')
    expect(turmeric.categoryId).toBe('spices')
    expect(amounts(turmeric)).toEqual(['1 TL'])

    const freshTurmeric = byName(result, 'Kurkuma frisch')
    expect(freshTurmeric.categoryId).toBe('produce')
    expect(amounts(freshTurmeric)).toEqual(['1 Stück'])

    const cumin = byName(result, 'Kreuzkümmel')
    expect(cumin.categoryId).toBe('spices')
    expect(amounts(cumin)).toEqual(['2 TL'])

    const cuminSeeds = byName(result, 'Kreuzkümmelsamen')
    expect(cuminSeeds.categoryId).toBe('spices')
    expect(amounts(cuminSeeds)).toEqual(['1 TL'])

    const paprika = byName(result, 'Paprikapulver edelsüß')
    expect(paprika.categoryId).toBe('spices')
    expect(amounts(paprika)).toEqual(['2 TL'])

    const salt = byName(result, 'Salz')
    expect(salt.categoryId).toBe('spices')
    expect(amounts(salt)).toEqual(['1 Prise'])

    const chickpeas = byName(result, 'Kichererbsen')
    expect(chickpeas.categoryId).toBe('canned')
    expect(amounts(chickpeas)).toEqual(['1 Dose'])
  })

  it('keeps quantity-less ingredients and records that the amount is missing', () => {
    const result = buildBoth()
    const pepper = byName(result, 'Pfeffer')
    expect(pepper.categoryId).toBe('spices')
    expect(pepper.missingQuantity).toBe(true)
    expect(pepper.positions).toEqual([])
    expect(pepper.status).toBe('open')
  })

  it('does not merge fresh, dried, ground and whole forms of the same plant', () => {
    const result = buildBoth()
    const corianderItems = result.items.filter((item) =>
      item.name.startsWith('Koriander'),
    )
    expect(corianderItems.map((item) => item.name).sort()).toEqual([
      'Koriander',
      'Koriander gemahlen',
    ])
    const turmericItems = result.items.filter((item) => item.name.startsWith('Kurkuma'))
    expect(turmericItems.map((item) => item.name).sort()).toEqual([
      'Kurkuma',
      'Kurkuma frisch',
    ])
    const cuminItems = result.items.filter((item) => item.name.startsWith('Kreuzkümmel'))
    expect(cuminItems.map((item) => item.name).sort()).toEqual([
      'Kreuzkümmel',
      'Kreuzkümmelsamen',
    ])
  })

  it('never changes the stored recipe rows', () => {
    const before = JSON.stringify([recipeA, recipeB])
    buildBoth()
    expect(JSON.stringify([recipeA, recipeB])).toBe(before)
  })
})

describe('stored and legacy ingredient data', () => {
  it('re-reads old parser output through the same identity path', () => {
    const result = build({
      recipes: [
        recipe({
          ingredients: [
            ingredient({
              name: 'bis 950 ml Rinderbrühe',
              raw: '750 bis 950 ml Rinderbrühe',
              quantity: 750,
              quantityText: '750',
              unit: null,
            }),
            ingredient({
              name: 'Korianderpulver',
              raw: '1 TL Korianderpulver',
              quantity: 1,
              quantityText: '1',
              unit: 'TL',
              position: 1,
            }),
            ingredient({
              name: 'Kurkuma',
              raw: '1 TL Kurkuma',
              quantity: 1,
              quantityText: '1',
              unit: 'TL',
              position: 2,
            }),
          ],
        }),
      ],
      cookSessions: [session()],
    })

    expect(amounts(byName(result, 'Rinderbrühe'))).toEqual(['750–950 ml'])
    expect(byName(result, 'Koriander gemahlen').key).toBe(
      shoppingItemKey('Koriander gemahlen'),
    )
    expect(amounts(byName(result, 'Kurkuma'))).toEqual(['1 TL'])
  })

  it('keeps historical purchases attached through old synonym keys', () => {
    const purchased: ShoppingPurchase = {
      id: 'p-old',
      shoppingDate: '2026-05-07',
      itemKey: 'korianderpulv',
      amounts: [{ dimension: 'unit:tl', lower: 1, upper: 1 }],
      confirmedTotal: [{ dimension: 'unit:tl', lower: 1, upper: 1 }],
      snapshot: [{ dimension: 'unit:tl', lower: 1, upper: 1 }],
      qualitative: false,
      createdAt: 1,
      updatedAt: 1,
    }
    const result = build({
      recipes: [
        recipe({
          ingredients: [
            ingredient({
              name: 'Koriander',
              raw: '1 TL Koriander',
              quantity: 1,
              quantityText: '1',
              unit: 'TL',
            }),
          ],
        }),
      ],
      cookSessions: [session()],
      purchases: [purchased],
    })
    const item = byName(result, 'Koriander gemahlen')
    expect(item.key).toBe(shoppingItemKey('Koriander gemahlen'))
    expect(item.status).toBe('done')
    expect(item.purchased.map(formatShoppingAmount)).toEqual(['1 TL'])
  })

  it('applies an old product rule to the canonical identity', () => {
    const rule: ShoppingItemRule = {
      key: 'korianderpulv',
      canonicalKey: 'korianderpulv',
      displayName: 'Korianderpulver',
      categoryId: 'spices',
      purchaseNote: '',
      updatedAt: 1,
    }
    const result = build({
      recipes: [
        recipe({
          ingredients: [
            ingredient({
              name: 'Korianderpulver',
              raw: '1 TL Korianderpulver',
              quantity: 1,
              quantityText: '1',
              unit: 'TL',
            }),
          ],
        }),
      ],
      cookSessions: [session()],
      rules: [rule],
    })
    const item = byName(result, 'Korianderpulver')
    expect(item.categoryId).toBe('spices')
    expect(item.hasItemRule).toBe(true)
  })

  it('resolves old keys to the current canonical key', () => {
    expect(resolveCanonicalKey('korianderpulv', [])).toBe(
      shoppingItemKey('Koriander gemahlen'),
    )
    expect(resolveCanonicalKey('kreuzkummelpulv', [])).toBe(
      shoppingItemKey('Kreuzkümmel'),
    )
    expect(resolveCanonicalKey('koriand getrocknet', [])).toBe(
      shoppingItemKey('Koriander gemahlen'),
    )
    expect(resolveCanonicalKey('hackfleisch gemischt', [])).toBe('hackfleisch gemischt')
  })

  it('recognises the same identity regardless of the input spelling', () => {
    const spellings = [
      'Korianderpulver',
      'Koriander gemahlen',
      'gemahlener Koriander',
      'getrockneter Koriander',
      'gemahlene Koriandersamen',
    ]
    const keys = new Set(
      spellings.map((name) => {
        const split = splitIngredientName(name, { unit: 'TL' })
        return shoppingItemKey(split.identityName)
      }),
    )
    expect(keys.size).toBe(1)
    expect([...keys][0]).toBe(shoppingItemKey('Koriander gemahlen'))
  })
})

describe('stored recipes with parenthetical synonyms', () => {
  it('merges "Kreuzkümmel" and "Kreuzkümmelpulver (Cumin)" without quantities', () => {
    // Stored form produced by the importer for the real recipe lines.
    const plainRecipe = recipe({
      id: 'stored-plain',
      importId: 'mela-stored-plain',
      title: 'Bulgursalat',
      ingredients: parseIngredients('Kreuzkümmel').ingredients,
    })
    const annotatedRecipe = recipe({
      id: 'stored-annotated',
      importId: 'mela-stored-annotated',
      title: 'Chicken-Mango-Curry',
      ingredients: parseIngredients(
        ['Kreuzkümmelpulver (Cumin)', 'Korianderpulver', 'Kurkumapulver'].join('\n'),
      ).ingredients,
    })
    // Both rows are truly quantity-less stored ingredients.
    expect(plainRecipe.ingredients[0]?.quantityText).toBeNull()
    expect(annotatedRecipe.ingredients[0]?.quantityText).toBeNull()

    const result = build({
      recipes: [plainRecipe, annotatedRecipe],
      cookSessions: [
        session({ id: 'stored-s1', recipeId: 'stored-plain', date: '2026-05-07' }),
        session({ id: 'stored-s2', recipeId: 'stored-annotated', date: '2026-05-08' }),
      ],
    })

    expect(result.items.map((entry) => entry.name).sort()).toEqual([
      'Koriander gemahlen',
      'Kreuzkümmel',
      'Kurkuma',
    ])
    const cumin = byName(result, 'Kreuzkümmel')
    expect(cumin.key).toBe(shoppingItemKey('Kreuzkümmel'))
    expect(cumin.categoryId).toBe('spices')
    expect(cumin.missingQuantity).toBe(true)
    expect(cumin.sources).toHaveLength(2)
    expect(result.items.some((entry) => entry.name.includes('Cumin'))).toBe(false)
  })

  it('keeps a historical check stored under the annotated old key', () => {
    const storedRecipe = recipe({
      id: 'stored-annotated-checked',
      importId: 'mela-stored-annotated-checked',
      title: 'Chicken-Mango-Curry',
      ingredients: parseIngredients('Kreuzkümmelpulver (Cumin)').ingredients,
    })
    const oldCheck: ShoppingPurchase = {
      id: 'old-annotated-check',
      shoppingDate: '2026-05-07',
      itemKey: 'kreuzkummelpulv cumi',
      amounts: [],
      confirmedTotal: [],
      snapshot: [],
      qualitative: true,
      createdAt: 1,
      updatedAt: 1,
    }
    const result = build({
      recipes: [storedRecipe],
      cookSessions: [session({ id: 'stored-s3', recipeId: 'stored-annotated-checked' })],
      purchases: [oldCheck],
    })
    expect(result.items).toHaveLength(1)
    const cumin = byName(result, 'Kreuzkümmel')
    expect(cumin.status).toBe('done')
    expect(cumin.purchased).toEqual([])
  })

  it('applies the same rule to other catalogue synonyms and forms', () => {
    expect(splitIngredientName('Korianderpulver (Cilantro)').name).toBe('Koriander gemahlen')
    expect(splitIngredientName('Kurkumapulver (Curcuma)').name).toBe('Kurkuma')
    expect(splitIngredientName('Kreuzkümmel (Cumin)').name).toBe('Kreuzkümmel')
    expect(splitIngredientName('Kreuzkümmel (Kreuzkümmelsamen)').name).toBe('Kreuzkümmelsamen')
    expect(splitIngredientName('Koriander (Koriandersamen)').name).toBe('Koriandersamen')
    expect(splitIngredientName('Mehl (550)').name).toBe('Mehl Type 550')
    expect(splitIngredientName('Mehl (405)').name).toBe('Mehl Type 405')
    // Unknown brands and qualities are still separate products.
    expect(splitIngredientName('Tomaten (Mutti)').identityName).not.toBe(
      splitIngredientName('Tomaten').identityName,
    )
    expect(splitIngredientName('Mozzarella (light)').identityName).not.toBe(
      splitIngredientName('Mozzarella').identityName,
    )
  })
})

describe('legacy list allocations survive the identity change', () => {
  it('applies an allocation stored under an old form key to the canonical item', () => {
    const itemKey = shoppingItemKey('Koriander gemahlen')
    const allocation: ShoppingDemandAllocation = {
      id: `2026-05-07|koriand getrocknet|*|liste-g`,
      periodStart: '2026-05-07',
      itemKey: 'koriand getrocknet',
      dimension: '*',
      listId: 'liste-g',
      mode: 'full',
      createdAt: 1,
      updatedAt: 1,
    }
    const distribution = resolveShoppingDistribution({
      periodStart: '2026-05-07',
      demand: [
        {
          key: itemKey,
          name: 'Koriander gemahlen',
          positions: [
            { dimension: 'unit:tl', unit: 'TL', lower: 1, upper: 1, qualifier: '' },
          ],
          unparsedAmounts: [],
          missingQuantity: false,
        },
      ],
      allocations: [allocation],
      listIds: ['liste-g'],
    })
    expect(distribution.orphanedAllocations).toHaveLength(0)
    expect(distribution.positions).toHaveLength(1)
    expect(distribution.positions[0]?.itemKey).toBe(itemKey)
    expect(distribution.positions[0]?.amounts).toEqual([
      { listId: 'liste-g', lower: 1, upper: 1, explicit: true },
    ])
    expect(distribution.conflicts).toEqual([])
    expect(catalogShoppingKey(allocation.itemKey)).toBe(itemKey)
  })

  it('also applies a key stored with a preparation variant of the same product', () => {
    const distribution = resolveShoppingDistribution({
      periodStart: '2026-05-07',
      demand: [
        {
          key: shoppingItemKey('Tomaten Dose'),
          name: 'Tomaten Dose',
          positions: [{ dimension: 'unit:dose', unit: 'Dose', lower: 1, upper: 1, qualifier: '' }],
          unparsedAmounts: [],
          missingQuantity: false,
        },
      ],
      allocations: [
        {
          id: 'a1',
          periodStart: '2026-05-07',
          itemKey: 'tomat dose',
          dimension: '*',
          listId: 'liste-k',
          mode: 'full',
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      listIds: ['liste-k'],
    })
    expect(distribution.positions[0]?.amounts).toEqual([
      { listId: 'liste-k', lower: 1, upper: 1, explicit: true },
    ])
  })
})

describe('manual articles use the same ingredient identity', () => {
  it('resolves a unit-dependent manual article like a recipe ingredient', () => {
    const result = build({
      manualItems: [
        {
          id: 'm1',
          shoppingDate: '2026-05-07',
          name: 'Koriander',
          quantityText: '1',
          unit: 'TL',
          purchaseNote: '',
          categoryId: null,
          createdAt: 1,
          updatedAt: 1,
        },
        {
          id: 'm2',
          shoppingDate: '2026-05-07',
          name: 'Koriander',
          quantityText: '1',
          unit: 'Bund',
          purchaseNote: '',
          categoryId: null,
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    })
    const ground = byName(result, 'Koriander gemahlen')
    expect(ground.key).toBe(shoppingItemKey('Koriander gemahlen'))
    expect(ground.categoryId).toBe('spices')
    expect(amounts(ground)).toEqual(['1 TL'])
    const fresh = byName(result, 'Koriander')
    expect(fresh.key).toBe(shoppingItemKey('Koriander'))
    expect(fresh.categoryId).toBe('produce')
    expect(amounts(fresh)).toEqual(['1 Bund'])
  })
})

describe('free dishes use the same ingredient identity', () => {
  it('aggregates a free dish and a recipe into one article', () => {
    const freeDish: FreeDish = {
      id: 'f1',
      name: 'Curry',
      referenceServings: 2,
      ingredients: [
        ingredient({ name: 'Kreuzkümmelpulver', raw: '1 TL Kreuzkümmelpulver', quantity: 1, quantityText: '1', unit: 'TL' }),
      ],
      createdAt: 1,
      updatedAt: 1,
    }
    const result = build({
      recipes: [
        recipe({
          ingredients: [
            ingredient({ name: 'Kreuzkümmel', raw: '2 TL Kreuzkümmel', quantity: 2, quantityText: '2', unit: 'TL' }),
          ],
        }),
      ],
      freeDishes: [freeDish],
      cookSessions: [
        session(),
        session({ id: 's2', recipeId: undefined, freeDishId: 'f1', date: '2026-05-08' }),
      ],
    })
    const cumin = byName(result, 'Kreuzkümmel')
    expect(amounts(cumin)).toEqual(['3 TL'])
    expect(cumin.sources.map((source) => source.kind).sort()).toEqual(['cook', 'cook'])
  })
})
