import { describe, expect, it } from 'vitest'
import type {
  CookSession,
  FreeDish,
  Ingredient,
  Recipe,
  ShoppingCheck,
  ShoppingItemRule,
  ShoppingManualItem,
  ShoppingPurchase,
  ShoppingQuantityCorrection,
} from '../types'
import {
  buildShoppingList,
  categoryOrderWithMove,
  classifyIngredientForShopping,
  editableShoppingAmount,
  formatShoppingAmount,
  groupOpenItems,
  guessShoppingCategory,
  isCurrentShoppingWeek,
  isNonShoppingIngredient,
  normalizeCategoryOrder,
  shoppingItemKey,
  shoppingPositionSignature,
  shoppingWeek,
  splitIngredientName,
  type ShoppingListInput,
  type ShoppingListItem,
} from './shopping'

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
    title: 'Bolognese',
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

function freeDish(overrides: Partial<FreeDish> = {}): FreeDish {
  return {
    id: 'f1',
    name: 'Curry',
    referenceServings: 2,
    ingredients: [ingredient({ name: 'Zwiebeln', quantityText: '3' })],
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

function manual(overrides: Partial<ShoppingManualItem> = {}): ShoppingManualItem {
  return {
    id: 'm1',
    weekStart: '2026-05-07',
    name: 'Milch',
    quantityText: '1',
    unit: 'l',
    purchaseNote: '',
    categoryId: null,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }
}

function check(overrides: Partial<ShoppingCheck> = {}): ShoppingCheck {
  return {
    id: '2026-05-07|zwiebel',
    weekStart: '2026-05-07',
    itemKey: 'zwiebel',
    checked: true,
    purchased: [{ dimension: 'count', lower: 2, upper: 2 }],
    updatedAt: 1,
    ...overrides,
  }
}

function purchase(overrides: Partial<ShoppingPurchase> = {}): ShoppingPurchase {
  return {
    id: 'p1',
    shoppingDate: '2026-05-07',
    itemKey: 'zwiebel',
    amounts: [{ dimension: 'count', lower: 2, upper: 2 }],
    confirmedTotal: [{ dimension: 'count', lower: 2, upper: 2 }],
    snapshot: [{ dimension: 'count', lower: 2, upper: 2 }],
    qualitative: false,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }
}

function rule(overrides: Partial<ShoppingItemRule> = {}): ShoppingItemRule {
  return {
    key: 'zwiebel',
    canonicalKey: 'zwiebel',
    displayName: '',
    categoryId: null,
    purchaseNote: '',
    updatedAt: 1,
    ...overrides,
  }
}

function list(overrides: Partial<ShoppingListInput> = {}) {
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

function item(result: ReturnType<typeof list>, name: string): ShoppingListItem {
  const found = result.items.find((entry) => entry.name === name)
  if (!found) throw new Error(`Missing item ${name}`)
  return found
}

function amount(itemValue: ShoppingListItem): string[] {
  return itemValue.positions.map((position) => formatShoppingAmount(position))
}

describe('shopping demand from cooking events', () => {
  it('counts one cooking event exactly once, even when it feeds several days', () => {
    const result = list({
      recipes: [recipe()],
      cookSessions: [session()],
    })
    expect(result.items).toHaveLength(1)
    expect(amount(item(result, 'Zwiebeln'))).toEqual(['2 Stück'])
  })

  it('adds independent cooking events of the same recipe', () => {
    const result = list({
      recipes: [recipe()],
      cookSessions: [session(), session({ id: 's2', date: '2026-05-09' })],
    })
    expect(amount(item(result, 'Zwiebeln'))).toEqual(['4 Stück'])
  })

  it('scales the shared recipe amount for the cooking portions', () => {
    const result = list({
      recipes: [recipe({ servingsNumber: 2, servingsText: '2' })],
      cookSessions: [session({ servings: 6 })],
    })
    expect(amount(item(result, 'Zwiebeln'))).toEqual(['6 Stück'])
  })

  it('combines library recipes and free dishes', () => {
    const result = list({
      recipes: [recipe()],
      freeDishes: [freeDish()],
      cookSessions: [session(), session({ id: 's2', recipeId: null, freeDishId: 'f1' })],
    })
    const onions = item(result, 'Zwiebeln')
    expect(amount(onions)).toEqual(['5 Stück'])
    expect(onions.sources.map((source) => source.kind)).toEqual(['cook', 'cook'])
  })

  it('ignores cooked cooking events for open demand', () => {
    const result = list({
      recipes: [recipe()],
      cookSessions: [session({ status: 'cooked' })],
    })
    expect(result.items).toHaveLength(0)
    expect(result.counts.open).toBe(0)
  })

  it('includes only cooking events whose planned date is inside the week', () => {
    const result = list({
      recipes: [recipe()],
      cookSessions: [
        session({ id: 'before', date: '2026-05-06' }),
        session({ id: 'inside', date: '2026-05-07' }),
        session({ id: 'after', date: '2026-05-14' }),
      ],
    })
    expect(amount(item(result, 'Zwiebeln'))).toEqual(['2 Stück'])
  })

  it('keeps the amount unchanged when a cooking event moves within the week', () => {
    const before = list({ recipes: [recipe()], cookSessions: [session({ date: '2026-05-07' })] })
    const after = list({ recipes: [recipe()], cookSessions: [session({ date: '2026-05-10' })] })
    expect(amount(item(after, 'Zwiebeln'))).toEqual(amount(item(before, 'Zwiebeln')))
  })

  it('drops deleted cooking events from the total', () => {
    const both = list({
      recipes: [recipe()],
      cookSessions: [session(), session({ id: 's2', date: '2026-05-09' })],
    })
    const oneDeleted = list({ recipes: [recipe()], cookSessions: [session()] })
    expect(amount(item(both, 'Zwiebeln'))).toEqual(['4 Stück'])
    expect(amount(item(oneDeleted, 'Zwiebeln'))).toEqual(['2 Stück'])
  })

  it('changes the total when the cooking portions change', () => {
    const two = list({ recipes: [recipe()], cookSessions: [session()] })
    const four = list({ recipes: [recipe()], cookSessions: [session({ servings: 4 })] })
    expect(amount(item(two, 'Zwiebeln'))).toEqual(['2 Stück'])
    expect(amount(item(four, 'Zwiebeln'))).toEqual(['4 Stück'])
  })

  it('supports Thursday and Monday week starts without hardcoding a weekday', () => {
    const thursday = shoppingWeek('2026-05-07', 3)
    expect(thursday.start).toBe('2026-05-07')
    expect(thursday.end).toBe('2026-05-13')

    const monday = shoppingWeek('2026-05-07', 0)
    expect(monday.start).toBe('2026-05-04')
    expect(monday.end).toBe('2026-05-10')
    expect(shoppingWeek('2026-05-07', 6).start).toBe('2026-05-03')
  })

  it('never counts a session twice at week or overlap boundaries', () => {
    const result = list({
      recipes: [recipe()],
      cookSessions: [session({ date: '2026-05-13' })],
    })
    expect(amount(item(result, 'Zwiebeln'))).toEqual(['2 Stück'])
    expect(result.items).toHaveLength(1)
  })

  it('is usable without recipes, cooking events or manual articles', () => {
    const result = list()
    expect(result.items).toEqual([])
    expect(result.week.start).toBe('2026-05-07')
  })

  it('ignores day notes and meal appointments; only cooking events are inputs', () => {
    const base = list({ recipes: [recipe()], cookSessions: [session()] })
    const withExtras = buildShoppingList({
      anchor: '2026-05-07',
      weekStartDay: 3,
      recipes: [recipe()],
      freeDishes: [],
      cookSessions: [session()],
      manualItems: [],
      purchases: [],
      rules: [],
      dayNotes: [{ date: '2026-05-07', text: 'Kommentar', createdAt: 1, updatedAt: 1 }],
      mealPlans: [{ id: 'plan', date: '2026-05-07', slot: 'dinner' }],
    } as ShoppingListInput)
    expect(amount(item(withExtras, 'Zwiebeln'))).toEqual(amount(item(base, 'Zwiebeln')))
    expect(withExtras.items).toHaveLength(base.items.length)
  })
})

describe('amount aggregation and units', () => {
  it('adds identical products with compatible quantities', () => {
    const result = list({
      recipes: [
        recipe({
          id: 'r1',
          ingredients: [ingredient({ quantityText: '2', unit: 'Stück' })],
        }),
        recipe({
          id: 'r2',
          title: 'Curry',
          ingredients: [ingredient({ quantityText: '3', unit: 'Stück' })],
        }),
      ],
      cookSessions: [session(), session({ id: 's2', recipeId: 'r2', date: '2026-05-08' })],
    })
    expect(amount(item(result, 'Zwiebeln'))).toEqual(['5 Stück'])
  })

  it('converts g/kg and ml/l', () => {
    const result = list({
      recipes: [
        recipe({
          id: 'r1',
          ingredients: [ingredient({ name: 'Mehl', quantityText: '500', unit: 'g' })],
        }),
        recipe({
          id: 'r2',
          title: 'Kuchen',
          ingredients: [
            ingredient({ name: 'Mehl', quantityText: '1', unit: 'kg' }),
            ingredient({ name: 'Wasser', quantityText: '1', unit: 'l' }),
          ],
        }),
        recipe({
          id: 'r3',
          title: 'Sauce',
          ingredients: [
            ingredient({ name: 'Wasser', quantityText: '250', unit: 'ml' }),
            ingredient({ name: 'Milch', quantityText: '1', unit: 'l' }),
          ],
        }),
      ],
      cookSessions: [session(), session({ id: 's2', recipeId: 'r2' }), session({ id: 's3', recipeId: 'r3' })],
    })
    expect(amount(item(result, 'Mehl'))).toEqual(['1,5 kg'])
    expect(amount(item(result, 'Wasser'))).toEqual(['1,25 l'])
    expect(amount(item(result, 'Milch'))).toEqual(['1 l'])
  })

  it('merges explicit pieces with unitless pieces but keeps product variants apart', () => {
    const result = list({
      recipes: [
        recipe({ ingredients: [ingredient({ name: 'Zwiebeln', quantityText: '2', unit: null })] }),
        recipe({
          id: 'r2',
          title: 'Curry',
          ingredients: [ingredient({ name: 'Zwiebel', quantityText: '3', unit: 'Stück' })],
        }),
      ],
      cookSessions: [session(), session({ id: 's2', recipeId: 'r2' })],
    })
    expect(result.items).toHaveLength(1)
    expect(amount(item(result, 'Zwiebeln'))).toEqual(['5 Stück'])
  })

  it('keeps incompatible units as separate positions under one article', () => {
    const result = list({
      recipes: [
        recipe({
          ingredients: [
            ingredient({ name: 'Tomaten', quantityText: '200', unit: 'g' }),
            ingredient({ name: 'Tomaten', quantityText: '2', unit: 'Stück' }),
            ingredient({ name: 'Pesto', quantityText: '1', unit: 'Glas' }),
            ingredient({ name: 'Pesto', quantityText: '150', unit: 'g' }),
            ingredient({ name: 'Öl', quantityText: '2', unit: 'EL' }),
            ingredient({ name: 'Öl', quantityText: '100', unit: 'ml' }),
          ],
        }),
      ],
      cookSessions: [session()],
    })
    expect(amount(item(result, 'Tomaten'))).toEqual(['200 g', '2 Stück'])
    expect(amount(item(result, 'Pesto'))).toEqual(['150 g', '1 Glas'])
    expect(amount(item(result, 'Öl'))).toEqual(['100 ml', '2 EL'])
  })

  it('keeps both bounds of ranges and the ca. qualifier', () => {
    const result = list({
      recipes: [
        recipe({
          ingredients: [ingredient({ name: 'Mehl', quantityText: 'ca. 500–600', unit: 'g' })],
        }),
      ],
      cookSessions: [session()],
    })
    expect(amount(item(result, 'Mehl'))).toEqual(['ca. 500–600 g'])
  })

  it('keeps unstructured amounts instead of inventing a number', () => {
    const result = list({
      recipes: [
        recipe({
          ingredients: [
            ingredient({ name: 'Salz', quantityText: 'etwas', unit: null }),
            ingredient({ name: 'Pfeffer', quantity: null, quantityText: null, unit: null }),
          ],
        }),
      ],
      cookSessions: [session()],
    })
    expect(item(result, 'Salz').unparsedAmounts).toEqual(['etwas'])
    expect(item(result, 'Salz').positions).toEqual([])
    expect(item(result, 'Pfeffer').missingQuantity).toBe(true)
  })

  it('does not merge different product kinds just because the names are similar', () => {
    const result = list({
      recipes: [
        recipe({
          ingredients: [
            ingredient({ name: 'Kichererbsen', quantityText: '1', unit: 'Dose' }),
            ingredient({ name: 'Erbsen', quantityText: '200', unit: 'g' }),
          ],
        }),
      ],
      cookSessions: [session()],
    })
    expect(result.items.map((entry) => entry.name).sort()).toEqual(['Erbsen', 'Kichererbsen'])
  })
})

describe('shopping and preparation notes', () => {
  it('uses purchase notes and drops explicit preparation notes', () => {
    const result = list({
      recipes: [
        recipe({
          ingredients: [
            ingredient({
              name: 'Zwiebeln',
              purchaseNote: 'bevorzugt rot',
              preparationNote: 'fein gewürfelt',
            }),
          ],
        }),
      ],
      cookSessions: [session()],
    })
    const onions = item(result, 'Zwiebeln')
    expect(onions.purchaseNotes).toEqual(['bevorzugt rot'])
    expect(JSON.stringify(onions)).not.toContain('fein gewürfelt')
  })

  it('cleans clearly recognisable preparation parentheses from old imports', () => {
    expect(splitIngredientName('Zwiebeln (fein gewürfelt)')).toMatchObject({
      name: 'Zwiebeln',
      preparationNote: 'fein gewürfelt',
      embeddedPurchaseNote: '',
    })
    expect(splitIngredientName('Petersilie, gehackt').name).toBe('Petersilie')
    expect(splitIngredientName('Mandeln (gehackte)').name).toBe('Mandeln')
  })

  it('treats pure measurement parentheses as a hint, not a variant', () => {
    const grams = splitIngredientName('Tomaten (400 g)')
    expect(grams.name).toBe('Tomaten')
    expect(grams.variant).toBe('')
    expect(grams.embeddedPurchaseNote).toBe('400 g')

    const fractional = splitIngredientName('Sahne (1/2 l)')
    expect(fractional.name).toBe('Sahne')
    expect(fractional.variant).toBe('')
    expect(fractional.embeddedPurchaseNote).toBe('1/2 l')
  })

  it('keeps unknown parentheses as product variants but recognises reliable hints', () => {
    const branded = splitIngredientName('passierte Tomaten (Mutti)')
    expect(branded.name).toBe('passierte Tomaten')
    expect(branded.variant).toBe('Mutti')
    expect(shoppingItemKey(branded.identityName)).not.toBe(shoppingItemKey('passierte Tomaten'))

    const wine = splitIngredientName('Rotwein (trocken, z. B. Dornfelder)')
    expect(wine.name).toBe('Rotwein')
    expect(wine.variant).toBe('')
    expect(wine.embeddedPurchaseNote).toBe('trocken, z. B. Dornfelder')

    const speck = splitIngredientName('Speck (Südtiroler Speck)')
    expect(speck.name).toBe('Speck')
    expect(speck.variant).toBe('Südtiroler Speck')

    const result = list({
      recipes: [
        recipe({
          ingredients: [
            ingredient({ name: 'Rotwein (trocken, z. B. Dornfelder)' }),
            ingredient({ name: 'Speck (Südtiroler Speck)' }),
          ],
        }),
      ],
      cookSessions: [session()],
    })
    expect(item(result, 'Rotwein').purchaseNotes.join(' ')).toContain('Dornfelder')
    expect(item(result, 'Speck').variant).toContain('Südtiroler')
  })

  it('keeps product variants apart and still groups pure preparation notes', () => {
    const result = list({
      recipes: [
        recipe({
          ingredients: [
            ingredient({ name: 'Pesto (grün)', quantityText: '1', unit: 'Glas' }),
            ingredient({ name: 'Pesto (rot)', quantityText: '1', unit: 'Glas' }),
            ingredient({ name: 'Zwiebeln (fein gewürfelt)', quantityText: '2', unit: 'Stück' }),
            ingredient({ name: 'Zwiebeln', quantityText: '1', unit: 'Stück' }),
          ],
        }),
      ],
      cookSessions: [session()],
    })
    const pesto = result.items.filter((entry) => entry.name === 'Pesto')
    expect(pesto).toHaveLength(2)
    expect(pesto.map((entry) => entry.variant).sort()).toEqual(['grün', 'rot'])
    const onions = result.items.find((entry) => entry.name === 'Zwiebeln')
    expect(onions?.variant).toBe('')
    expect(onions?.positions.map(formatShoppingAmount)).toEqual(['3 Stück'])
  })
})

describe('product identity', () => {
  it('keeps product-determining variants apart', () => {
    const result = list({
      recipes: [
        recipe({
          ingredients: [
            ingredient({ name: 'Pesto (grün)', quantityText: '1', unit: 'Glas' }),
            ingredient({ name: 'Pesto (rot)', quantityText: '1', unit: 'Glas' }),
            ingredient({ name: 'Frische Hefe', quantityText: '1', unit: 'Würfel' }),
            ingredient({ name: 'Trockenhefe', quantityText: '1', unit: 'Päckchen' }),
            ingredient({ name: 'Mehl Type 405', quantityText: '500', unit: 'g' }),
            ingredient({ name: 'Mehl Type 550', quantityText: '500', unit: 'g' }),
            ingredient({ name: 'Mozzarella', quantityText: '1', unit: 'Kugel' }),
            ingredient({ name: 'Mozzarella light', quantityText: '1', unit: 'Kugel' }),
            ingredient({ name: 'Rinderhackfleisch', quantityText: '500', unit: 'g' }),
            ingredient({ name: 'gemischtes Hackfleisch', quantityText: '500', unit: 'g' }),
          ],
        }),
      ],
      cookSessions: [session()],
    })
    expect(new Set(result.items.map((entry) => entry.key)).size).toBe(10)
    expect(result.items.filter((entry) => entry.name === 'Pesto')).toHaveLength(2)
    expect(
      result.items.filter((entry) => entry.name === 'Pesto').map((entry) => entry.variant).sort(),
    ).toEqual(['grün', 'rot'])
    expect(result.items.some((entry) => entry.name === 'Frische Hefe')).toBe(true)
    expect(result.items.some((entry) => entry.name === 'Trockenhefe')).toBe(true)
    expect(result.items.some((entry) => entry.name === 'Mehl Type 405')).toBe(true)
    expect(result.items.some((entry) => entry.name === 'Mehl Type 550')).toBe(true)
    expect(result.items.some((entry) => entry.name === 'Mozzarella light')).toBe(true)
    expect(result.items.some((entry) => entry.name === 'Rinderhackfleisch')).toBe(true)
    expect(result.items.some((entry) => entry.name === 'gemischtes Hackfleisch')).toBe(true)
  })

  it('groups identical products with only preparation instructions', () => {
    const result = list({
      recipes: [
        recipe({
          ingredients: [
            ingredient({ name: 'Zwiebeln (fein gewürfelt)', quantityText: '2', unit: 'Stück' }),
            ingredient({ name: 'Zwiebeln', quantityText: '1', unit: 'Stück' }),
            ingredient({ name: 'Petersilie (gehackt)', quantityText: '1', unit: 'Bund' }),
            ingredient({ name: 'Petersilie', quantityText: '1', unit: 'Bund' }),
          ],
        }),
      ],
      cookSessions: [session()],
    })
    const onions = result.items.find((entry) => entry.name === 'Zwiebeln')
    const parsley = result.items.find((entry) => entry.name === 'Petersilie')
    expect(onions?.variant).toBe('')
    expect(onions?.positions.map(formatShoppingAmount)).toEqual(['3 Stück'])
    expect(parsley?.variant).toBe('')
    expect(parsley?.positions.map(formatShoppingAmount)).toEqual(['2 Bund'])
  })

  it('retains unknown parentheses in the identity and display', () => {
    const result = list({
      recipes: [
        recipe({
          ingredients: [
            ingredient({ name: 'Tomaten (Mutti)', quantityText: '400', unit: 'g' }),
            ingredient({ name: 'Tomaten', quantityText: '300', unit: 'g' }),
          ],
        }),
      ],
      cookSessions: [session()],
    })
    const tomatoes = result.items.filter((entry) => entry.name === 'Tomaten')
    expect(tomatoes).toHaveLength(2)
    expect(tomatoes.map((entry) => entry.variant).sort()).toEqual(['', 'Mutti'])
  })

  it('allows a deliberate manual merge of two variants', () => {
    const result = list({
      recipes: [
        recipe({
          ingredients: [
            ingredient({ name: 'Pesto (grün)', quantityText: '1', unit: 'Glas' }),
            ingredient({ name: 'Pesto (rot)', quantityText: '1', unit: 'Glas' }),
          ],
        }),
      ],
      cookSessions: [session()],
      rules: [
        rule({
          key: shoppingItemKey('Pesto rot'),
          canonicalKey: shoppingItemKey('Pesto grün'),
        }),
      ],
    })
    expect(result.items).toHaveLength(1)
    const pesto = result.items[0]!
    expect(pesto.positions.map(formatShoppingAmount)).toEqual(['2 Glas'])
    expect(pesto.variant).toBe('grün · rot')
  })

  it('keeps historical purchases attached through a legacy alias rule', () => {
    const result = list({
      recipes: [
        recipe({
          ingredients: [ingredient({ name: 'Pesto (grün)', quantityText: '1', unit: 'Glas' })],
        }),
      ],
      cookSessions: [session()],
      rules: [
        rule({
          key: 'pesto',
          canonicalKey: shoppingItemKey('Pesto grün'),
        }),
      ],
      purchases: [
        purchase({
          itemKey: 'pesto',
          amounts: [{ dimension: 'unit:glas', lower: 1, upper: 1 }],
          snapshot: [{ dimension: 'unit:glas', lower: 1, upper: 1 }],
        }),
      ],
    })
    expect(item(result, 'Pesto').status).toBe('done')
    expect(item(result, 'Pesto').purchases).toHaveLength(1)
  })

  it('does not change stored recipe ingredient data', () => {
    const data = recipe({
      ingredients: [
        ingredient({ name: 'Pesto (grün)', quantityText: '1', unit: 'Glas' }),
        ingredient({ name: 'Zwiebeln (fein gewürfelt)', quantityText: '2', unit: 'Stück' }),
      ],
    })
    const before = JSON.stringify(data)
    list({ recipes: [data], cookSessions: [session()] })
    expect(JSON.stringify(data)).toBe(before)
  })
})

describe('manual articles', () => {
  it('merges compatible manual and recipe amounts without losing the manual source', () => {
    const result = list({
      recipes: [recipe()],
      cookSessions: [session()],
      manualItems: [manual({ name: 'Zwiebeln', quantityText: '3', unit: 'Stück' })],
    })
    const onions = item(result, 'Zwiebeln')
    expect(amount(onions)).toEqual(['5 Stück'])
    expect(onions.manualItems).toHaveLength(1)
    expect(onions.sources.some((source) => source.kind === 'manual')).toBe(true)
  })

  it('keeps manual articles in their own week', () => {
    const result = list({ manualItems: [manual({ weekStart: '2026-05-14', name: 'Kaffee' })] })
    expect(result.items).toHaveLength(0)
  })

  it('supports manual articles without quantity or unit', () => {
    const result = list({ manualItems: [manual({ name: 'Toilettenpapier', quantityText: null, unit: null })] })
    const toilet = item(result, 'Toilettenpapier')
    expect(toilet.positions).toEqual([])
    expect(toilet.unparsedAmounts).toEqual([])
    expect(toilet.status).toBe('open')
  })
})

describe('checked state and plan changes', () => {
  it('keeps purchased amounts when the plan grows and shows only the additional need', () => {
    const result = list({
      recipes: [recipe({ ingredients: [ingredient({ quantityText: '5', unit: 'Stück' })] })],
      cookSessions: [session()],
      checks: [check()],
    })
    const onions = item(result, 'Zwiebeln')
    expect(onions.status).toBe('open')
    expect(amount(onions)).toEqual(['3 Stück'])
    expect(onions.purchased.map((position) => formatShoppingAmount(position))).toEqual(['2 Stück'])
  })

  it('never creates negative demand when the plan shrinks', () => {
    const result = list({
      recipes: [recipe({ ingredients: [ingredient({ quantityText: '1', unit: 'Stück' })] })],
      cookSessions: [session()],
      checks: [check()],
    })
    const onions = item(result, 'Zwiebeln')
    expect(onions.positions).toEqual([])
    expect(onions.status).toBe('done')
  })

  it('marks a checked range complete without a phantom remainder', () => {
    const result = list({
      recipes: [
        recipe({ ingredients: [ingredient({ name: 'Mehl', quantityText: '2–3', unit: 'kg' })] }),
      ],
      cookSessions: [session()],
      checks: [
        check({
          itemKey: shoppingItemKey('Mehl'),
          purchased: [{ dimension: 'mass', lower: 2000, upper: 3000 }],
        }),
      ],
    })
    expect(item(result, 'Mehl').status).toBe('done')
    expect(item(result, 'Mehl').positions).toEqual([])
  })

  it('keeps a fully checked article done and lets an unstructured check stay done', () => {
    const quantity = list({
      recipes: [recipe()],
      cookSessions: [session()],
      checks: [check()],
    })
    expect(item(quantity, 'Zwiebeln').status).toBe('done')

    const unstructured = list({
      recipes: [recipe({ ingredients: [ingredient({ name: 'Salz', quantityText: 'etwas' })] })],
      cookSessions: [session()],
      checks: [check({ itemKey: 'salz', purchased: [] })],
    })
    expect(item(unstructured, 'Salz').status).toBe('done')
  })
})

describe('product merging and purchase hints', () => {
  it('groups two identities into one product and adds compatible amounts', () => {
    const withBrand = recipe({
      id: 'r1',
      ingredients: [
        ingredient({ name: 'Tomaten Dose', quantityText: '350', unit: 'ml' }),
      ],
    })
    const plain = recipe({
      id: 'r2',
      title: 'Sauce',
      ingredients: [ingredient({ name: 'Tomaten', quantityText: '400', unit: 'ml' })],
    })
    const alias = shoppingItemKey('Tomaten Dose')
    const target = shoppingItemKey('Tomaten')
    const before = JSON.stringify([withBrand, plain])
    const result = list({
      recipes: [withBrand, plain],
      cookSessions: [
        session({ id: 's1', recipeId: 'r1' }),
        session({ id: 's2', recipeId: 'r2' }),
      ],
      rules: [
        rule({ key: alias, canonicalKey: target }),
        rule({ key: target, canonicalKey: target, displayName: 'Tomaten' }),
      ],
    })
    expect(result.items).toHaveLength(1)
    expect(item(result, 'Tomaten').positions.map(formatShoppingAmount)).toEqual(['750 ml'])
    expect(JSON.stringify([withBrand, plain])).toBe(before)
  })

  it('keeps incompatible dimensions separate after merging', () => {
    const alias = shoppingItemKey('Tomaten Dose')
    const target = shoppingItemKey('Tomaten')
    const result = list({
      recipes: [
        recipe({
          ingredients: [
            ingredient({ name: 'Tomaten Dose', quantityText: '350', unit: 'ml' }),
            ingredient({ name: 'Tomaten', quantityText: '2', unit: 'Stück' }),
          ],
        }),
      ],
      cookSessions: [session()],
      rules: [rule({ key: alias, canonicalKey: target })],
    })
    expect(item(result, 'Tomaten').positions.map(formatShoppingAmount)).toEqual([
      '350 ml',
      '2 Stück',
    ])
  })

  it('hides a recipe hint and supports a full override without touching the recipe', () => {
    const base = recipe({
      ingredients: [
        ingredient({
          name: 'Tomaten',
          quantityText: '400',
          unit: 'g',
          purchaseNote: 'bevorzugt Mutti',
        }),
      ],
    })
    const target = shoppingItemKey('Tomaten')
    const hidden = list({
      recipes: [base],
      cookSessions: [session()],
      rules: [
        rule({
          key: target,
          canonicalKey: target,
          hiddenPurchaseNotes: ['bevorzugt Mutti'],
          purchaseNote: 'Bio',
        }),
      ],
    })
    expect(item(hidden, 'Tomaten').purchaseNotes).toEqual(['Bio'])

    const override = list({
      recipes: [base],
      cookSessions: [session()],
      rules: [
        rule({
          key: target,
          canonicalKey: target,
          hiddenPurchaseNotes: ['bevorzugt Mutti'],
          purchaseNote: 'nur Bio',
          purchaseNoteOverride: true,
        }),
      ],
    })
    expect(item(override, 'Tomaten').purchaseNotes).toEqual(['nur Bio'])
    expect(base.ingredients[0]?.purchaseNote).toBe('bevorzugt Mutti')
  })
})

describe('individual purchase actions and ranges', () => {
  it('settles a confirmed amount inside a range without inventing the upper bound', () => {
    const ranged = recipe({
      ingredients: [ingredient({ name: 'Zwiebeln', quantityText: '2–3', unit: 'Stück' })],
    })
    const target = shoppingItemKey('Zwiebeln')
    const result = list({
      recipes: [ranged],
      cookSessions: [session()],
      purchases: [
        purchase({
          itemKey: target,
          amounts: [{ dimension: 'count', lower: 2, upper: 2 }],
          snapshot: [{ dimension: 'count', lower: 2, upper: 3 }],
        }),
      ],
    })
    const onions = item(result, 'Zwiebeln')
    expect(onions.status).toBe('done')
    expect(onions.purchased.map(formatShoppingAmount)).toEqual(['2 Stück'])
    expect(onions.positions).toEqual([])
  })

  it('shows the additional need after a later plan increase', () => {
    const grown = recipe({
      ingredients: [ingredient({ name: 'Zwiebeln', quantityText: '4–5', unit: 'Stück' })],
    })
    const target = shoppingItemKey('Zwiebeln')
    const result = list({
      recipes: [grown],
      cookSessions: [session()],
      purchases: [
        purchase({
          itemKey: target,
          amounts: [{ dimension: 'count', lower: 2, upper: 2 }],
          snapshot: [{ dimension: 'count', lower: 2, upper: 3 }],
        }),
      ],
    })
    const onions = item(result, 'Zwiebeln')
    expect(onions.status).toBe('open')
    expect(onions.positions.map(formatShoppingAmount)).toEqual(['2–3 Stück'])
    expect(onions.purchased.map(formatShoppingAmount)).toEqual(['2 Stück'])
  })

  it('keeps two partial purchases and removes only the newest from the open need', () => {
    const target = shoppingItemKey('Zwiebeln')
    const five = recipe({
      ingredients: [ingredient({ name: 'Zwiebeln', quantityText: '5', unit: 'Stück' })],
    })
    const withBoth = list({
      recipes: [five],
      cookSessions: [session()],
      purchases: [
        purchase({
          id: 'first',
          itemKey: target,
          amounts: [{ dimension: 'count', lower: 2, upper: 2 }],
          snapshot: [{ dimension: 'count', lower: 2, upper: 2 }],
          createdAt: 1,
        }),
        purchase({
          id: 'second',
          itemKey: target,
          amounts: [{ dimension: 'count', lower: 3, upper: 3 }],
          snapshot: [{ dimension: 'count', lower: 5, upper: 5 }],
          createdAt: 2,
        }),
      ],
    })
    expect(item(withBoth, 'Zwiebeln').status).toBe('done')

    const afterUndo = list({
      recipes: [five],
      cookSessions: [session()],
      purchases: [
        purchase({
          id: 'first',
          itemKey: target,
          amounts: [{ dimension: 'count', lower: 2, upper: 2 }],
          snapshot: [{ dimension: 'count', lower: 2, upper: 2 }],
        }),
      ],
    })
    expect(item(afterUndo, 'Zwiebeln').status).toBe('open')
    expect(item(afterUndo, 'Zwiebeln').positions.map(formatShoppingAmount)).toEqual(['3 Stück'])

    // Removing the older action while the newer one remains must reopen the
    // missing amount as well; the newer snapshot alone is not enough.
    const onlySecond = list({
      recipes: [five],
      cookSessions: [session()],
      purchases: [
        purchase({
          id: 'second',
          itemKey: target,
          amounts: [{ dimension: 'count', lower: 3, upper: 3 }],
          confirmedTotal: [{ dimension: 'count', lower: 5, upper: 5 }],
          snapshot: [{ dimension: 'count', lower: 5, upper: 5 }],
          createdAt: 2,
        }),
      ],
    })
    expect(item(onlySecond, 'Zwiebeln').status).toBe('open')
    expect(item(onlySecond, 'Zwiebeln').positions.map(formatShoppingAmount)).toEqual(['2 Stück'])
  })

  it('marks an unstructured need done without inventing an amount', () => {
    const salt = recipe({
      ingredients: [ingredient({ name: 'Salz', quantityText: 'etwas', unit: null })],
    })
    const target = shoppingItemKey('Salz')
    const result = list({
      recipes: [salt],
      cookSessions: [session()],
      purchases: [
        purchase({
          itemKey: target,
          amounts: [],
          snapshot: [],
          qualitative: true,
        }),
      ],
    })
    const saltItem = item(result, 'Salz')
    expect(saltItem.status).toBe('done')
    expect(saltItem.purchased).toEqual([])
  })
})

describe('week start changes and dated data', () => {
  it('keeps a manual article findable after switching Thursday to Saturday', () => {
    const article = manual({ shoppingDate: '2026-11-05', weekStart: '2026-11-05', name: 'Milch' })
    const thursday = list({
      anchor: '2026-11-05',
      weekStartDay: 3,
      manualItems: [article],
    })
    const saturday = list({
      anchor: '2026-11-05',
      weekStartDay: 5,
      manualItems: [article],
    })
    expect(thursday.week.start).toBe('2026-11-05')
    expect(saturday.week.start).toBe('2026-10-31')
    expect(item(thursday, 'Milch')).toBeDefined()
    expect(item(saturday, 'Milch')).toBeDefined()
  })

  it('never duplicates two old week anchors after the week start changes', () => {
    const first = manual({ id: 'm1', shoppingDate: '2026-11-05', name: 'Milch' })
    const second = manual({ id: 'm2', shoppingDate: '2026-11-12', name: 'Kaffee' })
    const weekA = list({
      anchor: '2026-11-05',
      weekStartDay: 5,
      manualItems: [first, second],
    })
    const weekB = list({
      anchor: '2026-11-12',
      weekStartDay: 5,
      manualItems: [first, second],
    })
    expect(weekA.items.map((entry) => entry.name)).toEqual(['Milch'])
    expect(weekB.items.map((entry) => entry.name)).toEqual(['Kaffee'])
  })

  it('knows the current shopping week from the configured weekday', () => {
    expect(isCurrentShoppingWeek('2026-05-07', '2026-05-07', 3)).toBe(true)
    expect(isCurrentShoppingWeek('2026-04-30', '2026-05-07', 3)).toBe(false)
  })

  it('handles a year boundary without losing the dated article', () => {
    const article = manual({ shoppingDate: '2026-12-31', name: 'Sekt' })
    const thursday = list({ anchor: '2026-12-31', weekStartDay: 3, manualItems: [article] })
    const saturday = list({ anchor: '2026-12-31', weekStartDay: 5, manualItems: [article] })
    expect(item(thursday, 'Sekt')).toBeDefined()
    expect(item(saturday, 'Sekt')).toBeDefined()
    expect(thursday.week.start).toBe('2026-12-31')
    expect(saturday.week.start).toBe('2026-12-26')
  })

  it('keeps a dated purchase in exactly one of the new weeks', () => {
    const purchaseRow = purchase({
      shoppingDate: '2026-11-05',
      itemKey: shoppingItemKey('Zwiebeln'),
      amounts: [{ dimension: 'count', lower: 2, upper: 2 }],
      snapshot: [{ dimension: 'count', lower: 2, upper: 2 }],
    })
    const recipeRow = recipe()
    const thursday = list({
      anchor: '2026-11-05',
      weekStartDay: 3,
      recipes: [recipeRow],
      cookSessions: [session({ date: '2026-11-05' })],
      purchases: [purchaseRow],
    })
    const saturday = list({
      anchor: '2026-11-05',
      weekStartDay: 5,
      recipes: [recipeRow],
      cookSessions: [session({ date: '2026-11-05' })],
      purchases: [purchaseRow],
    })
    expect(item(thursday, 'Zwiebeln').status).toBe('done')
    expect(item(saturday, 'Zwiebeln').status).toBe('done')
    // The neighbouring Saturday week must not see the same purchase.
    const next = list({
      anchor: '2026-11-07',
      weekStartDay: 5,
      recipes: [recipeRow],
      cookSessions: [session({ date: '2026-11-07' })],
      purchases: [purchaseRow],
    })
    expect(item(next, 'Zwiebeln').status).toBe('open')
  })
})

describe('categories and order', () => {
  it('assigns generally known product types', () => {
    expect(guessShoppingCategory('Zwiebeln')).toBe('produce')
    expect(guessShoppingCategory('Hackfleisch')).toBe('meat')
    expect(guessShoppingCategory('Milch')).toBe('dairy')
    expect(guessShoppingCategory('Brot')).toBe('bakery')
    expect(guessShoppingCategory('Spaghetti')).toBe('grains')
    expect(guessShoppingCategory('Passierte Tomaten')).toBe('canned')
    expect(guessShoppingCategory('Olivenöl')).toBe('spices')
    expect(guessShoppingCategory('Tiefkühlpizza')).toBe('frozen')
    expect(guessShoppingCategory('Apfelsaft')).toBe('drinks')
    expect(guessShoppingCategory('Toilettenpapier')).toBe('household')
    expect(guessShoppingCategory('Kokosmilch')).toBe('canned')
    expect(guessShoppingCategory('Wunderding')).toBe('other')
  })

  it('reuses a learned category and display name', () => {
    const result = list({
      recipes: [recipe()],
      cookSessions: [session()],
      rules: [rule({ displayName: 'Gemüsezwiebeln', categoryId: 'canned' })],
    })
    const onions = item(result, 'Gemüsezwiebeln')
    expect(onions.categoryId).toBe('canned')
  })

  it('orders groups by the saved order and omits empty categories', () => {
    const result = list({
      recipes: [recipe()],
      cookSessions: [session()],
    })
    const order = normalizeCategoryOrder(['canned', 'produce'])
    const groups = groupOpenItems(result.items, order)
    expect(groups).toHaveLength(1)
    expect(groups[0]?.category.id).toBe('produce')

    const moved = categoryOrderWithMove(order, 'produce', -1)
    expect(moved[0]).toBe('produce')
    expect(moved[1]).toBe('canned')
  })
})

describe('retired pantry data', () => {
  it('never deducts stock, even if an old caller still passes a pantry array', () => {
    const result = buildShoppingList({
      anchor: '2026-05-07',
      weekStartDay: 3,
      recipes: [recipe()],
      freeDishes: [],
      cookSessions: [session()],
      manualItems: [],
      purchases: [],
      rules: [],
      pantry: [
        {
          id: 'old-pantry',
          itemKey: shoppingItemKey('Zwiebeln'),
          name: 'Zwiebeln',
          quantityText: '2',
          unit: 'Stück',
          buyAnyway: false,
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    } as unknown as ShoppingListInput)

    expect(amount(item(result, 'Zwiebeln'))).toEqual(['2 Stück'])
    expect(result.counts).toEqual({ open: 1, done: 0 })
  })
})

describe('cooking instructions are not products', () => {
  it('drops only pure headings and unambiguous cooking instructions', () => {
    expect(classifyIngredientForShopping('Für die Marinade:').decision).toBe('instruction')
    expect(classifyIngredientForShopping('Zum Servieren:').decision).toBe('instruction')
    expect(classifyIngredientForShopping('Nach Bedarf').decision).toBe('instruction')
    expect(classifyIngredientForShopping('Eventuell etwas Wasser zum Nachgießen').decision).toBe(
      'instruction',
    )
    expect(classifyIngredientForShopping('2 Zwiebeln').decision).toBe('product')
    expect(classifyIngredientForShopping('Salz und Pfeffer').decision).toBe('product')
  })

  it('never drops a concrete purchasable ingredient because of a usage clause', () => {
    const products = [
      'Olivenöl zum Braten',
      'Petersilie zum Garnieren',
      'Sahne zum Servieren',
      'Salz nach Geschmack',
    ]
    for (const product of products) {
      const classification = classifyIngredientForShopping(product)
      expect(classification.decision).not.toBe('instruction')
      expect(isNonShoppingIngredient(product)).toBe(false)
    }
    expect(splitIngredientName('Olivenöl zum Braten')).toMatchObject({
      name: 'Olivenöl',
      variant: '',
      embeddedPurchaseNote: '',
    })
    expect(splitIngredientName('Olivenöl zum Braten').preparationNote).toContain('Braten')

    const result = list({
      recipes: [
        recipe({
          ingredients: [
            ingredient({ name: 'evtl. etwas Wasser zum Nachgießen' }),
            ingredient({ name: 'Für die Marinade:' }),
            ingredient({ name: 'Olivenöl zum Braten', quantityText: '2', unit: 'EL' }),
            ingredient({ name: 'Petersilie zum Garnieren' }),
            ingredient({ name: 'Sahne zum Servieren', quantityText: '100', unit: 'ml' }),
            ingredient({ name: 'Salz nach Geschmack' }),
            ingredient({ name: 'Zwiebeln', quantityText: '2', unit: 'Stück' }),
          ],
        }),
      ],
      cookSessions: [session()],
    })
    const names = result.items.map((entry) => entry.name).sort()
    expect(names).toEqual(['Olivenöl', 'Petersilie', 'Sahne', 'Salz', 'Zwiebeln'])
    expect(names).not.toContain('Wasser')
    expect(names).not.toContain('Für die Marinade')
    expect(item(result, 'Olivenöl').purchaseNotes.join(' ')).not.toContain('Braten')
  })

  it('keeps ambiguous ingredient lines conservatively', () => {
    expect(classifyIngredientForShopping('Haushaltswasser').decision).not.toBe('instruction')
    expect(classifyIngredientForShopping('Wasser').decision).toBe('product')
    expect(classifyIngredientForShopping('Evtl. Wasser').decision).not.toBe('instruction')
    expect(classifyIngredientForShopping('PESTO').decision).not.toBe('instruction')
    expect(classifyIngredientForShopping('SALZ').decision).not.toBe('instruction')
    expect(classifyIngredientForShopping('ZUTATEN').decision).toBe('instruction')
  })
})

function quantityCorrection(
  overrides: Partial<ShoppingQuantityCorrection> = {},
): ShoppingQuantityCorrection {
  return {
    id: 'correction-1',
    shoppingDate: '2026-05-07',
    itemKey: shoppingItemKey('Mehl'),
    dimension: 'mass',
    quantityText: '1',
    unit: 'kg',
    sourceSignature: shoppingPositionSignature({
      dimension: 'mass',
      unit: null,
      lower: 500,
      upper: 500,
      qualifier: '',
    }),
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }
}

describe('week-scoped quantity corrections', () => {
  it('changes only the week in which the correction was created', () => {
    const corrected = list({
      recipes: [
        recipe({
          ingredients: [ingredient({ name: 'Mehl', quantityText: '500', unit: 'g' })],
        }),
      ],
      cookSessions: [session()],
      quantityCorrections: [quantityCorrection()],
    })
    expect(item(corrected, 'Mehl').positions.map(formatShoppingAmount)).toEqual(['1 kg'])

    const nextWeek = list({
      anchor: '2026-05-14',
      recipes: [
        recipe({
          ingredients: [ingredient({ name: 'Mehl', quantityText: '300', unit: 'g' })],
        }),
      ],
      cookSessions: [session({ date: '2026-05-14' })],
      quantityCorrections: [quantityCorrection()],
    })
    expect(item(nextWeek, 'Mehl').positions.map(formatShoppingAmount)).toEqual(['300 g'])
    expect(item(nextWeek, 'Mehl').quantityCorrections).toEqual([])
  })

  it('corrects only the selected dimension and keeps incompatible amounts intact', () => {
    const result = list({
      recipes: [
        recipe({
          ingredients: [
            ingredient({ name: 'Mehl', quantityText: '500', unit: 'g' }),
            ingredient({ name: 'Mehl', quantityText: '2', unit: 'Stück' }),
          ],
        }),
      ],
      cookSessions: [session()],
      quantityCorrections: [quantityCorrection()],
    })
    const flour = item(result, 'Mehl')
    expect(flour.requiredPositions.map(formatShoppingAmount)).toEqual(['1 kg', '2 Stück'])
    expect(flour.quantityCorrections).toHaveLength(1)
    expect(flour.quantityCorrections[0]?.status).toBe('applied')
  })

  it('does not silently apply a correction after the underlying demand changed', () => {
    const result = list({
      recipes: [
        recipe({
          ingredients: [ingredient({ name: 'Mehl', quantityText: '300', unit: 'g' })],
        }),
      ],
      cookSessions: [session()],
      quantityCorrections: [quantityCorrection()],
    })
    const flour = item(result, 'Mehl')
    expect(flour.positions.map(formatShoppingAmount)).toEqual(['300 g'])
    expect(flour.quantityCorrections[0]?.status).toBe('stale')
  })

  it('restores the calculated demand when the correction is removed', () => {
    const recipeRow = recipe({
      ingredients: [ingredient({ name: 'Mehl', quantityText: '500', unit: 'g' })],
    })
    const withCorrection = list({
      recipes: [recipeRow],
      cookSessions: [session()],
      quantityCorrections: [quantityCorrection()],
    })
    const withoutCorrection = list({ recipes: [recipeRow], cookSessions: [session()] })
    expect(item(withCorrection, 'Mehl').positions.map(formatShoppingAmount)).toEqual(['1 kg'])
    expect(item(withoutCorrection, 'Mehl').positions.map(formatShoppingAmount)).toEqual(['500 g'])
  })

  it('keeps purchases independent from quantity corrections', () => {
    const recipeRow = recipe({
      ingredients: [ingredient({ name: 'Mehl', quantityText: '500', unit: 'g' })],
    })
    const result = list({
      recipes: [recipeRow],
      cookSessions: [session()],
      quantityCorrections: [quantityCorrection()],
      purchases: [
        purchase({
          itemKey: shoppingItemKey('Mehl'),
          amounts: [{ dimension: 'mass', lower: 500, upper: 500 }],
          snapshot: [{ dimension: 'mass', lower: 500, upper: 500 }],
          confirmedTotal: [{ dimension: 'mass', lower: 500, upper: 500 }],
        }),
      ],
    })
    const flour = item(result, 'Mehl')
    expect(flour.purchases).toHaveLength(1)
    expect(flour.positions.map(formatShoppingAmount)).toEqual(['500 g'])
  })

  it('keeps a dated correction in the correct week after the week start changes', () => {
    const correction = quantityCorrection({ shoppingDate: '2026-11-06' })
    const recipeRow = recipe({
      ingredients: [ingredient({ name: 'Mehl', quantityText: '500', unit: 'g' })],
    })
    const thursday = list({
      anchor: '2026-11-05',
      weekStartDay: 3,
      recipes: [recipeRow],
      cookSessions: [session({ date: '2026-11-05' })],
      quantityCorrections: [correction],
    })
    const saturday = list({
      anchor: '2026-11-05',
      weekStartDay: 5,
      recipes: [recipeRow],
      cookSessions: [session({ date: '2026-11-05' })],
      quantityCorrections: [correction],
    })
    expect(thursday.week.start).toBe('2026-11-05')
    expect(saturday.week.start).toBe('2026-10-31')
    expect(item(thursday, 'Mehl').positions.map(formatShoppingAmount)).toEqual(['1 kg'])
    expect(item(saturday, 'Mehl').positions.map(formatShoppingAmount)).toEqual(['1 kg'])
  })

  it('exposes an editable display unit for mass, volume and pieces', () => {
    expect(
      editableShoppingAmount({
        dimension: 'mass',
        unit: null,
        lower: 500,
        upper: 500,
        qualifier: '',
      }),
    ).toEqual({ quantityText: '500', unit: 'g' })
    expect(
      editableShoppingAmount({
        dimension: 'volume',
        unit: null,
        lower: 1500,
        upper: 1500,
        qualifier: 'ca.',
      }),
    ).toEqual({ quantityText: 'ca. 1,5', unit: 'l' })
    expect(
      editableShoppingAmount({
        dimension: 'count',
        unit: 'Stück',
        lower: 2,
        upper: 3,
        qualifier: '',
      }),
    ).toEqual({ quantityText: '2–3', unit: 'Stück' })
  })
})

describe('category corrections', () => {
  it('classifies compound products by their head noun', () => {
    expect(guessShoppingCategory('Hackfleisch')).toBe('meat')
    expect(guessShoppingCategory('Rinderhackfleisch')).toBe('meat')
    expect(guessShoppingCategory('Rinderbrühe')).toBe('canned')
    expect(guessShoppingCategory('Gemüsebrühe')).toBe('canned')
    expect(guessShoppingCategory('Hühnerbrühe')).toBe('canned')
    expect(guessShoppingCategory('Brühe')).toBe('canned')
    expect(guessShoppingCategory('Kaffeesahne')).toBe('dairy')
    expect(guessShoppingCategory('Kaffeebohnen')).toBe('drinks')
    expect(guessShoppingCategory('Tiefkühlgemüse')).toBe('frozen')
    expect(guessShoppingCategory('Weißwein')).toBe('drinks')
    expect(guessShoppingCategory('Tomatenmark')).toBe('canned')
    expect(guessShoppingCategory('Petersilie')).toBe('produce')
  })
})
