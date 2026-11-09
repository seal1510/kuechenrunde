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
