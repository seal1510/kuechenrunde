import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../db'
import { buildShoppingList, shoppingItemKey } from '../domain/shopping'
import {
  shoppingPeriod,
  standardShoppingListId,
} from '../domain/shoppingLists'
import type { CookSession, Ingredient, Recipe } from '../types'
import { addShoppingPurchase, removeManualItem } from './service'
import {
  assignShoppingSubquantity,
  createFreeShoppingList,
  createManualListItem,
  deleteFreeShoppingList,
  ensureStandardShoppingList,
  getOpenDemandByList,
  getShoppingDistribution,
  getShoppingPeriodDemand,
  listShoppingLists,
  moveManualItem,
  moveShoppingItem,
  renameShoppingList,
  resetShoppingAllocations,
  setManualItemPurchased,
  ShoppingListError,
} from './listService'

const PERIOD = '2026-11-05'
const PERIOD_START = '2026-11-05'
const PERIOD_END = '2026-11-11'

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

async function seed(
  recipeRow: Recipe = recipe(),
  sessionRow: CookSession = session(),
): Promise<void> {
  await db.recipes.put(recipeRow)
  await db.cookSessions.put(sessionRow)
}

function standardIdFor(anchor = PERIOD): string {
  return standardShoppingListId(shoppingPeriod(anchor).start)
}

async function tomatoDistribution(anchor = PERIOD) {
  return getShoppingDistribution(anchor)
}

function positionForKey(
  distribution: Awaited<ReturnType<typeof getShoppingDistribution>>,
  key: string,
  dimension = 'count',
) {
  const position = distribution.positions.find(
    (entry) => entry.itemKey === key && entry.dimension === dimension,
  )
  if (!position) throw new Error(`Missing position ${key}/${dimension}`)
  return position
}

function amountOn(
  distribution: Awaited<ReturnType<typeof getShoppingDistribution>>,
  key: string,
  listId: string,
  dimension = 'count',
): number {
  const position = positionForKey(distribution, key, dimension)
  return position.amounts.find((amount) => amount.listId === listId)?.lower ?? 0
}

function totalAssigned(
  distribution: Awaited<ReturnType<typeof getShoppingDistribution>>,
  key: string,
  dimension = 'count',
): number {
  const position = positionForKey(distribution, key, dimension)
  return position.amounts.reduce((sum, amount) => sum + amount.lower, 0)
}

function tomatoKey(): string {
  return shoppingItemKey('Tomaten')
}

beforeEach(async () => {
  await clearAll()
})

