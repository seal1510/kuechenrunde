import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../db'
import { shoppingItemKey } from '../domain/shopping'
import { standardShoppingListId } from '../domain/shoppingLists'
import type { CookSession, Ingredient, Recipe } from '../types'
import {
  assignShoppingSubquantity,
  createFreeShoppingList,
  createManualListItem,
  deleteFreeShoppingList,
  ensureStandardShoppingList,
  moveShoppingItem,
  moveShoppingPosition,
  removeManualListItem,
  removeShoppingAllocation,
  renameShoppingList,
  resetShoppingAllocations,
  setManualItemPurchased,
  ShoppingListError,
  updateManualListItem,
} from './listService'
import { buildShoppingPageView, type ShoppingPageRow } from './pageView'
import {
  addShoppingPurchase,
  removeShoppingPurchase,
  restoreManualItem,
  saveCategoryOrder,
  saveItemRule,
} from './service'

const PERIOD = '2026-11-05'
const NEXT_PERIOD = '2026-11-12'

async function clearAll(): Promise<void> {
  const tables = [
    db.recipes,
    db.images,
    db.mealPlans,
    db.mealDays,
    db.settings,
    db.cookSessions,
    db.dayNotes,
    db.freeDishes,
    db.shoppingManualItems,
    db.shoppingChecks,
    db.shoppingPurchases,
    db.shoppingItemRules,
    db.shoppingQuantityCorrections,
    db.shoppingLists,
    db.shoppingDemandAllocations,
  ]
  await Promise.all(tables.map((table) => table.clear()))
}

function ingredient(overrides: Partial<Ingredient> = {}): Ingredient {
  return {
    id: 'i1',
    groupId: null,
    position: 0,
    raw: '8 Tomaten',
    name: 'Tomaten',
    quantity: 8,
    quantityText: '8',
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
    title: 'Tomatengericht',
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
    date: PERIOD,
    servings: 2,
    status: 'planned',
    auto: false,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }
}

async function seed(): Promise<void> {
  await db.recipes.put(recipe())
  await db.cookSessions.put(session())
}

async function setTomatoDemand(quantity: number): Promise<void> {
  await db.recipes.put(
    recipe({
      ingredients: [
        ingredient({
          quantity,
          quantityText: String(quantity),
          raw: `${quantity} Tomaten`,
        }),
      ],
    }),
  )
}

async function setHackfleischDemand(grams: number): Promise<void> {
  await db.recipes.put(
    recipe({
      ingredients: [
        ingredient({
          name: 'Hackfleisch (gemischt)',
          raw: `${grams} g Hackfleisch (gemischt)`,
          quantity: grams,
          quantityText: String(grams),
          unit: 'g',
        }),
      ],
    }),
  )
}

async function loadView(anchor = PERIOD) {
  const [
    settingsRows,
    lists,
    recipes,
    freeDishes,
    cookSessions,
    manualItems,
    purchases,
    rules,
    quantityCorrections,
    allocations,
  ] = await Promise.all([
    db.settings.toArray(),
    db.shoppingLists.toArray(),
    db.recipes.toArray(),
    db.freeDishes.toArray(),
    db.cookSessions.toArray(),
    db.shoppingManualItems.toArray(),
    db.shoppingPurchases.toArray(),
    db.shoppingItemRules.toArray(),
    db.shoppingQuantityCorrections.toArray(),
    db.shoppingDemandAllocations.toArray(),
  ])
  return buildShoppingPageView({
    anchor,
    today: anchor,
    settingsRows,
    lists,
    recipes,
    freeDishes,
    cookSessions,
    manualItems,
    purchases,
    rules,
    quantityCorrections,
    allocations,
  })
}

function rowsFor(
  view: Awaited<ReturnType<typeof loadView>>,
  listId: string,
): ShoppingPageRow[] {
  return view.rowsByList[listId] ?? []
}

function tomatoKey(): string {
  return shoppingItemKey('Tomaten')
}

function ingredientWithoutQuantity(name: string, position = 0): Ingredient {
  return ingredient({
    name,
    raw: name,
    quantity: null,
    quantityText: null,
    unit: null,
    position,
  })
}

function rowNamed(
  view: Awaited<ReturnType<typeof loadView>>,
  listId: string,
  name: string,
): ShoppingPageRow | undefined {
  return rowsFor(view, listId).find((row) => row.name === name)
}

async function buyQualitative(
  itemKey: string,
  listId: string,
  shoppingDate = PERIOD,
): Promise<void> {
  await addShoppingPurchase({
    shoppingDate,
    itemKey,
    listId,
    periodStart: PERIOD,
    amounts: [],
    snapshot: [],
    qualitative: true,
  })
}

async function buyQuantity(
  itemKey: string,
  listId: string,
  lower: number,
  upper: number,
  snapshot: ShoppingPageRow['requiredPositions'],
  dimension = 'count',
  shoppingDate = PERIOD,
): Promise<void> {
  await addShoppingPurchase({
    shoppingDate,
    itemKey,
    listId,
    periodStart: PERIOD,
    amounts: [{ dimension, lower, upper }],
    snapshot,
  })
}

beforeEach(async () => {
  await clearAll()
})

describe('shopping page view', () => {
  it('shows the standard list and every free list, including empty ones', async () => {
    await seed()
    const drogerie = await createFreeShoppingList({ name: 'Drogerie' })
    const markt = await createFreeShoppingList({ name: 'Markt' })

    const view = await loadView()

    expect(view.lists).toHaveLength(3)
    expect(view.lists[0]?.isStandard).toBe(true)
    expect(view.lists[0]?.name).toContain('Wocheneinkauf')
    expect(view.lists.map((list) => list.name)).toEqual(
      expect.arrayContaining(['Drogerie', 'Markt']),
    )
    expect(view.lists.find((list) => list.id === drogerie.id)).toMatchObject({
      openCount: 0,
      doneCount: 0,
      isStandard: false,
    })
    expect(view.lists.find((list) => list.id === markt.id)).toBeTruthy()
    expect(rowsFor(view, view.standardListId).some((row) => row.name === 'Tomaten')).toBe(
      true,
    )
  })

  it('hides staple ingredients from automatic demand only and keeps counters exact', async () => {
    const staples = [
      'Salz',
      'Pfeffer',
      'Wasser',
      'Olivenöl',
      'Zucker',
    ]
    const visible = ['Tomaten', 'Cayennepfeffer', 'Chiliöl', 'Sesamöl', 'Koriander gemahlen']
    await db.recipes.put(
      recipe({
        ingredients: [...staples, ...visible].map((name, position) =>
          ingredient({
            name,
            raw: `1 ${name}`,
            quantityText: '1',
            unit: 'Stück',
            position,
          }),
        ),
      }),
    )
    await db.cookSessions.put(session())
    const list = await createFreeShoppingList({ name: 'Gewürze' })
    await createManualListItem({
      listId: list.id,
      name: 'Salz',
      quantityText: '1',
      unit: 'Stück',
      shoppingDate: PERIOD,
    })

    const view = await loadView()
    const standardRows = rowsFor(view, view.standardListId)
    expect(standardRows.map((row) => row.name).sort()).toEqual([...visible].sort())
    expect(rowsFor(view, list.id).map((row) => row.name)).toEqual(['Salz'])
    expect(view.reviewRowsByList[view.standardListId] ?? []).toHaveLength(0)
    expect(view.serviceConflicts).toHaveLength(0)
    expect(view.requiresReview).toBe(false)
    expect(view.lists.find((entry) => entry.id === view.standardListId)).toMatchObject({
      openCount: visible.length,
      doneCount: 0,
      reviewCount: 0,
      requiresReview: false,
    })
    expect(view.lists.find((entry) => entry.id === list.id)).toMatchObject({
      openCount: 1,
      doneCount: 0,
      reviewCount: 0,
      requiresReview: false,
    })
  })

  it('hides descriptive staple variants but keeps flavoured oils and preserves', async () => {
    await db.recipes.put(
      recipe({
        ingredients: [
          ingredient({
            name: 'Olivenöl (nach Bedarf)',
            raw: '1 EL Olivenöl (nach Bedarf)',
            quantity: 1,
            quantityText: '1',
            unit: 'EL',
            position: 0,
          }),
          ingredient({
            name: 'Öl (neutral)',
            raw: '1 EL Öl (neutral)',
            quantity: 1,
            quantityText: '1',
            unit: 'EL',
            position: 1,
          }),
          ingredient({
            name: 'Pfeffer, frisch gemahlen',
            raw: '1 Prise Pfeffer, frisch gemahlen',
            quantity: 1,
            quantityText: '1',
            unit: 'Prise',
            position: 2,
          }),
          ingredient({
            name: 'Wasser, kochend heiß',
            raw: '450 ml Wasser, kochend heiß',
            quantity: 450,
            quantityText: '450',
            unit: 'ml',
            position: 3,
          }),
          ingredient({
            name: 'Chiliöl',
            raw: '1 TL Chiliöl',
            quantity: 1,
            quantityText: '1',
            unit: 'TL',
            position: 4,
          }),
          ingredient({
            name: 'Sesamöl',
            raw: '1 TL Sesamöl',
            quantity: 1,
            quantityText: '1',
            unit: 'TL',
            position: 5,
          }),
          ingredient({
            name: 'Mangos',
            raw: '1 Mango(s), frische',
            quantity: 1,
            quantityText: '1',
            unit: null,
            position: 6,
          }),
          ingredient({
            name: 'Mangos, in Spalten, in Flüssigkeit',
            raw: '1 Dose Mango(s), in Spalten, in Flüssigkeit',
            quantity: 1,
            quantityText: '1',
            unit: 'Dose',
            position: 7,
          }),
        ],
      }),
    )
    await db.cookSessions.put(session())
    const list = await createFreeShoppingList({ name: 'Vorrat' })
    await createManualListItem({
      listId: list.id,
      name: 'Olivenöl',
      quantityText: '1',
      unit: 'Flasche',
      shoppingDate: PERIOD,
    })

    const view = await loadView()
    const standardRows = rowsFor(view, view.standardListId)
    const standardNames = standardRows.map((row) => row.name)
    expect(standardNames).not.toContain('Olivenöl')
    expect(standardNames).not.toContain('Öl')
    expect(standardNames).not.toContain('Pfeffer')
    expect(standardNames).not.toContain('Wasser')
    expect(standardNames).toContain('Chiliöl')
    expect(standardNames).toContain('Sesamöl')
    expect(standardRows.filter((row) => row.name === 'Mangos')).toHaveLength(2)
    expect(
      standardRows
        .filter((row) => row.name === 'Mangos')
        .map((row) => row.categoryId)
        .sort(),
    ).toEqual(['canned', 'produce'])
    expect(rowsFor(view, list.id).map((row) => row.name)).toEqual(['Olivenöl'])
    expect(view.reviewRowsByList[view.standardListId] ?? []).toHaveLength(0)
    expect(view.serviceConflicts).toHaveLength(0)
    expect(view.requiresReview).toBe(false)
    expect(view.lists.find((entry) => entry.id === view.standardListId)).toMatchObject({
      openCount: 4,
      doneCount: 0,
      reviewCount: 0,
    })
  })

  it('creates, renames and deletes a free list with explicit confirmation', async () => {
    const list = await createFreeShoppingList({ name: 'Drogerie' })
    await renameShoppingList(list.id, 'Drogerie & Bad')
    await createManualListItem({
      listId: list.id,
      name: 'Zahnpasta',
      quantityText: '1',
      unit: 'Stück',
      shoppingDate: PERIOD,
    })

    let view = await loadView()
    expect(view.lists.find((entry) => entry.id === list.id)?.name).toBe('Drogerie & Bad')
    expect(rowsFor(view, list.id).map((row) => row.name)).toContain('Zahnpasta')

    await expect(deleteFreeShoppingList(list.id)).rejects.toMatchObject({
      code: 'confirmation-required',
    })
    view = await loadView()
    expect(view.lists.some((entry) => entry.id === list.id)).toBe(true)
    expect(rowsFor(view, list.id).map((row) => row.name)).toContain('Zahnpasta')

    const result = await deleteFreeShoppingList(list.id, { confirmManualItems: true })
    expect(result.removedManualItems).toBe(1)
    view = await loadView()
    expect(view.lists.some((entry) => entry.id === list.id)).toBe(false)
  })

  it('creates, edits and deletes manual articles through the existing services', async () => {
    const list = await createFreeShoppingList({ name: 'Drogerie' })
    const item = await createManualListItem({
      listId: list.id,
      name: 'Milch',
      quantityText: '2',
      unit: 'Stück',
      categoryId: 'dairy',
      shoppingDate: PERIOD,
    })

    let view = await loadView()
    let row = rowsFor(view, list.id).find((entry) => entry.name === 'Milch')
    expect(row).toBeTruthy()
    expect(row?.openPositions[0]).toMatchObject({ dimension: 'count', lower: 2, upper: 2 })
    expect(row?.categoryId).toBe('dairy')

    await updateManualListItem(item.id, {
      name: 'Hafermilch',
      quantityText: '3',
      unit: 'Stück',
    })
    view = await loadView()
    row = rowsFor(view, list.id).find((entry) => entry.name === 'Hafermilch')
    expect(row?.openPositions[0]).toMatchObject({ lower: 3, upper: 3 })
    expect(rowsFor(view, list.id).some((entry) => entry.name === 'Milch')).toBe(false)

    await removeManualListItem(item.id)
    view = await loadView()
    expect(rowsFor(view, list.id).some((entry) => entry.name === 'Hafermilch')).toBe(false)
  })

  it('checks and reopens manual and automatic articles', async () => {
    await seed()
    const list = await createFreeShoppingList({ name: 'Drogerie' })
    const manual = await createManualListItem({
      listId: list.id,
      name: 'Zahnpasta',
      quantityText: '1',
      unit: 'Stück',
      shoppingDate: PERIOD,
    })

    await setManualItemPurchased(manual.id, true)
    let view = await loadView()
    let manualRow = rowsFor(view, list.id).find((row) => row.name === 'Zahnpasta')
    expect(manualRow?.status).toBe('done')
    expect(manualRow?.purchasedPositions[0]).toMatchObject({ lower: 1, upper: 1 })

    await setManualItemPurchased(manual.id, false)
    view = await loadView()
    manualRow = rowsFor(view, list.id).find((row) => row.name === 'Zahnpasta')
    expect(manualRow?.status).toBe('open')

    view = await loadView()
    let automatic = rowsFor(view, view.standardListId).find((row) => row.name === 'Tomaten')
    expect(automatic?.openPositions[0]).toMatchObject({ lower: 8, upper: 8 })
    await addShoppingPurchase({
      shoppingDate: PERIOD,
      itemKey: tomatoKey(),
      listId: view.standardListId,
      amounts: [{ dimension: 'count', lower: 8, upper: 8 }],
      snapshot: automatic?.requiredPositions ?? [],
    })
    view = await loadView()
    automatic = rowsFor(view, view.standardListId).find((row) => row.name === 'Tomaten')
    expect(automatic?.status).toBe('done')
    expect(automatic?.purchaseIds).toHaveLength(1)

    await removeShoppingPurchase(automatic!.purchaseIds[0]!)
    view = await loadView()
    automatic = rowsFor(view, view.standardListId).find((row) => row.name === 'Tomaten')
    expect(automatic?.status).toBe('open')
  })

  it('checks and reopens an automatic ingredient without a quantity', async () => {
    await db.recipes.put(
      recipe({
        ingredients: [
          ingredient({
            name: 'Mozzarella',
            raw: 'Mozzarella',
            quantity: null,
            quantityText: '',
            unit: null,
          }),
        ],
      }),
    )
    await db.cookSessions.put(session())
    const key = shoppingItemKey('Mozzarella')

    let view = await loadView()
    let row = rowsFor(view, view.standardListId).find((entry) => entry.name === 'Mozzarella')
    expect(row).toMatchObject({
      status: 'open',
      missingQuantity: true,
      requiredPositions: [],
      openPositions: [],
    })

    await addShoppingPurchase({
      shoppingDate: PERIOD,
      itemKey: key,
      listId: view.standardListId,
      amounts: [],
      snapshot: [],
      qualitative: true,
    })

    view = await loadView()
    row = rowsFor(view, view.standardListId).find((entry) => entry.name === 'Mozzarella')
    expect(row?.status).toBe('done')
    expect(row?.purchaseIds).toHaveLength(1)
    expect(view.serviceConflicts).toHaveLength(0)
    expect(view.reviewRowsByList[view.standardListId] ?? []).toHaveLength(0)
    expect(view.requiresReview).toBe(false)
    expect(
      view.lists.find((entry) => entry.id === view.standardListId),
    ).toMatchObject({ openCount: 0, doneCount: 1, reviewCount: 0 })

    await removeShoppingPurchase(row!.purchaseIds[0]!)
    view = await loadView()
    row = rowsFor(view, view.standardListId).find((entry) => entry.name === 'Mozzarella')
    expect(row?.status).toBe('open')
    expect(view.serviceConflicts).toHaveLength(0)
    expect(view.requiresReview).toBe(false)
  })

  it('checks an ingredient with a verbal quantity without a review warning', async () => {
    await db.recipes.put(
      recipe({
        ingredients: [
          ingredient({
            name: 'Kapern',
            raw: 'etwas Kapern',
            quantity: null,
            quantityText: 'etwas',
            unit: null,
          }),
        ],
      }),
    )
    await db.cookSessions.put(session())

    let view = await loadView()
    const listId = view.standardListId
    expect(rowNamed(view, listId, 'Kapern')).toMatchObject({
      status: 'open',
      unparsedAmounts: ['etwas'],
      missingQuantity: false,
    })

    await buyQualitative(shoppingItemKey('Kapern'), listId)
    view = await loadView()
    expect(rowNamed(view, listId, 'Kapern')?.status).toBe('done')
    expect(view.serviceConflicts).toHaveLength(0)
    expect(view.reviewRowsByList[listId] ?? []).toHaveLength(0)
    expect(view.requiresReview).toBe(false)
  })

  it('checks several ingredients without quantities independently', async () => {
    await db.recipes.put(
      recipe({
        ingredients: [
          ingredientWithoutQuantity('Mozzarella', 0),
          ingredientWithoutQuantity('Basilikum', 1),
          ingredientWithoutQuantity('Kapern', 2),
        ],
      }),
    )
    await db.cookSessions.put(session())

    let view = await loadView()
    const listId = view.standardListId
    expect(rowsFor(view, listId).map((row) => row.name).sort()).toEqual([
      'Basilikum',
      'Kapern',
      'Mozzarella',
    ])
    for (const row of rowsFor(view, listId)) {
      expect(row).toMatchObject({
        status: 'open',
        missingQuantity: true,
        requiredPositions: [],
        openPositions: [],
      })
    }

    await buyQualitative(shoppingItemKey('Mozzarella'), listId)
    view = await loadView()
    expect(rowNamed(view, listId, 'Mozzarella')?.status).toBe('done')
    expect(rowNamed(view, listId, 'Basilikum')?.status).toBe('open')
    expect(rowNamed(view, listId, 'Kapern')?.status).toBe('open')
    expect(view.serviceConflicts).toHaveLength(0)
    expect(view.reviewRowsByList[listId] ?? []).toHaveLength(0)
    expect(view.requiresReview).toBe(false)

    await buyQualitative(shoppingItemKey('Basilikum'), listId)
    view = await loadView()
    expect(rowNamed(view, listId, 'Mozzarella')?.status).toBe('done')
    expect(rowNamed(view, listId, 'Basilikum')?.status).toBe('done')
    expect(rowNamed(view, listId, 'Kapern')?.status).toBe('open')
    expect(view.requiresReview).toBe(false)

    const mozzarella = rowNamed(view, listId, 'Mozzarella')
    await removeShoppingPurchase(mozzarella!.purchaseIds[0]!)
    view = await loadView()
    expect(rowNamed(view, listId, 'Mozzarella')?.status).toBe('open')
    expect(rowNamed(view, listId, 'Basilikum')?.status).toBe('done')
    expect(view.serviceConflicts).toHaveLength(0)
  })

  it('keeps quantity-bearing demand unchanged when a quantity-less ingredient is checked', async () => {
    await db.recipes.put(
      recipe({
        ingredients: [
          ingredient({
            name: 'Tomaten',
            raw: '2 Tomaten',
            quantity: 2,
            quantityText: '2',
            unit: 'Stück',
            position: 0,
          }),
          ingredientWithoutQuantity('Mozzarella', 1),
        ],
      }),
    )
    await db.cookSessions.put(session())

    let view = await loadView()
    const listId = view.standardListId
    const tomatoes = rowNamed(view, listId, 'Tomaten')
    expect(tomatoes?.openPositions[0]).toMatchObject({ lower: 2, upper: 2 })
    expect(rowNamed(view, listId, 'Mozzarella')?.missingQuantity).toBe(true)

    await buyQualitative(shoppingItemKey('Mozzarella'), listId)
    view = await loadView()
    expect(rowNamed(view, listId, 'Mozzarella')?.status).toBe('done')
    expect(rowNamed(view, listId, 'Tomaten')?.status).toBe('open')
    expect(rowNamed(view, listId, 'Tomaten')?.openPositions[0]).toMatchObject({
      lower: 2,
      upper: 2,
    })
    expect(view.serviceConflicts).toHaveLength(0)

    await buyQuantity(
      tomatoKey(),
      listId,
      2,
      2,
      rowNamed(view, listId, 'Tomaten')?.requiredPositions ?? [],
    )
    view = await loadView()
    expect(rowNamed(view, listId, 'Tomaten')?.status).toBe('done')
    expect(rowNamed(view, listId, 'Mozzarella')?.status).toBe('done')
    expect(view.reviewRowsByList[listId] ?? []).toHaveLength(0)
    expect(view.requiresReview).toBe(false)
  })

  it('merges the same ingredient from several recipes into one demand', async () => {
    await db.recipes.bulkPut([
      recipe({
        id: 'r1',
        title: 'Tomaten A',
        ingredients: [
          ingredient({ name: 'Tomaten', raw: '3 Tomaten', quantity: 3, quantityText: '3', unit: 'Stück' }),
        ],
      }),
      recipe({
        id: 'r2',
        importId: 'mela-r2',
        title: 'Tomaten B',
        ingredients: [
          ingredient({ name: 'Tomaten', raw: '5 Tomaten', quantity: 5, quantityText: '5', unit: 'Stück' }),
        ],
      }),
    ])
    await db.cookSessions.bulkPut([
      session({ id: 's1', recipeId: 'r1', date: PERIOD }),
      session({ id: 's2', recipeId: 'r2', date: '2026-11-06' }),
    ])

    let view = await loadView()
    const listId = view.standardListId
    expect(rowsFor(view, listId).filter((row) => row.name === 'Tomaten')).toHaveLength(1)
    const tomatoes = rowNamed(view, listId, 'Tomaten')
    expect(tomatoes?.requiredPositions).toHaveLength(1)
    expect(tomatoes?.requiredPositions[0]).toMatchObject({ lower: 8, upper: 8 })
    expect(tomatoes?.openPositions[0]).toMatchObject({ lower: 8, upper: 8 })
    expect(view.serviceConflicts).toHaveLength(0)

    await buyQuantity(tomatoKey(), listId, 8, 8, tomatoes?.requiredPositions ?? [])
    view = await loadView()
    expect(rowNamed(view, listId, 'Tomaten')?.status).toBe('done')
    expect(view.requiresReview).toBe(false)
  })

  it('combines a quantified and a quantity-less contribution of the same ingredient', async () => {
    await db.recipes.bulkPut([
      recipe({
        id: 'r1',
        title: 'Tomaten A',
        ingredients: [
          ingredient({ name: 'Tomaten', raw: '2 Tomaten', quantity: 2, quantityText: '2', unit: 'Stück' }),
        ],
      }),
      recipe({
        id: 'r2',
        importId: 'mela-r2',
        title: 'Tomaten B',
        ingredients: [ingredientWithoutQuantity('Tomaten')],
      }),
    ])
    await db.cookSessions.bulkPut([
      session({ id: 's1', recipeId: 'r1', date: PERIOD }),
      session({ id: 's2', recipeId: 'r2', date: '2026-11-06' }),
    ])

    let view = await loadView()
    const listId = view.standardListId
    const tomatoes = rowNamed(view, listId, 'Tomaten')
    expect(tomatoes?.requiredPositions[0]).toMatchObject({ lower: 2, upper: 2 })
    expect(tomatoes?.missingQuantity).toBe(true)
    expect(tomatoes?.unparsedAmounts).toEqual([])
    expect(view.requiresReview).toBe(false)

    await buyQuantity(tomatoKey(), listId, 2, 2, tomatoes?.requiredPositions ?? [])
    view = await loadView()
    expect(rowNamed(view, listId, 'Tomaten')?.status).toBe('done')
    expect(view.serviceConflicts).toHaveLength(0)
  })

  it('keeps a quantity-less ingredient checked on its free list', async () => {
    await db.recipes.put(
      recipe({ ingredients: [ingredientWithoutQuantity('Mozzarella')] }),
    )
    await db.cookSessions.put(session())
    const market = await createFreeShoppingList({ name: 'Markt' })
    const key = shoppingItemKey('Mozzarella')
    await moveShoppingItem({ periodStart: PERIOD, itemKey: key, targetListId: market.id })

    let view = await loadView()
    expect(rowNamed(view, view.standardListId, 'Mozzarella')).toBeUndefined()
    const marketRow = rowNamed(view, market.id, 'Mozzarella')
    expect(marketRow).toMatchObject({ status: 'open', missingQuantity: true })

    await buyQualitative(key, market.id)
    view = await loadView()
    expect(rowNamed(view, market.id, 'Mozzarella')?.status).toBe('done')
    expect(rowNamed(view, view.standardListId, 'Mozzarella')).toBeUndefined()
    expect(view.serviceConflicts).toHaveLength(0)
    expect(view.reviewRowsByList[market.id] ?? []).toHaveLength(0)
    expect(view.requiresReview).toBe(false)

    const done = rowNamed(view, market.id, 'Mozzarella')
    await removeShoppingPurchase(done!.purchaseIds[0]!)
    view = await loadView()
    expect(rowNamed(view, market.id, 'Mozzarella')?.status).toBe('open')
  })

  it('attributes a purchase to the only list that still needs the item', async () => {
    await db.recipes.put(
      recipe({ ingredients: [ingredientWithoutQuantity('Mozzarella')] }),
    )
    await db.cookSessions.put(session())
    const market = await createFreeShoppingList({ name: 'Markt' })
    const key = shoppingItemKey('Mozzarella')
    await moveShoppingItem({ periodStart: PERIOD, itemKey: key, targetListId: market.id })

    let view = await loadView()
    // The purchase was recorded before the item was moved and still carries
    // the old list reference. There is only one possible target list, so it
    // must count there without a review conflict.
    await buyQualitative(key, view.standardListId)
    view = await loadView()
    expect(rowNamed(view, market.id, 'Mozzarella')?.status).toBe('done')
    expect(rowNamed(view, view.standardListId, 'Mozzarella')).toBeUndefined()
    expect(view.serviceConflicts).toHaveLength(0)
    expect(view.reviewRowsByList[market.id] ?? []).toHaveLength(0)
    expect(view.requiresReview).toBe(false)
  })

  it('keeps a purchase in review when several lists need the same item', async () => {
    await seed()
    const market = await createFreeShoppingList({ name: 'Markt' })
    const organic = await createFreeShoppingList({ name: 'Bioladen' })
    const third = await createFreeShoppingList({ name: 'Dritte Liste' })
    await assignShoppingSubquantity({
      periodStart: PERIOD,
      itemKey: tomatoKey(),
      dimension: 'count',
      targetListId: market.id,
      quantity: 4,
    })
    await assignShoppingSubquantity({
      periodStart: PERIOD,
      itemKey: tomatoKey(),
      dimension: 'count',
      targetListId: organic.id,
      quantity: 4,
    })
    await buyQuantity(tomatoKey(), third.id, 4, 4, [])

    const view = await loadView()
    expect(view.serviceConflicts.filter((entry) => entry.code === 'unmatched-purchase')).toHaveLength(1)
    expect(view.reviewRowsByList[third.id]?.[0]?.purchaseIds).toHaveLength(1)
    expect(view.requiresReview).toBe(true)
    expect(rowNamed(view, market.id, 'Tomaten')?.openPositions[0]).toMatchObject({
      lower: 4,
      upper: 4,
    })
    expect(rowNamed(view, organic.id, 'Tomaten')?.openPositions[0]).toMatchObject({
      lower: 4,
      upper: 4,
    })
    expect(view.reviewRowsByList[market.id] ?? []).toHaveLength(0)
  })

  it('does not carry a quantity-less purchase into another shopping period', async () => {
    await db.recipes.put(
      recipe({ ingredients: [ingredientWithoutQuantity('Mozzarella')] }),
    )
    await db.cookSessions.put(session())
    const key = shoppingItemKey('Mozzarella')

    let current = await loadView(PERIOD)
    await buyQualitative(key, current.standardListId)
    current = await loadView(PERIOD)
    expect(rowNamed(current, current.standardListId, 'Mozzarella')?.status).toBe('done')

    const next = await loadView(NEXT_PERIOD)
    expect(rowNamed(next, next.standardListId, 'Mozzarella')).toBeUndefined()
    expect(next.serviceConflicts).toHaveLength(0)
    expect(next.requiresReview).toBe(false)

    current = await loadView(PERIOD)
    expect(rowNamed(current, current.standardListId, 'Mozzarella')?.status).toBe('done')
  })

  it('keeps a numeric purchase valid when the recipe loses its quantity', async () => {
    await db.recipes.put(
      recipe({
        ingredients: [
          ingredient({ name: 'Tomaten', raw: '8 Tomaten', quantity: 8, quantityText: '8', unit: 'Stück' }),
        ],
      }),
    )
    await db.cookSessions.put(session())

    let view = await loadView()
    const listId = view.standardListId
    const tomatoes = rowNamed(view, listId, 'Tomaten')
    await buyQuantity(tomatoKey(), listId, 8, 8, tomatoes?.requiredPositions ?? [])
    view = await loadView()
    expect(rowNamed(view, listId, 'Tomaten')?.status).toBe('done')

    await db.recipes.put(
      recipe({ ingredients: [ingredientWithoutQuantity('Tomaten')] }),
    )
    view = await loadView()
    expect(rowNamed(view, listId, 'Tomaten')).toMatchObject({
      status: 'done',
      missingQuantity: true,
      requiredPositions: [],
    })
    expect(view.serviceConflicts).toHaveLength(0)
    expect(view.reviewRowsByList[listId] ?? []).toHaveLength(0)
    expect(view.requiresReview).toBe(false)
  })

  it('does not report a qualitative purchase as orphaned when a quantity is added', async () => {
    await db.recipes.put(
      recipe({ ingredients: [ingredientWithoutQuantity('Tomaten')] }),
    )
    await db.cookSessions.put(session())

    let view = await loadView()
    const listId = view.standardListId
    await buyQualitative(tomatoKey(), listId)
    view = await loadView()
    expect(rowNamed(view, listId, 'Tomaten')?.status).toBe('done')

    await db.recipes.put(
      recipe({
        ingredients: [
          ingredient({ name: 'Tomaten', raw: '8 Tomaten', quantity: 8, quantityText: '8', unit: 'Stück' }),
        ],
      }),
    )
    view = await loadView()
    expect(rowNamed(view, listId, 'Tomaten')?.status).toBe('open')
    expect(rowNamed(view, listId, 'Tomaten')?.openPositions[0]).toMatchObject({
      lower: 8,
      upper: 8,
    })
    expect(view.serviceConflicts).toHaveLength(0)
    expect(view.reviewRowsByList[listId] ?? []).toHaveLength(0)
    expect(view.requiresReview).toBe(false)
  })

  it('keeps an existing purchase when only the demand quantity changes', async () => {
    await db.recipes.put(
      recipe({
        ingredients: [
          ingredient({ name: 'Tomaten', raw: '4 Tomaten', quantity: 4, quantityText: '4', unit: 'Stück' }),
        ],
      }),
    )
    await db.cookSessions.put(session())

    let view = await loadView()
    const listId = view.standardListId
    const tomatoes = rowNamed(view, listId, 'Tomaten')
    await buyQuantity(tomatoKey(), listId, 4, 4, tomatoes?.requiredPositions ?? [])
    view = await loadView()
    expect(rowNamed(view, listId, 'Tomaten')?.status).toBe('done')

    await db.recipes.put(
      recipe({
        ingredients: [
          ingredient({ name: 'Tomaten', raw: '6 Tomaten', quantity: 6, quantityText: '6', unit: 'Stück' }),
        ],
      }),
    )
    view = await loadView()
    const updated = rowNamed(view, listId, 'Tomaten')
    expect(updated?.status).toBe('open')
    expect(updated?.openPositions[0]).toMatchObject({ lower: 2, upper: 2 })
    expect(updated?.purchaseIds).toHaveLength(1)
    expect(view.serviceConflicts).toHaveLength(0)
    expect(view.requiresReview).toBe(false)
  })

  it('checks and reopens a manual article without a quantity', async () => {
    const list = await createFreeShoppingList({ name: 'Drogerie' })
    const item = await createManualListItem({
      listId: list.id,
      name: 'Spülmittel',
      quantityText: null,
      unit: null,
      shoppingDate: PERIOD,
    })

    let view = await loadView()
    expect(rowNamed(view, list.id, 'Spülmittel')).toMatchObject({
      status: 'open',
      missingQuantity: true,
    })

    await setManualItemPurchased(item.id, true)
    view = await loadView()
    expect(rowNamed(view, list.id, 'Spülmittel')?.status).toBe('done')
    expect(view.serviceConflicts).toHaveLength(0)

    await setManualItemPurchased(item.id, false)
    view = await loadView()
    expect(rowNamed(view, list.id, 'Spülmittel')?.status).toBe('open')
    expect(view.serviceConflicts).toHaveLength(0)
    expect(view.requiresReview).toBe(false)
  })

  it('keeps a bought manual article checked when its quantity is removed', async () => {
    const list = await createFreeShoppingList({ name: 'Drogerie' })
    const item = await createManualListItem({
      listId: list.id,
      name: 'Zahnpasta',
      quantityText: '1',
      unit: 'Stück',
      shoppingDate: PERIOD,
    })
    await setManualItemPurchased(item.id, true)
    let view = await loadView()
    expect(rowNamed(view, list.id, 'Zahnpasta')?.status).toBe('done')

    await updateManualListItem(item.id, { quantityText: null, unit: null })
    view = await loadView()
    expect(rowNamed(view, list.id, 'Zahnpasta')).toMatchObject({
      status: 'done',
      missingQuantity: true,
    })
    expect(view.serviceConflicts).toHaveLength(0)
    expect(view.requiresReview).toBe(false)

    await setManualItemPurchased(item.id, false)
    view = await loadView()
    expect(rowNamed(view, list.id, 'Zahnpasta')?.status).toBe('open')

    await setManualItemPurchased(item.id, true)
    view = await loadView()
    expect(rowNamed(view, list.id, 'Zahnpasta')?.status).toBe('done')
  })

  it('checks a manual article after its quantity is added', async () => {
    const list = await createFreeShoppingList({ name: 'Drogerie' })
    const item = await createManualListItem({
      listId: list.id,
      name: 'Zahnpasta',
      quantityText: null,
      unit: null,
      shoppingDate: PERIOD,
    })
    await setManualItemPurchased(item.id, true)
    let view = await loadView()
    expect(rowNamed(view, list.id, 'Zahnpasta')?.status).toBe('done')

    await updateManualListItem(item.id, { quantityText: '1', unit: 'Stück' })
    view = await loadView()
    expect(rowNamed(view, list.id, 'Zahnpasta')?.status).toBe('open')
    expect(rowNamed(view, list.id, 'Zahnpasta')?.openPositions[0]).toMatchObject({
      lower: 1,
      upper: 1,
    })

    await setManualItemPurchased(item.id, true)
    view = await loadView()
    expect(rowNamed(view, list.id, 'Zahnpasta')?.status).toBe('done')
    expect(
      await db.shoppingPurchases.where('manualItemId').equals(item.id).count(),
    ).toBe(2)
    expect(view.serviceConflicts).toHaveLength(0)
    expect(view.requiresReview).toBe(false)
  })

  it('keeps a checked article checked when its distribution is reset', async () => {
    await seed()
    const market = await createFreeShoppingList({ name: 'Markt' })
    await moveShoppingItem({
      periodStart: PERIOD,
      itemKey: tomatoKey(),
      targetListId: market.id,
    })

    let view = await loadView()
    const marketRow = rowNamed(view, market.id, 'Tomaten')
    expect(marketRow?.status).toBe('open')
    await buyQuantity(
      tomatoKey(),
      market.id,
      8,
      8,
      marketRow?.requiredPositions ?? [],
    )
    view = await loadView()
    expect(rowNamed(view, market.id, 'Tomaten')?.status).toBe('done')

    await resetShoppingAllocations({ periodStart: PERIOD, itemKey: tomatoKey() })

    view = await loadView()
    expect(rowNamed(view, view.standardListId, 'Tomaten')?.status).toBe('done')
    expect(rowNamed(view, market.id, 'Tomaten')).toBeUndefined()
    expect(view.serviceConflicts).toHaveLength(0)
    expect(view.reviewRowsByList[market.id] ?? []).toHaveLength(0)
    expect(view.requiresReview).toBe(false)
  })

  it('keeps a checked share counted when its last allocation is removed', async () => {
    await seed()
    const market = await createFreeShoppingList({ name: 'Markt' })
    await assignShoppingSubquantity({
      periodStart: PERIOD,
      itemKey: tomatoKey(),
      dimension: 'count',
      targetListId: market.id,
      quantity: 5,
    })

    let view = await loadView()
    const marketRow = rowNamed(view, market.id, 'Tomaten')
    expect(marketRow?.openPositions[0]).toMatchObject({ lower: 5, upper: 5 })
    await buyQuantity(tomatoKey(), market.id, 5, 5, marketRow?.requiredPositions ?? [])
    view = await loadView()
    expect(rowNamed(view, market.id, 'Tomaten')?.status).toBe('done')

    const allocation = view.distribution?.positions
      .find((position) => position.itemKey === tomatoKey())
      ?.allocations.find(
        (entry) =>
          entry.allocation.listId === market.id && entry.allocation.mode === 'partial',
      )?.allocation
    expect(allocation).toBeTruthy()
    await removeShoppingAllocation(allocation!.id)

    view = await loadView()
    expect(rowNamed(view, market.id, 'Tomaten')).toBeUndefined()
    const standardRow = rowNamed(view, view.standardListId, 'Tomaten')
    expect(standardRow?.status).toBe('open')
    expect(standardRow?.purchasedPositions[0]).toMatchObject({ lower: 5, upper: 5 })
    expect(standardRow?.openPositions[0]).toMatchObject({ lower: 3, upper: 3 })
    expect(view.serviceConflicts).toHaveLength(0)
    expect(view.reviewRowsByList[market.id] ?? []).toHaveLength(0)
    expect(view.requiresReview).toBe(false)
  })

  it('keeps purchase status on the list where it was recorded', async () => {
    await seed()
    const markt = await createFreeShoppingList({ name: 'Markt' })
    await assignShoppingSubquantity({
      periodStart: PERIOD,
      itemKey: tomatoKey(),
      dimension: 'count',
      targetListId: markt.id,
      quantity: 5,
    })
    await addShoppingPurchase({
      shoppingDate: PERIOD,
      itemKey: tomatoKey(),
      listId: markt.id,
      amounts: [{ dimension: 'count', lower: 2, upper: 2 }],
      snapshot: [{ dimension: 'count', lower: 5, upper: 5, unit: 'Stück', qualifier: '' }],
    })

    const view = await loadView()
    const marketRow = rowsFor(view, markt.id).find((row) => row.name === 'Tomaten')
    const standardRow = rowsFor(view, view.standardListId).find(
      (row) => row.name === 'Tomaten',
    )
    expect(marketRow).toMatchObject({ status: 'open' })
    expect(marketRow?.openPositions[0]).toMatchObject({ lower: 3, upper: 3 })
    expect(marketRow?.purchasedPositions[0]).toMatchObject({ lower: 2, upper: 2 })
    expect(standardRow?.openPositions[0]).toMatchObject({ lower: 3, upper: 3 })
    expect(standardRow?.purchasedPositions).toHaveLength(0)

    // Rebuilding the view (the UI list switch) does not move the purchase.
    const again = await loadView()
    expect(
      rowsFor(again, markt.id)
        .find((row) => row.name === 'Tomaten')
        ?.purchasedPositions[0],
    ).toMatchObject({ lower: 2, upper: 2 })
  })

  it('keeps free lists and their status when the shopping week changes', async () => {
    const list = await createFreeShoppingList({ name: 'Drogerie' })
    const manual = await createManualListItem({
      listId: list.id,
      name: 'Zahnpasta',
      quantityText: '1',
      unit: 'Stück',
      shoppingDate: PERIOD,
    })
    await setManualItemPurchased(manual.id, true)

    const current = await loadView(PERIOD)
    const next = await loadView(NEXT_PERIOD)

    expect(current.period.start).not.toBe(next.period.start)
    for (const view of [current, next]) {
      expect(view.lists.some((entry) => entry.id === list.id)).toBe(true)
      const row = rowsFor(view, list.id).find((entry) => entry.name === 'Zahnpasta')
      expect(row?.status).toBe('done')
    }
  })

  it('shows automatic ingredients only on the list they are assigned to', async () => {
    await seed()
    const markt = await createFreeShoppingList({ name: 'Markt' })
    await assignShoppingSubquantity({
      periodStart: PERIOD,
      itemKey: tomatoKey(),
      dimension: 'count',
      targetListId: markt.id,
      quantity: 5,
    })

    let view = await loadView()
    const marketRow = rowsFor(view, markt.id).find((row) => row.name === 'Tomaten')
    const standardRow = rowsFor(view, view.standardListId).find(
      (row) => row.name === 'Tomaten',
    )
    expect(marketRow?.openPositions[0]).toMatchObject({ lower: 5, upper: 5 })
    expect(standardRow?.openPositions[0]).toMatchObject({ lower: 3, upper: 3 })

    await moveShoppingItem({
      periodStart: PERIOD,
      itemKey: tomatoKey(),
      targetListId: markt.id,
    })
    view = await loadView()
    expect(
      rowsFor(view, markt.id).find((row) => row.name === 'Tomaten')?.openPositions[0],
    ).toMatchObject({ lower: 8, upper: 8 })
    expect(
      rowsFor(view, view.standardListId).some((row) => row.name === 'Tomaten'),
    ).toBe(false)
  })

  it('uses the configured shopping weekday instead of a hard-coded day', async () => {
    await seed()
    await db.settings.bulkPut([
      { key: 'shoppingPeriodStartDay', value: 0 },
      { key: 'standardShoppingListName', value: 'Wochenmarkt' },
    ])

    const monday = await loadView('2026-11-04')
    expect(monday.period.start).toBe('2026-11-02')
    expect(monday.lists[0]?.name).toContain('Wochenmarkt')

    await db.settings.put({ key: 'shoppingPeriodStartDay', value: 6 })
    const sunday = await loadView('2026-11-04')
    expect(sunday.period.start).toBe('2026-11-01')
    expect(sunday.period.start).not.toBe(monday.period.start)
  })

  it('preserves existing data and individual free-list names during article edits', async () => {
    await seed()
    const list = await createFreeShoppingList({ name: 'Drogerie' })
    const manual = await createManualListItem({
      listId: list.id,
      name: 'Zahnpasta',
      quantityText: '1',
      unit: 'Stück',
      shoppingDate: PERIOD,
    })
    const standard = await ensureStandardShoppingList(PERIOD)
    await saveItemRule(tomatoKey(), {
      displayName: 'Tomaten',
      categoryId: 'produce',
    })
    await saveCategoryOrder([
      'produce',
      'dairy',
      'meat',
      'bakery',
      'grains',
      'canned',
      'spices',
      'frozen',
      'drinks',
      'household',
      'other',
    ])
    await updateManualListItem(manual.id, { purchaseNote: 'bitte sensitiv' })

    const view = await loadView()
    expect(view.lists.find((entry) => entry.id === list.id)?.name).toBe('Drogerie')
    expect(view.lists.find((entry) => entry.id === standard.id)?.name).toContain(
      'Wocheneinkauf',
    )
    expect(
      rowsFor(view, view.standardListId).find((entry) => entry.name === 'Tomaten'),
    ).toBeTruthy()
    expect(
      rowsFor(view, list.id).find((entry) => entry.name === 'Zahnpasta')?.notes,
    ).toContain('bitte sensitiv')
  })

  it('does not report success when a protected or unconfirmed operation fails', async () => {
    await seed()
    const standard = await ensureStandardShoppingList(PERIOD)
    const before = await loadView()

    await expect(renameShoppingList(standard.id, 'Neu')).rejects.toBeInstanceOf(
      ShoppingListError,
    )
    await expect(renameShoppingList(standard.id, 'Neu')).rejects.toMatchObject({
      code: 'standard-list-protected',
    })
    await expect(deleteFreeShoppingList(standard.id)).rejects.toMatchObject({
      code: 'standard-list-protected',
    })

    const list = await createFreeShoppingList({ name: 'Drogerie' })
    await createManualListItem({
      listId: list.id,
      name: 'Zahnpasta',
      quantityText: '1',
      unit: 'Stück',
      shoppingDate: PERIOD,
    })
    await expect(deleteFreeShoppingList(list.id)).rejects.toMatchObject({
      code: 'confirmation-required',
    })

    const after = await loadView()
    expect(after.lists.find((entry) => entry.id === standard.id)?.name).toBe(
      before.lists.find((entry) => entry.id === standard.id)?.name,
    )
    expect(after.lists.some((entry) => entry.id === standard.id)).toBe(true)
    expect(after.lists.some((entry) => entry.id === list.id)).toBe(true)
    expect(rowsFor(after, list.id).some((entry) => entry.name === 'Zahnpasta')).toBe(true)
  })
})