describe('shopping periods and lists', () => {
  it('uses one stable Thursday–Wednesday standard list per period', async () => {
    const thursday = await ensureStandardShoppingList('2026-11-05')
    const monday = await ensureStandardShoppingList('2026-11-09')
    expect(thursday.id).toBe(standardIdFor())
    expect(thursday.periodStart).toBe(PERIOD_START)
    expect(thursday.periodEnd).toBe(PERIOD_END)
    expect(monday.id).toBe(thursday.id)
    expect(thursday.name).toContain('Donnerstags-Einkauf')

    const next = await ensureStandardShoppingList('2026-11-12')
    expect(next.id).not.toBe(thursday.id)
    expect(next.periodStart).toBe('2026-11-12')
    expect(await db.shoppingLists.count()).toBe(2)
  })

  it('ignores the visual calendar week start for shopping periods', async () => {
    await db.settings.put({ key: 'weekStartDay', value: 1 })
    expect(shoppingPeriod('2026-11-09').start).toBe(PERIOD_START)
    const list = await ensureStandardShoppingList('2026-11-09')
    expect(list.id).toBe(standardIdFor('2026-11-09'))
    expect(list.periodStart).toBe(PERIOD_START)
  })

  it('crosses month and year boundaries without UTC day shifts', async () => {
    const period = shoppingPeriod('2027-01-02')
    expect(period.start).toBe('2026-12-31')
    expect(period.end).toBe('2027-01-06')
    expect(period.days).toHaveLength(7)
    const list = await ensureStandardShoppingList('2027-01-02')
    expect(list.periodStart).toBe('2026-12-31')
    expect(list.periodEnd).toBe('2027-01-06')
  })

  it('creates, lists, renames and deletes independent free lists', async () => {
    const market = await createFreeShoppingList({ name: 'Markt Samstag' })
    const evening = await createFreeShoppingList({ name: 'Heute Abend' })
    expect(market.id).not.toBe(evening.id)
    expect(market.periodStart).toBeNull()

    const renamed = await renameShoppingList(market.id, 'Wochenmarkt')
    expect(renamed.id).toBe(market.id)
    expect(renamed.name).toBe('Wochenmarkt')
    expect(renamed.createdAt).toBe(market.createdAt)

    const lists = await listShoppingLists()
    expect(lists.map((list) => list.name).sort()).toEqual(['Heute Abend', 'Wochenmarkt'])

    await deleteFreeShoppingList(evening.id)
    expect(await db.shoppingLists.get(evening.id)).toBeUndefined()
    expect((await listShoppingLists()).map((list) => list.name)).toEqual(['Wochenmarkt'])
  })

  it('protects standard lists and requires explicit confirmation for manual articles', async () => {
    const standard = await ensureStandardShoppingList(PERIOD)
    await expect(renameShoppingList(standard.id, 'Neu')).rejects.toMatchObject({
      code: 'standard-list-protected',
    })
    await expect(deleteFreeShoppingList(standard.id)).rejects.toMatchObject({
      code: 'standard-list-protected',
    })

    const market = await createFreeShoppingList({ name: 'Markt' })
    await createManualListItem({
      listId: market.id,
      name: 'Blumen',
      quantityText: '1',
      unit: 'Bund',
      shoppingDate: PERIOD,
    })
    await expect(deleteFreeShoppingList(market.id)).rejects.toMatchObject({
      code: 'confirmation-required',
    })
    expect(await db.shoppingLists.get(market.id)).toBeTruthy()

    const result = await deleteFreeShoppingList(market.id, { confirmManualItems: true })
    expect(result.removedManualItems).toBe(1)
    expect(await db.shoppingLists.get(market.id)).toBeUndefined()
  })
})