describe('moving and splitting recipe ingredients', () => {
  it('moves a whole ingredient to a free list and back to the standard list', async () => {
    await seed()
    const market = await createFreeShoppingList({ name: 'Wochenmarkt' })
    const key = tomatoKey()

    await moveShoppingItem({ periodStart: PERIOD, itemKey: key, targetListId: market.id })
    let view = await loadView()
    expect(
      rowsFor(view, market.id).find((row) => row.name === 'Tomaten')?.openPositions[0],
    ).toMatchObject({ lower: 8, upper: 8 })
    expect(
      rowsFor(view, view.standardListId).some((row) => row.name === 'Tomaten'),
    ).toBe(false)

    const standard = await ensureStandardShoppingList(PERIOD)
    await moveShoppingItem({ periodStart: PERIOD, itemKey: key, targetListId: standard.id })
    view = await loadView()
    expect(
      rowsFor(view, view.standardListId).find((row) => row.name === 'Tomaten')
        ?.openPositions[0],
    ).toMatchObject({ lower: 8, upper: 8 })
    expect(rowsFor(view, market.id)).toHaveLength(0)
  })

  it('keeps a whole move complete when the recipe demand grows', async () => {
    await seed()
    const market = await createFreeShoppingList({ name: 'Wochenmarkt' })
    const key = tomatoKey()
    await moveShoppingItem({ periodStart: PERIOD, itemKey: key, targetListId: market.id })

    await setTomatoDemand(10)
    const view = await loadView()
    expect(
      rowsFor(view, market.id).find((row) => row.name === 'Tomaten')?.openPositions[0],
    ).toMatchObject({ lower: 10, upper: 10 })
    expect(
      rowsFor(view, view.standardListId).some((row) => row.name === 'Tomaten'),
    ).toBe(false)
  })

  it('splits 8 tomatoes into 5 on the market and 3 on the standard list', async () => {
    await seed()
    const market = await createFreeShoppingList({ name: 'Markt' })
    const key = tomatoKey()
    await assignShoppingSubquantity({
      periodStart: PERIOD,
      itemKey: key,
      dimension: 'count',
      targetListId: market.id,
      quantity: 5,
    })

    const view = await loadView()
    const marketRow = rowsFor(view, market.id).find((row) => row.name === 'Tomaten')
    const standardRow = rowsFor(view, view.standardListId).find(
      (row) => row.name === 'Tomaten',
    )
    expect(marketRow?.openPositions[0]).toMatchObject({ lower: 5, upper: 5 })
    expect(standardRow?.openPositions[0]).toMatchObject({ lower: 3, upper: 3 })
    expect(marketRow?.distributionListNames).toEqual(
      expect.arrayContaining(['Markt', expect.stringContaining('Wocheneinkauf')]),
    )
    expect(standardRow?.distributionListNames).toEqual(
      expect.arrayContaining(['Markt', expect.stringContaining('Wocheneinkauf')]),
    )

    const again = await loadView()
    const total =
      (again.rowsByList[market.id]?.find((row) => row.name === 'Tomaten')
        ?.openPositions[0]?.lower ?? 0) +
      (again.rowsByList[again.standardListId]?.find((row) => row.name === 'Tomaten')
        ?.openPositions[0]?.lower ?? 0)
    expect(total).toBe(8)
  })

  it('normalises 1.5 kg potatoes into 500 g and 1 kg in the page view', async () => {
    await db.recipes.put(
      recipe({
        ingredients: [
          ingredient({
            name: 'Kartoffeln',
            raw: '1,5 kg Kartoffeln',
            quantity: 1.5,
            quantityText: '1,5',
            unit: 'kg',
          }),
        ],
      }),
    )
    await db.cookSessions.put(session())
    const hofladen = await createFreeShoppingList({ name: 'Hofladen' })
    const key = shoppingItemKey('Kartoffeln')
    await assignShoppingSubquantity({
      periodStart: PERIOD,
      itemKey: key,
      dimension: 'mass',
      targetListId: hofladen.id,
      quantity: 500,
      unit: 'g',
    })

    const view = await loadView()
    expect(
      rowsFor(view, hofladen.id).find((row) => row.name === 'Kartoffeln')
        ?.openPositions[0],
    ).toMatchObject({ lower: 500, upper: 500 })
    expect(
      rowsFor(view, view.standardListId).find((row) => row.name === 'Kartoffeln')
        ?.openPositions[0],
    ).toMatchObject({ lower: 1000, upper: 1000 })
  })

  it('keeps a fixed subset fixed while demand rises and falls', async () => {
    await seed()
    const market = await createFreeShoppingList({ name: 'Markt' })
    const key = tomatoKey()
    await assignShoppingSubquantity({
      periodStart: PERIOD,
      itemKey: key,
      dimension: 'count',
      targetListId: market.id,
      quantity: 5,
    })

    await setTomatoDemand(10)
    let view = await loadView()
    expect(
      rowsFor(view, market.id).find((row) => row.name === 'Tomaten')?.openPositions[0],
    ).toMatchObject({ lower: 5, upper: 5 })
    expect(
      rowsFor(view, view.standardListId).find((row) => row.name === 'Tomaten')
        ?.openPositions[0],
    ).toMatchObject({ lower: 5, upper: 5 })

    await setTomatoDemand(6)
    view = await loadView()
    expect(
      rowsFor(view, market.id).find((row) => row.name === 'Tomaten')?.openPositions[0],
    ).toMatchObject({ lower: 5, upper: 5 })
    expect(
      rowsFor(view, view.standardListId).find((row) => row.name === 'Tomaten')
        ?.openPositions[0],
    ).toMatchObject({ lower: 1, upper: 1 })

    // Demand below the fixed subset is clamped and reported, never negative.
    await setTomatoDemand(4)
    view = await loadView()
    expect(
      rowsFor(view, market.id).find((row) => row.name === 'Tomaten')?.openPositions[0],
    ).toMatchObject({ lower: 4, upper: 4 })
    expect(
      rowsFor(view, view.standardListId).some((row) => row.name === 'Tomaten'),
    ).toBe(false)
    expect(
      view.distribution?.conflicts.some(
        (conflict) => conflict.code === 'over-allocated',
      ),
    ).toBe(true)
    expect(view.requiresReview).toBe(true)
  })

  it('spreads a fixed amount across three lists and keeps the sum stable', async () => {
    await seed()
    const market = await createFreeShoppingList({ name: 'Markt' })
    const bioladen = await createFreeShoppingList({ name: 'Bioladen' })
    const key = tomatoKey()
    await assignShoppingSubquantity({
      periodStart: PERIOD,
      itemKey: key,
      dimension: 'count',
      targetListId: market.id,
      quantity: 3,
    })
    await assignShoppingSubquantity({
      periodStart: PERIOD,
      itemKey: key,
      dimension: 'count',
      targetListId: bioladen.id,
      quantity: 2,
    })

    const view = await loadView()
    expect(
      rowsFor(view, market.id).find((row) => row.name === 'Tomaten')?.openPositions[0],
    ).toMatchObject({ lower: 3, upper: 3 })
    expect(
      rowsFor(view, bioladen.id).find((row) => row.name === 'Tomaten')?.openPositions[0],
    ).toMatchObject({ lower: 2, upper: 2 })
    expect(
      rowsFor(view, view.standardListId).find((row) => row.name === 'Tomaten')
        ?.openPositions[0],
    ).toMatchObject({ lower: 3, upper: 3 })
  })

  it('edits and removes a fixed subset and can reset all assignments', async () => {
    await seed()
    const market = await createFreeShoppingList({ name: 'Markt' })
    const key = tomatoKey()
    await assignShoppingSubquantity({
      periodStart: PERIOD,
      itemKey: key,
      dimension: 'count',
      targetListId: market.id,
      quantity: 5,
    })
    let view = await loadView()
    const allocation = view.distribution?.positions
      .find((position) => position.itemKey === key)
      ?.allocations.find(
        (entry) => !entry.blocked && entry.allocation.mode === 'partial',
      )?.allocation
    expect(allocation).toBeTruthy()

    await assignShoppingSubquantity({
      periodStart: PERIOD,
      itemKey: key,
      dimension: 'count',
      targetListId: market.id,
      quantity: 4,
    })
    view = await loadView()
    expect(
      rowsFor(view, market.id).find((row) => row.name === 'Tomaten')?.openPositions[0],
    ).toMatchObject({ lower: 4, upper: 4 })
    expect(
      rowsFor(view, view.standardListId).find((row) => row.name === 'Tomaten')
        ?.openPositions[0],
    ).toMatchObject({ lower: 4, upper: 4 })

    await removeShoppingAllocation(allocation!.id)
    view = await loadView()
    expect(rowsFor(view, market.id)).toHaveLength(0)
    expect(
      rowsFor(view, view.standardListId).find((row) => row.name === 'Tomaten')
        ?.openPositions[0],
    ).toMatchObject({ lower: 8, upper: 8 })

    await assignShoppingSubquantity({
      periodStart: PERIOD,
      itemKey: key,
      dimension: 'count',
      targetListId: market.id,
      quantity: 5,
    })
    expect(
      await resetShoppingAllocations({ periodStart: PERIOD, itemKey: key }),
    ).toBe(1)
    view = await loadView()
    expect(rowsFor(view, market.id)).toHaveLength(0)
    expect(
      rowsFor(view, view.standardListId).find((row) => row.name === 'Tomaten')
        ?.openPositions[0],
    ).toMatchObject({ lower: 8, upper: 8 })
  })

  it('keeps purchases with an allowed complete move', async () => {
    await seed()
    const market = await createFreeShoppingList({ name: 'Markt' })
    const key = tomatoKey()
    let view = await loadView()
    const required = rowsFor(view, view.standardListId).find(
      (row) => row.name === 'Tomaten',
    )?.requiredPositions
    await addShoppingPurchase({
      shoppingDate: PERIOD,
      itemKey: key,
      listId: view.standardListId,
      amounts: [{ dimension: 'count', lower: 2, upper: 2 }],
      snapshot: required ?? [],
    })

    await moveShoppingItem({ periodStart: PERIOD, itemKey: key, targetListId: market.id })
    view = await loadView()
    const moved = rowsFor(view, market.id).find((row) => row.name === 'Tomaten')
    expect(moved?.purchasedPositions[0]).toMatchObject({ lower: 2, upper: 2 })
    expect(moved?.openPositions[0]).toMatchObject({ lower: 6, upper: 6 })
    expect(
      rowsFor(view, view.standardListId).some((row) => row.name === 'Tomaten'),
    ).toBe(false)
  })

  it('rejects an ambiguous multi-dimension purchase without moving anything', async () => {
    await db.recipes.put(
      recipe({
        ingredients: [
          ingredient({ id: 'i1', position: 0 }),
          ingredient({
            id: 'i2',
            position: 1,
            raw: '500 g Tomaten',
            quantity: 500,
            quantityText: '500',
            unit: 'g',
          }),
        ],
      }),
    )
    await db.cookSessions.put(session())
    const market = await createFreeShoppingList({ name: 'Markt' })
    const key = tomatoKey()
    const initial = await loadView()
    const required = rowsFor(initial, initial.standardListId).find(
      (row) => row.name === 'Tomaten',
    )?.requiredPositions
    await addShoppingPurchase({
      shoppingDate: PERIOD,
      itemKey: key,
      listId: initial.standardListId,
      amounts: [
        { dimension: 'count', lower: 2, upper: 2 },
        { dimension: 'mass', lower: 100, upper: 100 },
      ],
      snapshot: required ?? [],
    })

    await expect(
      moveShoppingPosition({
        periodStart: PERIOD,
        itemKey: key,
        dimension: 'count',
        targetListId: market.id,
      }),
    ).rejects.toMatchObject({ code: 'purchase-conflict' })
    const view = await loadView()
    expect(
      rowsFor(view, view.standardListId).find((row) => row.name === 'Tomaten')
        ?.purchasedPositions.length,
    ).toBe(2)
    expect(rowsFor(view, market.id)).toHaveLength(0)
  })

  it('restores a deleted manual article together with its purchase state', async () => {
    const list = await createFreeShoppingList({ name: 'Drogerie' })
    const item = await createManualListItem({
      listId: list.id,
      name: 'Zahnpasta',
      quantityText: '1',
      unit: 'Stück',
      shoppingDate: PERIOD,
    })
    await setManualItemPurchased(item.id, true)
    const purchases = await db.shoppingPurchases
      .where('manualItemId')
      .equals(item.id)
      .toArray()
    expect(purchases).toHaveLength(1)

    await removeManualListItem(item.id)
    expect(
      await db.shoppingPurchases.where('manualItemId').equals(item.id).count(),
    ).toBe(0)

    await restoreManualItem(item, purchases)
    const view = await loadView()
    expect(
      rowsFor(view, list.id).find((row) => row.name === 'Zahnpasta')?.status,
    ).toBe('done')
    expect(
      rowsFor(view, list.id).find((row) => row.name === 'Zahnpasta')
        ?.purchasedPositions[0],
    ).toMatchObject({ lower: 1, upper: 1 })
  })
})