describe('demand distribution', () => {
  it('moves the complete position and keeps future increases on the target', async () => {
    await seed()
    const market = await createFreeShoppingList({ name: 'Markt Samstag' })
    const key = tomatoKey()

    const moved = await moveShoppingItem({
      periodStart: PERIOD,
      itemKey: key,
      targetListId: market.id,
    })
    expect(moved.mode).toBe('full')
    let distribution = await tomatoDistribution()
    expect(amountOn(distribution, key, market.id)).toBe(8)
    expect(amountOn(distribution, key, standardIdFor())).toBe(0)
    expect(totalAssigned(distribution, key)).toBe(8)

    // Demand increase still follows the full assignment.
    await seed(
      recipe({ ingredients: [ingredient({ quantity: 10, quantityText: '10', raw: '10 Tomaten' })] }),
    )
    distribution = await tomatoDistribution()
    expect(amountOn(distribution, key, market.id)).toBe(10)
    expect(amountOn(distribution, key, standardIdFor())).toBe(0)
  })

  it('splits 8 pieces into a fixed 5 + 3 and preserves the sum', async () => {
    await seed()
    const market = await createFreeShoppingList({ name: 'Markt Samstag' })
    const key = tomatoKey()

    await assignShoppingSubquantity({
      periodStart: PERIOD,
      itemKey: key,
      dimension: 'count',
      targetListId: market.id,
      quantity: 5,
    })
    const distribution = await tomatoDistribution()
    expect(amountOn(distribution, key, market.id)).toBe(5)
    expect(amountOn(distribution, key, standardIdFor())).toBe(3)
    expect(totalAssigned(distribution, key)).toBe(8)
  })

  it('splits 12 pieces across three lists without changing the total', async () => {
    await seed(
      recipe({ ingredients: [ingredient({ quantity: 12, quantityText: '12', raw: '12 Eier', name: 'Eier', unit: 'Stück' })] }),
    )
    const market = await createFreeShoppingList({ name: 'Markt' })
    const evening = await createFreeShoppingList({ name: 'Heute Abend' })
    const drogerie = await createFreeShoppingList({ name: 'Drogerie' })
    const key = shoppingItemKey('Eier')

    await assignShoppingSubquantity({
      periodStart: PERIOD,
      itemKey: key,
      dimension: 'count',
      targetListId: market.id,
      quantity: 6,
    })
    await assignShoppingSubquantity({
      periodStart: PERIOD,
      itemKey: key,
      dimension: 'count',
      targetListId: evening.id,
      quantity: 4,
    })
    await assignShoppingSubquantity({
      periodStart: PERIOD,
      itemKey: key,
      dimension: 'count',
      targetListId: drogerie.id,
      quantity: 2,
    })
    const distribution = await tomatoDistribution()
    expect(amountOn(distribution, key, market.id)).toBe(6)
    expect(amountOn(distribution, key, evening.id)).toBe(4)
    expect(amountOn(distribution, key, drogerie.id)).toBe(2)
    expect(amountOn(distribution, key, standardIdFor())).toBe(0)
    expect(totalAssigned(distribution, key)).toBe(12)
  })

  it('normalises 1.5 kg into 500 g and 1 kg', async () => {
    await seed(
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
    const market = await createFreeShoppingList({ name: 'Markt' })
    const key = shoppingItemKey('Kartoffeln')

    await assignShoppingSubquantity({
      periodStart: PERIOD,
      itemKey: key,
      dimension: 'mass',
      targetListId: market.id,
      quantity: 500,
      unit: 'g',
    })
    const distribution = await tomatoDistribution()
    expect(amountOn(distribution, key, market.id, 'mass')).toBe(500)
    expect(amountOn(distribution, key, standardIdFor(), 'mass')).toBe(1000)
    expect(totalAssigned(distribution, key, 'mass')).toBe(1500)
  })

  it('rejects over-allocation, invalid quantities and incompatible units', async () => {
    await seed()
    const market = await createFreeShoppingList({ name: 'Markt' })
    const key = tomatoKey()

    await expect(
      assignShoppingSubquantity({
        periodStart: PERIOD,
        itemKey: key,
        dimension: 'count',
        targetListId: market.id,
        quantity: 9,
      }),
    ).rejects.toMatchObject({ code: 'over-allocation' })

    for (const quantity of [0, -1, Number.NaN]) {
      await expect(
        assignShoppingSubquantity({
          periodStart: PERIOD,
          itemKey: key,
          dimension: 'count',
          targetListId: market.id,
          quantity,
        }),
      ).rejects.toMatchObject({ code: 'invalid-quantity' })
    }

    await expect(
      assignShoppingSubquantity({
        periodStart: PERIOD,
        itemKey: key,
        dimension: 'count',
        targetListId: market.id,
        quantity: 1,
        unit: 'kg',
      }),
    ).rejects.toMatchObject({ code: 'incompatible-unit' })

    // A second subset may not push the total over the demand.
    await assignShoppingSubquantity({
      periodStart: PERIOD,
      itemKey: key,
      dimension: 'count',
      targetListId: market.id,
      quantity: 5,
    })
    const evening = await createFreeShoppingList({ name: 'Heute Abend' })
    await expect(
      assignShoppingSubquantity({
        periodStart: PERIOD,
        itemKey: key,
        dimension: 'count',
        targetListId: evening.id,
        quantity: 4,
      }),
    ).rejects.toMatchObject({ code: 'over-allocation' })
  })

  it('never splits a non-numeric amount but allows a complete move', async () => {
    await seed(
      recipe({
        ingredients: [
          ingredient({
            name: 'Salz',
            raw: 'etwas Salz',
            quantity: null,
            quantityText: 'etwas',
            unit: null,
          }),
        ],
      }),
    )
    const market = await createFreeShoppingList({ name: 'Markt' })
    const key = shoppingItemKey('Salz')

    await expect(
      assignShoppingSubquantity({
        periodStart: PERIOD,
        itemKey: key,
        dimension: 'count',
        targetListId: market.id,
        quantity: 1,
      }),
    ).rejects.toMatchObject({ code: 'ambiguous-quantity' })

    await moveShoppingItem({ periodStart: PERIOD, itemKey: key, targetListId: market.id })
    const distribution = await tomatoDistribution()
    expect(
      distribution.unquantified.find((entry) => entry.itemKey === key)?.listId,
    ).toBe(market.id)
    expect(distribution.positions.filter((entry) => entry.itemKey === key)).toHaveLength(0)
  })

  it('resets a distribution back to the standard list', async () => {
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
    const removed = await resetShoppingAllocations({ periodStart: PERIOD, itemKey: key })
    expect(removed).toBe(1)
    const distribution = await tomatoDistribution()
    expect(amountOn(distribution, key, standardIdFor())).toBe(8)
    expect(distribution.conflicts).toHaveLength(0)
  })
})

describe('meal-plan changes', () => {
  it('keeps a fixed subset and gives additional demand to Thursday', async () => {
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
    await seed(
      recipe({ ingredients: [ingredient({ quantity: 10, quantityText: '10', raw: '10 Tomaten' })] }),
    )
    const distribution = await tomatoDistribution()
    expect(amountOn(distribution, key, market.id)).toBe(5)
    expect(amountOn(distribution, key, standardIdFor())).toBe(5)
  })

  it('clamps effective assignments when demand shrinks but keeps the stored decision', async () => {
    await seed()
    const market = await createFreeShoppingList({ name: 'Markt' })
    const key = tomatoKey()
    const assigned = await assignShoppingSubquantity({
      periodStart: PERIOD,
      itemKey: key,
      dimension: 'count',
      targetListId: market.id,
      quantity: 5,
    })
    await seed(
      recipe({ ingredients: [ingredient({ quantity: 4, quantityText: '4', raw: '4 Tomaten' })] }),
    )
    const distribution = await tomatoDistribution()
    expect(amountOn(distribution, key, market.id)).toBe(4)
    expect(amountOn(distribution, key, standardIdFor())).toBe(0)
    expect(totalAssigned(distribution, key)).toBe(4)
    expect(distribution.requiresReview).toBe(true)
    expect(distribution.conflicts.some((conflict) => conflict.code === 'over-allocated')).toBe(true)
    expect((await db.shoppingDemandAllocations.get(assigned.allocation.id))?.quantityMilli).toBe(5000)
  })

  it('keeps a stable order for competing subsets independent from insertion order', async () => {
    await seed()
    const key = tomatoKey()
    const first = await createFreeShoppingList({ name: 'A' })
    const second = await createFreeShoppingList({ name: 'B' })
    // Insert the later decision first to prove that database order is irrelevant.
    await db.shoppingDemandAllocations.put({
      id: `manual|${second.id}`,
      periodStart: PERIOD_START,
      itemKey: key,
      dimension: 'count',
      listId: second.id,
      mode: 'partial',
      quantityMilli: 5_000,
      createdAt: 20,
      updatedAt: 20,
    })
    await db.shoppingDemandAllocations.put({
      id: `manual|${first.id}`,
      periodStart: PERIOD_START,
      itemKey: key,
      dimension: 'count',
      listId: first.id,
      mode: 'partial',
      quantityMilli: 5_000,
      createdAt: 10,
      updatedAt: 10,
    })
    await seed(
      recipe({ ingredients: [ingredient({ quantity: 6, quantityText: '6', raw: '6 Tomaten' })] }),
    )
    const distribution = await tomatoDistribution()
    // The older decision (first, createdAt 10) wins; the later one is clamped.
    expect(amountOn(distribution, key, first.id)).toBe(5)
    expect(amountOn(distribution, key, second.id)).toBe(1)
    expect(totalAssigned(distribution, key)).toBe(6)
  })

  it('retains orphaned assignments and purchases when demand falls to zero', async () => {
    await seed()
    const market = await createFreeShoppingList({ name: 'Markt' })
    const key = tomatoKey()
    await moveShoppingItem({ periodStart: PERIOD, itemKey: key, targetListId: market.id })
    await addShoppingPurchase({
      shoppingDate: PERIOD,
      itemKey: key,
      listId: market.id,
      amounts: [{ dimension: 'count', lower: 3, upper: 3 }],
      snapshot: [{ dimension: 'count', unit: 'Stück', lower: 8, upper: 8, qualifier: '' }],
    })

    // The last cooking event disappears; the automatic demand becomes zero.
    await db.cookSessions.clear()
    const distribution = await tomatoDistribution()
    expect(distribution.positions).toHaveLength(0)
    expect(distribution.requiresReview).toBe(true)
    expect(distribution.conflicts.some((conflict) => conflict.code === 'orphaned-allocation')).toBe(
      true,
    )
    expect(await db.shoppingDemandAllocations.count()).toBe(1)
    expect(await db.shoppingPurchases.count()).toBe(1)
    expect(
      (await getOpenDemandByList(PERIOD)).positions.reduce(
        (sum, position) => sum + position.openLower,
        0,
      ),
    ).toBe(0)
  })

  it('recalculates demand when the recipe is replaced and counts one cook session once', async () => {
    await seed()
    await db.mealPlans.bulkPut([
      {
        id: 'plan-a',
        date: PERIOD,
        slot: 'dinner',
        recipeId: 'r1',
        servings: 2,
        position: 0,
        cookSessionId: 's1',
        status: 'planned',
        auto: false,
        pinned: false,
        leftover: false,
        cooked: false,
        reasons: [],
        createdAt: 1,
        updatedAt: 1,
      },
      {
        id: 'plan-b',
        date: '2026-11-06',
        slot: 'lunch',
        recipeId: 'r1',
        servings: 2,
        position: 0,
        cookSessionId: 's1',
        status: 'planned',
        auto: false,
        pinned: false,
        leftover: false,
        cooked: false,
        reasons: [],
        createdAt: 1,
        updatedAt: 1,
      },
    ])
    const demand = await getShoppingPeriodDemand(PERIOD)
    expect(demand.items.find((item) => item.key === tomatoKey())?.positions[0]?.lower).toBe(8)
    expect(demand.items).toHaveLength(1)

    await db.recipes.put(
      recipe({
        id: 'r2',
        importId: 'mela-r2',
        title: 'Kartoffelgericht',
        ingredients: [
          ingredient({
            name: 'Kartoffeln',
            raw: '1 kg Kartoffeln',
            quantity: 1,
            quantityText: '1',
            unit: 'kg',
          }),
        ],
      }),
    )
    await db.cookSessions.put(session({ recipeId: 'r2' }))
    const replaced = await getShoppingPeriodDemand(PERIOD)
    expect(replaced.items.map((item) => item.key)).toEqual([shoppingItemKey('Kartoffeln')])
  })
})

describe('purchased amounts and status', () => {
  it('keeps partial purchases on their list and never double counts', async () => {
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
    await addShoppingPurchase({
      shoppingDate: PERIOD,
      itemKey: key,
      listId: market.id,
      amounts: [{ dimension: 'count', lower: 2, upper: 2 }],
      snapshot: [{ dimension: 'count', unit: 'Stück', lower: 5, upper: 5, qualifier: '' }],
    })
    const open = await getOpenDemandByList(PERIOD)
    const marketOpen = open.positions.find(
      (position) => position.listId === market.id && position.itemKey === key,
    )
    const standardOpen = open.positions.find(
      (position) => position.listId === standardIdFor() && position.itemKey === key,
    )
    expect(marketOpen).toMatchObject({ assignedLower: 5, purchasedLower: 2, openLower: 3 })
    expect(standardOpen).toMatchObject({ assignedLower: 3, purchasedLower: 0, openLower: 3 })
    expect(open.positions.reduce((sum, position) => sum + position.purchasedLower, 0)).toBe(2)
  })

  it('keeps a fully bought position done and shows new demand as open', async () => {
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
    await addShoppingPurchase({
      shoppingDate: PERIOD,
      itemKey: key,
      listId: market.id,
      amounts: [{ dimension: 'count', lower: 5, upper: 5 }],
      snapshot: [{ dimension: 'count', unit: 'Stück', lower: 5, upper: 5, qualifier: '' }],
    })
    let open = await getOpenDemandByList(PERIOD)
    expect(
      open.positions.find((position) => position.listId === market.id)?.done,
    ).toBe(true)

    await seed(
      recipe({ ingredients: [ingredient({ quantity: 10, quantityText: '10', raw: '10 Tomaten' })] }),
    )
    open = await getOpenDemandByList(PERIOD)
    const marketOpen = open.positions.find(
      (position) => position.listId === market.id && position.itemKey === key,
    )
    const standardOpen = open.positions.find(
      (position) => position.listId === standardIdFor() && position.itemKey === key,
    )
    expect(marketOpen).toMatchObject({ assignedLower: 5, purchasedLower: 5, openLower: 0 })
    expect(standardOpen).toMatchObject({ assignedLower: 5, purchasedLower: 0, openLower: 5 })
  })

  it('moves the existing purchase status together with a complete position', async () => {
    await seed()
    const market = await createFreeShoppingList({ name: 'Markt' })
    const key = tomatoKey()
    await addShoppingPurchase({
      shoppingDate: PERIOD,
      itemKey: key,
      listId: standardIdFor(),
      amounts: [{ dimension: 'count', lower: 5, upper: 5 }],
      snapshot: [{ dimension: 'count', unit: 'Stück', lower: 8, upper: 8, qualifier: '' }],
    })
    const moved = await moveShoppingItem({
      periodStart: PERIOD,
      itemKey: key,
      targetListId: market.id,
    })
    expect(moved.movedPurchases).toBe(1)
    const open = await getOpenDemandByList(PERIOD)
    const marketOpen = open.positions.find((position) => position.listId === market.id)
    expect(marketOpen).toMatchObject({ assignedLower: 8, purchasedLower: 5, openLower: 3 })
    expect(
      open.positions.some((position) => position.listId === standardIdFor()),
    ).toBe(false)
  })

  it('keeps purchases in place for a partial distribution and clamps open at zero', async () => {
    await seed()
    const market = await createFreeShoppingList({ name: 'Markt' })
    const key = tomatoKey()
    await addShoppingPurchase({
      shoppingDate: PERIOD,
      itemKey: key,
      listId: standardIdFor(),
      amounts: [{ dimension: 'count', lower: 2, upper: 2 }],
      snapshot: [{ dimension: 'count', unit: 'Stück', lower: 8, upper: 8, qualifier: '' }],
    })
    await assignShoppingSubquantity({
      periodStart: PERIOD,
      itemKey: key,
      dimension: 'count',
      targetListId: market.id,
      quantity: 3,
    })
    let open = await getOpenDemandByList(PERIOD)
    expect(
      open.positions.find((position) => position.listId === market.id && position.itemKey === key),
    ).toMatchObject({ assignedLower: 3, purchasedLower: 0, openLower: 3 })
    expect(
      open.positions.find(
        (position) => position.listId === standardIdFor() && position.itemKey === key,
      ),
    ).toMatchObject({ assignedLower: 5, purchasedLower: 2, openLower: 3 })
    expect(open.positions.reduce((sum, position) => sum + position.openLower, 0)).toBe(6)

    // More bought than assigned must never produce a negative open amount.
    await addShoppingPurchase({
      shoppingDate: PERIOD,
      itemKey: key,
      listId: market.id,
      amounts: [{ dimension: 'count', lower: 10, upper: 10 }],
      snapshot: [{ dimension: 'count', unit: 'Stück', lower: 3, upper: 3, qualifier: '' }],
    })
    open = await getOpenDemandByList(PERIOD)
    expect(
      open.positions.find((position) => position.listId === market.id && position.itemKey === key)
        ?.openLower,
    ).toBe(0)
    expect(open.positions.every((position) => position.openLower >= 0)).toBe(true)
  })
})

describe('manual articles', () => {
  it('keeps manual and automatic items separate even with the same name', async () => {
    await seed()
    const market = await createFreeShoppingList({ name: 'Markt' })
    const manual = await createManualListItem({
      listId: market.id,
      name: 'Tomaten',
      quantityText: '2',
      unit: 'Stück',
      shoppingDate: PERIOD,
    })
    await setManualItemPurchased(manual.id, true)

    const open = await getOpenDemandByList(PERIOD)
    expect(open.positions.filter((position) => position.itemKey === tomatoKey())).toHaveLength(1)
    expect(open.positions.find((position) => position.itemKey === tomatoKey())?.listId).toBe(
      standardIdFor(),
    )
    const manualView = open.manualItems.find((entry) => entry.manualItem.id === manual.id)
    expect(manualView).toMatchObject({ listId: market.id, done: true, purchasedLower: 2 })
    // The automatic demand is not affected by the manual article.
    expect(await db.shoppingDemandAllocations.count()).toBe(0)
  })

  it('moves a manual article and its status without touching recipe demand', async () => {
    await seed()
    const market = await createFreeShoppingList({ name: 'Markt' })
    const evening = await createFreeShoppingList({ name: 'Heute Abend' })
    const manual = await createManualListItem({
      listId: market.id,
      name: 'Blumen',
      quantityText: '1',
      unit: 'Bund',
      shoppingDate: PERIOD,
    })
    await setManualItemPurchased(manual.id, true)
    const moved = await moveManualItem(manual.id, evening.id)
    expect(moved.id).toBe(manual.id)
    expect(moved.listId).toBe(evening.id)

    const open = await getOpenDemandByList(PERIOD)
    const manualView = open.manualItems.find((entry) => entry.manualItem.id === manual.id)
    expect(manualView).toMatchObject({ listId: evening.id, done: true })
    expect(open.positions.every((position) => position.listId !== evening.id)).toBe(true)
  })

  it('keeps free-list manual articles independent from a shopping period', async () => {
    const market = await createFreeShoppingList({ name: 'Markt' })
    const manual = await createManualListItem({
      listId: market.id,
      name: 'Blumen',
      quantityText: '1',
      unit: 'Bund',
      shoppingDate: '2026-12-01',
    })
    const open = await getOpenDemandByList(PERIOD)
    const manualView = open.manualItems.find((entry) => entry.manualItem.id === manual.id)
    expect(manualView).toBeTruthy()
    expect(manualView?.listId).toBe(market.id)
  })

  it('keeps an old weekly purchase visible as a legacy manual status', async () => {
    const market = await createFreeShoppingList({ name: 'Markt' })
    const manual = await createManualListItem({
      listId: market.id,
      name: 'Kaffee',
      quantityText: '1',
      unit: 'Packung',
      shoppingDate: PERIOD,
    })
    await db.shoppingPurchases.put({
      id: 'legacy-purchase',
      shoppingDate: PERIOD,
      itemKey: shoppingItemKey('Kaffee'),
      amounts: [{ dimension: 'unit:packung', lower: 1, upper: 1 }],
      snapshot: [],
      qualitative: false,
      createdAt: 1,
      updatedAt: 1,
    })
    const open = await getOpenDemandByList(PERIOD)
    const view = open.manualItems.find((entry) => entry.manualItem.id === manual.id)
    expect(view).toMatchObject({
      done: true,
      legacyPurchaseFallback: true,
      purchasedLower: 1,
    })
  })

  it('returns automatic allocations to Thursday when a free list is deleted', async () => {
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
    const result = await deleteFreeShoppingList(market.id)
    expect(result.movedAllocations).toBe(1)
    const distribution = await tomatoDistribution()
    expect(amountOn(distribution, key, standardIdFor())).toBe(8)
    expect(distribution.positions.some((position) => position.amounts.some((amount) => amount.listId === market.id))).toBe(
      false,
    )
  })

  it('removes linked purchases when a manual article is explicitly deleted', async () => {
    const market = await createFreeShoppingList({ name: 'Markt' })
    const manual = await createManualListItem({
      listId: market.id,
      name: 'Kaffee',
      quantityText: '1',
      unit: 'Packung',
      shoppingDate: PERIOD,
    })
    await setManualItemPurchased(manual.id, true)
    expect(await db.shoppingPurchases.count()).toBe(1)
    await removeManualItem(manual.id)
    expect(await db.shoppingManualItems.get(manual.id)).toBeUndefined()
    expect(await db.shoppingPurchases.count()).toBe(0)
  })
})

describe('backwards compatibility and read-only access', () => {
  it('keeps the existing aggregate demand identical', async () => {
    await seed()
    const [recipes, freeDishes, cookSessions, rules, corrections] = await Promise.all([
      db.recipes.toArray(),
      db.freeDishes.toArray(),
      db.cookSessions.toArray(),
      db.shoppingItemRules.toArray(),
      db.shoppingQuantityCorrections.toArray(),
    ])
    const aggregate = buildShoppingList({
      anchor: PERIOD,
      weekStartDay: 3,
      recipes,
      freeDishes,
      cookSessions,
      manualItems: [],
      checks: [],
      purchases: [],
      rules,
      quantityCorrections: corrections,
    })
    const demand = await getShoppingPeriodDemand(PERIOD)
    expect(aggregate.items.find((item) => item.key === tomatoKey())?.requiredPositions[0]?.lower).toBe(
      demand.items.find((item) => item.key === tomatoKey())?.positions[0]?.lower,
    )
  })

  it('does not write anything during read-only service calls', async () => {
    await seed()
    const market = await createFreeShoppingList({ name: 'Markt' })
    await moveShoppingItem({
      periodStart: PERIOD,
      itemKey: tomatoKey(),
      targetListId: market.id,
    })
    const before = {
      lists: await db.shoppingLists.count(),
      allocations: await db.shoppingDemandAllocations.count(),
      purchases: await db.shoppingPurchases.count(),
      manual: await db.shoppingManualItems.count(),
      demand: JSON.stringify(await getShoppingPeriodDemand(PERIOD)),
      listRows: JSON.stringify(await db.shoppingLists.toArray()),
    }
    await getShoppingDistribution(PERIOD)
    await getOpenDemandByList(PERIOD)
    await listShoppingLists()
    const after = {
      lists: await db.shoppingLists.count(),
      allocations: await db.shoppingDemandAllocations.count(),
      purchases: await db.shoppingPurchases.count(),
      manual: await db.shoppingManualItems.count(),
      demand: JSON.stringify(await getShoppingPeriodDemand(PERIOD)),
      listRows: JSON.stringify(await db.shoppingLists.toArray()),
    }
    expect(after).toEqual(before)
  })

  it('reports unsupported conflicts with a typed code instead of corrupting data', async () => {
    await seed()
    const key = tomatoKey()
    const market = await createFreeShoppingList({ name: 'Markt' })
    await expect(
      assignShoppingSubquantity({
        periodStart: '2026-11-05',
        itemKey: key,
        dimension: 'count',
        targetListId: 'missing-list',
        quantity: 1,
      }),
    ).rejects.toBeInstanceOf(ShoppingListError)
    await expect(
      assignShoppingSubquantity({
        periodStart: '2026-11-05',
        itemKey: 'unbekannt',
        dimension: 'count',
        targetListId: market.id,
        quantity: 1,
      }),
    ).rejects.toMatchObject({ code: 'position-not-found' })
    expect(await db.shoppingDemandAllocations.count()).toBe(0)
  })

  it('keeps legacy settings and rows reachable after the schema migration', async () => {
    await seed()
    await db.shoppingManualItems.put({
      id: 'legacy-manual',
      shoppingDate: PERIOD,
      weekStart: PERIOD,
      name: 'Milch',
      quantityText: '1',
      unit: 'l',
      purchaseNote: '',
      categoryId: 'dairy',
      createdAt: 1,
      updatedAt: 1,
    })
    const open = await getOpenDemandByList(PERIOD)
    expect(open.manualItems.some((entry) => entry.manualItem.id === 'legacy-manual')).toBe(true)
  })
})