describe('stale allocations and purchases', () => {
  const hackfleischKey = shoppingItemKey('Hackfleisch gemischt')

  it('keeps a stale fixed subset reachable when demand disappears and returns', async () => {
    await setHackfleischDemand(400)
    await db.cookSessions.put(session())
    const dienstag = await createFreeShoppingList({ name: 'Dienstag' })
    await assignShoppingSubquantity({
      periodStart: PERIOD,
      itemKey: hackfleischKey,
      dimension: 'mass',
      targetListId: dienstag.id,
      quantity: 200,
    })

    let view = await loadView()
    let row = rowsFor(view, dienstag.id).find((entry) => entry.name === 'Hackfleisch')
    expect(row?.openPositions[0]).toMatchObject({ lower: 200, upper: 200 })
    expect(
      rowsFor(view, view.standardListId).find((entry) => entry.name === 'Hackfleisch')
        ?.openPositions[0],
    ).toMatchObject({ lower: 200, upper: 200 })
    expect(view.reviewRowsByList[dienstag.id] ?? []).toHaveLength(0)

    // A fixed subset larger than the reduced demand must be reported and the
    // still-applied row must stay editable.
    await setHackfleischDemand(150)
    view = await loadView()
    row = rowsFor(view, dienstag.id).find((entry) => entry.name === 'Hackfleisch')
    expect(row?.openPositions[0]).toMatchObject({ lower: 150, upper: 150 })
    expect(
      view.distribution?.conflicts.some(
        (conflict) => conflict.code === 'over-allocated',
      ),
    ).toBe(true)
    expect(view.conflictLabels).toContain('Hackfleisch')

    await addShoppingPurchase({
      shoppingDate: PERIOD,
      itemKey: hackfleischKey,
      listId: dienstag.id,
      amounts: [{ dimension: 'mass', lower: 200, upper: 200 }],
      snapshot: row?.requiredPositions ?? [],
    })

    // Removing the planned cooking event leaves both rows preserved but
    // without a demand row. They must become visible review rows, not vanish.
    await db.cookSessions.clear()
    view = await loadView()
    const stale = view.reviewRowsByList[dienstag.id]?.[0]
    expect(stale?.name).toBe('Hackfleisch')
    expect(stale?.allocationIds).toHaveLength(1)
    expect(stale?.purchaseIds).toHaveLength(1)
    expect(stale?.allocationLabels).toEqual(['200 g'])
    expect(stale?.purchaseLabels).toEqual(['200 g'])
    expect(rowsFor(view, dienstag.id)).toHaveLength(0)
    expect(view.lists.find((entry) => entry.id === dienstag.id)).toMatchObject({
      openCount: 0,
      doneCount: 0,
      reviewCount: 1,
      requiresReview: true,
    })
    expect(view.conflictLabels).toContain('Hackfleisch')

    // If the demand returns, the stored decision applies again.
    await db.cookSessions.put(session())
    view = await loadView()
    expect(view.reviewRowsByList[dienstag.id] ?? []).toHaveLength(0)
    expect(
      rowsFor(view, dienstag.id).find((entry) => entry.name === 'Hackfleisch')
        ?.purchasedPositions[0],
    ).toMatchObject({ lower: 200, upper: 200 })

    // Removing the demand again exposes the same rows; the user can now
    // explicitly remove the stale allocation and the unmatched purchase.
    await db.cookSessions.clear()
    view = await loadView()
    const removable = view.reviewRowsByList[dienstag.id]?.[0]
    expect(removable).toBeTruthy()
    await removeShoppingAllocation(removable!.allocationIds[0]!)
    view = await loadView()
    expect(view.reviewRowsByList[dienstag.id]?.[0]?.allocationIds).toHaveLength(0)
    expect(view.reviewRowsByList[dienstag.id]?.[0]?.purchaseIds).toHaveLength(1)
    await removeShoppingPurchase(removable!.purchaseIds[0]!)
    view = await loadView()
    expect(view.reviewRowsByList[dienstag.id] ?? []).toHaveLength(0)
  })

  it('surfaces a zero-effective share on a second list after demand shrinks', async () => {
    await setHackfleischDemand(400)
    await db.cookSessions.put(session())
    const market = await createFreeShoppingList({ name: 'Markt' })
    const bioladen = await createFreeShoppingList({ name: 'Bioladen' })
    await assignShoppingSubquantity({
      periodStart: PERIOD,
      itemKey: hackfleischKey,
      dimension: 'mass',
      targetListId: market.id,
      quantity: 200,
    })
    await assignShoppingSubquantity({
      periodStart: PERIOD,
      itemKey: hackfleischKey,
      dimension: 'mass',
      targetListId: bioladen.id,
      quantity: 200,
    })

    await setHackfleischDemand(150)
    const view = await loadView()
    const emptyList = [market, bioladen].find(
      (list) => rowsFor(view, list.id).length === 0,
    )
    expect(emptyList).toBeTruthy()
    const review = view.reviewRowsByList[emptyList!.id]?.[0]
    expect(review?.name).toBe('Hackfleisch')
    expect(review?.allocationIds).toHaveLength(1)
    expect(review?.allocationLabels).toEqual(['200 g'])
    expect(view.lists.find((entry) => entry.id === emptyList!.id)).toMatchObject({
      openCount: 0,
      doneCount: 0,
      reviewCount: 1,
      requiresReview: true,
    })
    expect(view.conflictLabels).toContain('Hackfleisch')
  })
})
