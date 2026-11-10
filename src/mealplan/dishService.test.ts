import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../db'
import { addDays } from '../domain/dates'
import { shoppingItemKey } from '../domain/shopping'
import { standardShoppingListId } from '../domain/shoppingLists'
import {
  createDaySelection,
  toPlanDays,
} from '../domain/daySelection'
import { DEFAULT_PLAN_SLOT, groupDates, planDayTotal, scalePlan } from '../domain/dishplan'
import { deleteRecipe } from '../import/importer'
import type { Ingredient, MealPlanEntry, Recipe } from '../types'
import {
  assignShoppingSubquantity,
  createFreeShoppingList,
  createManualListItem,
  getOpenDemandByList,
  setManualItemPurchased,
} from '../shopping/listService'
import { addShoppingPurchase } from '../shopping/service'
import {
  CookedPlanConflictError,
  deleteDishPlan,
  saveDishPlan,
  setDishPlanCooked,
} from './dishService'
import { generatePlan } from './service'

const TODAY = '2026-05-25'

function makeRecipe(id: string, overrides: Partial<Recipe> = {}): Recipe {
  return {
    id,
    importId: `mela-${id}`,
    importSource: 'mela',
    title: `Rezept ${id}`,
    description: '',
    ingredientGroups: [],
    ingredients: [
      {
        id: `${id}-i1`,
        groupId: null,
        position: 0,
        raw: '400 g Spaghetti',
        name: 'Spaghetti',
        quantity: 400,
        quantityText: '400',
        unit: 'g',
        parseStatus: 'parsed',
        links: [],
      },
    ],
    instructions: [],
    servingsText: '4 Portionen',
    servingsNumber: 4,
    prepTime: '',
    cookTime: '',
    totalTime: '30 min',
    categories: ['Pasta'],
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

function ingredient(
  id: string,
  name: string,
  quantity: number,
  unit = 'Stück',
  position = 0,
): Ingredient {
  return {
    id,
    groupId: null,
    position,
    raw: `${quantity} ${unit} ${name}`,
    name,
    quantity,
    quantityText: String(quantity),
    unit,
    purchaseNote: '',
    preparationNote: '',
    parseStatus: 'parsed',
    links: [],
  }
}

function ingredientWithoutQuantity(
  id: string,
  name: string,
  position = 0,
): Ingredient {
  return {
    ...ingredient(id, name, 1, 'Stück', position),
    raw: name,
    quantity: null,
    quantityText: null,
    unit: null,
  }
}

function legacyEntry(id: string, date: string): MealPlanEntry {
  return {
    id,
    date,
    slot: 'dinner',
    recipeId: 'r1',
    auto: false,
    pinned: false,
    leftover: false,
    cooked: false,
    reasons: [],
    createdAt: 1,
    updatedAt: 1,
  }
}

async function buy(
  itemKey: string,
  quantity: number,
  listId: string = standardShoppingListId(TODAY),
): Promise<void> {
  await addShoppingPurchase({
    shoppingDate: TODAY,
    itemKey,
    listId,
    periodStart: TODAY,
    amounts: [{ dimension: 'count', lower: quantity, upper: quantity }],
    snapshot: [
      {
        dimension: 'count',
        unit: 'Stück',
        lower: quantity,
        upper: quantity,
        qualifier: '',
      },
    ],
  })
}

beforeEach(async () => {
  await db.mealPlans.clear()
  await db.mealDays.clear()
  await db.settings.clear()
  await db.shoppingLists.clear()
  await db.shoppingPurchases.clear()
  await db.shoppingDemandAllocations.clear()
  await db.shoppingItemRules.clear()
  await db.shoppingQuantityCorrections.clear()
  await db.shoppingManualItems.clear()
  await db.freeDishes.clear()
  // These historical tests assume a Monday-based planning week. The product
  // default is now the configured shopping day; the explicit test setting keeps
  // the existing expectations deterministic.
  await db.settings.put({ key: 'shoppingPeriodStartDay', value: 0 })
  await db.cookSessions.clear()
  await db.recipes.clear()
  await db.images.clear()
  await db.recipes.bulkAdd([
    makeRecipe('r1'),
    makeRecipe('r2', { title: 'Rezept r2' }),
    makeRecipe('r3', { title: 'Rezept r3' }),
  ])
})

describe('multi-day dish service', () => {
  it('creates one cooking event and one appointment per day with individual portions', async () => {
    const result = await saveDishPlan({
      recipeId: 'r1',
      slot: 'dinner',
      days: [
        { date: '2026-05-25', servings: 2 },
        { date: '2026-05-26', servings: 1 },
        { date: '2026-05-27', servings: 3 },
      ],
    })

    expect(result.session.servings).toBe(6)
    expect(result.session.date).toBe('2026-05-25')
    expect(result.entries).toHaveLength(3)
    expect(result.entries.map((entry) => entry.servings)).toEqual([2, 1, 3])
    expect(new Set(result.entries.map((entry) => entry.cookSessionId))).toEqual(
      new Set([result.session.id]),
    )
    expect(planDayTotal(result.entries.map((entry) => ({
      date: entry.date,
      servings: entry.servings ?? 0,
    })))).toBe(6)
    expect(await db.cookSessions.count()).toBe(1)
    expect(await db.mealPlans.count()).toBe(3)
  })

  it('saves a new dish without asking for a meal slot', async () => {
    const result = await saveDishPlan({
      recipeId: 'r1',
      days: [{ date: TODAY, servings: 2 }],
    })

    expect(result.entries[0]?.slot).toBe(DEFAULT_PLAN_SLOT)
    expect((await db.mealPlans.get(result.entries[0]!.id))?.slot).toBe(DEFAULT_PLAN_SLOT)
  })

  it('keeps several dishes on the same day in the internal default slot', async () => {
    const first = await saveDishPlan({
      recipeId: 'r1',
      days: [{ date: TODAY, servings: 2 }],
    })
    const second = await saveDishPlan({
      recipeId: 'r2',
      days: [{ date: TODAY, servings: 1 }],
    })

    const entries = await db.mealPlans.where('date').equals(TODAY).toArray()
    expect(entries).toHaveLength(2)
    expect(entries.every((entry) => entry.slot === DEFAULT_PLAN_SLOT)).toBe(true)
    expect(first.session.id).not.toBe(second.session.id)
  })

  it('preserves a legacy slot internally when a dish is edited without a slot field', async () => {
    const legacy = { ...legacyEntry('legacy-breakfast', TODAY), slot: 'breakfast' }
    await db.mealPlans.put(legacy)

    const result = await saveDishPlan({
      recipeId: 'r1',
      days: [{ entryId: legacy.id, date: legacy.date, servings: 2 }],
    })

    expect(result.entries[0]?.id).toBe(legacy.id)
    expect(result.entries[0]?.slot).toBe('breakfast')
  })

  it('plans non-consecutive days with individual portions and scaled ingredients', async () => {
    const result = await saveDishPlan({
      recipeId: 'r1',
      days: [
        { date: '2026-05-29', servings: 2 },
        { date: '2026-05-31', servings: 3 },
      ],
    })

    expect(result.session.servings).toBe(5)
    expect(result.entries.map((entry) => entry.date)).toEqual([
      '2026-05-29',
      '2026-05-31',
    ])
    expect(result.entries.map((entry) => entry.servings)).toEqual([2, 3])
    expect(result.entries.some((entry) => entry.date === '2026-05-30')).toBe(false)

    const recipe = (await db.recipes.get('r1'))!
    const scale = scalePlan(
      recipe,
      result.entries.map((entry) => ({
        date: entry.date,
        servings: entry.servings ?? 0,
      })),
    )
    expect(scale.totalServings).toBe(5)
    expect(scale.scaling.factor).toBe(1.25)
    expect(scale.scaling.items[0]?.quantityText).toBe('500')
  })

  it('edits a group with gaps without turning it into consecutive days', async () => {
    const first = await saveDishPlan({
      recipeId: 'r1',
      days: [
        { date: '2026-05-29', servings: 2 },
        { date: '2026-05-31', servings: 3 },
      ],
    })
    const friday = first.entries.find((entry) => entry.date === '2026-05-29')!
    const sunday = first.entries.find((entry) => entry.date === '2026-05-31')!

    const edited = await saveDishPlan({
      cookSessionId: first.session.id,
      recipeId: 'r1',
      days: [
        { entryId: friday.id, date: '2026-05-29', servings: 4 },
        { date: '2026-06-01', servings: 2 },
      ],
    })

    expect(edited.session.servings).toBe(6)
    expect(edited.entries.map((entry) => entry.date)).toEqual([
      '2026-05-29',
      '2026-06-01',
    ])
    expect(edited.entries.find((entry) => entry.date === '2026-05-29')?.id).toBe(
      friday.id,
    )
    expect(await db.mealPlans.get(sunday.id)).toBeUndefined()
    expect(edited.entries.some((entry) => entry.date === '2026-05-30')).toBe(false)
  })

  it('keeps free days across a year boundary', async () => {
    const result = await saveDishPlan({
      recipeId: 'r1',
      days: [
        { date: '2026-12-31', servings: 2 },
        { date: '2027-01-02', servings: 3 },
      ],
    })

    expect(result.session.servings).toBe(5)
    expect(result.entries.map((entry) => entry.date)).toEqual([
      '2026-12-31',
      '2027-01-02',
    ])
    expect(result.session.date).toBe('2026-12-31')
  })

  it('can shift a free-day group by a date difference', async () => {
    const first = await saveDishPlan({
      recipeId: 'r1',
      days: [
        { date: '2026-05-29', servings: 2 },
        { date: '2026-05-31', servings: 3 },
      ],
    })
    const shifted = await saveDishPlan({
      cookSessionId: first.session.id,
      recipeId: 'r1',
      days: first.entries.map((entry) => ({
        entryId: entry.id,
        date: addDays(entry.date, 7),
        servings: entry.servings ?? 1,
      })),
    })

    expect(shifted.entries.map((entry) => entry.date)).toEqual([
      '2026-06-05',
      '2026-06-07',
    ])
    expect(shifted.entries.map((entry) => entry.id)).toEqual(
      first.entries.map((entry) => entry.id),
    )
    expect(shifted.session.date).toBe('2026-06-05')
    expect(shifted.session.servings).toBe(5)
  })

  it('updates the same rows without duplicating on a repeated save', async () => {
    const first = await saveDishPlan({
      recipeId: 'r1',
      slot: 'dinner',
      days: [
        { date: TODAY, servings: 2 },
        { date: '2026-05-26', servings: 2 },
      ],
    })
    const ids = first.entries.map((entry) => entry.id)

    const again = await saveDishPlan({
      cookSessionId: first.session.id,
      recipeId: 'r1',
      slot: 'dinner',
      days: first.entries.map((entry) => ({
        entryId: entry.id,
        date: entry.date,
        servings: entry.servings ?? 1,
      })),
    })

    expect(again.entries.map((entry) => entry.id)).toEqual(ids)
    expect(await db.mealPlans.count()).toBe(2)
    expect(await db.cookSessions.count()).toBe(1)
  })

  it('round-trips an existing free-day plan through the dialog selection model', async () => {
    const first = await saveDishPlan({
      recipeId: 'r1',
      days: [
        { date: '2026-05-29', servings: 2 },
        { date: '2026-06-02', servings: 3 },
        { date: '2026-06-05', servings: 1 },
      ],
    })
    const selection = createDaySelection(first.entries, '2026-05-29')

    const saved = await saveDishPlan({
      cookSessionId: first.session.id,
      recipeId: 'r1',
      days: toPlanDays(selection),
    })

    expect(saved.entries.map((entry) => entry.id)).toEqual(
      first.entries.map((entry) => entry.id),
    )
    expect(saved.entries.map((entry) => entry.date)).toEqual([
      '2026-05-29',
      '2026-06-02',
      '2026-06-05',
    ])
    expect(saved.session.servings).toBe(6)
    expect(await db.mealPlans.count()).toBe(3)
    expect(await db.cookSessions.count()).toBe(1)
  })

  it('recalculates the cooking amount when one day changes', async () => {
    const first = await saveDishPlan({
      recipeId: 'r1',
      slot: 'dinner',
      days: [
        { date: TODAY, servings: 2 },
        { date: '2026-05-26', servings: 1 },
        { date: '2026-05-27', servings: 3 },
      ],
    })
    const middle = first.entries.find((entry) => entry.date === '2026-05-26')!

    const changed = await saveDishPlan({
      cookSessionId: first.session.id,
      recipeId: 'r1',
      slot: 'dinner',
      days: first.entries.map((entry) => ({
        entryId: entry.id,
        date: entry.date,
        servings: entry.id === middle.id ? 4 : (entry.servings ?? 1),
      })),
    })

    expect(changed.session.servings).toBe(9)
    expect((await db.mealPlans.get(middle.id))?.servings).toBe(4)
  })

  it('extends and shrinks a connected dish without leaving orphan rows', async () => {
    const first = await saveDishPlan({
      recipeId: 'r1',
      slot: 'dinner',
      days: [
        { date: TODAY, servings: 2 },
        { date: '2026-05-26', servings: 2 },
      ],
    })

    const extended = await saveDishPlan({
      cookSessionId: first.session.id,
      recipeId: 'r1',
      slot: 'dinner',
      days: [
        ...first.entries.map((entry) => ({
          entryId: entry.id,
          date: entry.date,
          servings: entry.servings ?? 1,
        })),
        { date: '2026-05-27', servings: 3 },
        { date: '2026-05-28', servings: 1 },
      ],
    })
    expect(extended.entries).toHaveLength(4)
    expect(extended.session.servings).toBe(8)
    expect(await db.mealPlans.count()).toBe(4)

    const shrunk = await saveDishPlan({
      cookSessionId: first.session.id,
      recipeId: 'r1',
      slot: 'dinner',
      days: [
        {
          entryId: first.entries[0]!.id,
          date: first.entries[0]!.date,
          servings: 2,
        },
      ],
    })
    expect(shrunk.entries).toHaveLength(1)
    expect(shrunk.session.servings).toBe(2)
    expect(await db.mealPlans.count()).toBe(1)
    expect(groupDates(await db.mealPlans.toArray(), first.session.id)).toHaveLength(1)
  })

  it('moves a whole dish and keeps every day connected', async () => {
    const first = await saveDishPlan({
      recipeId: 'r1',
      slot: 'dinner',
      days: [
        { date: TODAY, servings: 2 },
        { date: '2026-05-26', servings: 1 },
      ],
    })
    const moved = await saveDishPlan({
      cookSessionId: first.session.id,
      recipeId: 'r1',
      slot: 'dinner',
      days: first.entries.map((entry) => ({
        entryId: entry.id,
        date: entry.date === TODAY ? '2026-06-01' : '2026-06-02',
        servings: entry.servings ?? 1,
      })),
    })
    expect(moved.entries.map((entry) => entry.date)).toEqual(['2026-06-01', '2026-06-02'])
    expect(moved.entries.map((entry) => entry.id)).toEqual(first.entries.map((entry) => entry.id))
    expect(moved.session.date).toBe('2026-06-01')
    expect(moved.session.servings).toBe(3)
  })

  it('plans across a calendar week and year boundary', async () => {
    const result = await saveDishPlan({
      recipeId: 'r1',
      slot: 'dinner',
      days: [
        { date: '2026-12-30', servings: 2 },
        { date: '2026-12-31', servings: 2 },
        { date: '2027-01-01', servings: 2 },
      ],
    })
    expect(result.entries.map((entry) => entry.date)).toEqual([
      '2026-12-30',
      '2026-12-31',
      '2027-01-01',
    ])
    expect(result.session.servings).toBe(6)
  })

  it('deletes only the connected group', async () => {
    const group = await saveDishPlan({
      recipeId: 'r1',
      slot: 'dinner',
      days: [
        { date: TODAY, servings: 2 },
        { date: '2026-05-26', servings: 2 },
      ],
    })
    const other = await saveDishPlan({
      recipeId: 'r2',
      slot: 'lunch',
      days: [{ date: TODAY, servings: 1 }],
    })

    const result = await deleteDishPlan(group.session.id)
    expect(result.deletedMeals).toBe(2)
    expect(await db.mealPlans.count()).toBe(1)
    expect(await db.cookSessions.count()).toBe(1)
    expect(await db.mealPlans.get(other.entries[0]!.id)).toBeTruthy()
  })

  it('removes partially checked purchases and allocations when the last demand disappears', async () => {
    const tomatoKey = shoppingItemKey('Tomaten')
    await db.recipes.put(
      makeRecipe('r1', {
        title: 'Tomaten-Zwiebeln',
        servingsText: '2',
        servingsNumber: 2,
        ingredients: [
          ingredient('i1', 'Tomaten', 4, 'Stück', 0),
          ingredient('i2', 'Zwiebeln', 2, 'Stück', 1),
        ],
      }),
    )
    const dish = await saveDishPlan({
      recipeId: 'r1',
      days: [{ date: TODAY, servings: 2 }],
    })
    const market = await createFreeShoppingList({ name: 'Markt' })
    const organic = await createFreeShoppingList({ name: 'Bioladen' })
    await assignShoppingSubquantity({
      periodStart: TODAY,
      itemKey: tomatoKey,
      dimension: 'count',
      targetListId: market.id,
      quantity: 2,
    })
    await assignShoppingSubquantity({
      periodStart: TODAY,
      itemKey: tomatoKey,
      dimension: 'count',
      targetListId: organic.id,
      quantity: 2,
    })
    await buy(tomatoKey, 2, market.id)

    const before = await getOpenDemandByList(TODAY)
    expect(before.requiresReview).toBe(false)

    await deleteDishPlan(dish.session.id)

    expect(await db.shoppingPurchases.count()).toBe(0)
    expect(await db.shoppingDemandAllocations.count()).toBe(0)
    const after = await getOpenDemandByList(TODAY)
    expect(after.positions).toHaveLength(0)
    expect(after.requiresReview).toBe(false)
    expect(after.serviceConflicts).toHaveLength(0)
    expect(after.conflicts).toHaveLength(0)
  })

  it('removes a quantity-less purchase when the last demand disappears', async () => {
    const mozzarellaKey = shoppingItemKey('Mozzarella')
    await db.recipes.put(
      makeRecipe('r1', {
        title: 'Mozzarella',
        ingredients: [ingredientWithoutQuantity('i1', 'Mozzarella')],
      }),
    )
    const dish = await saveDishPlan({
      recipeId: 'r1',
      days: [{ date: TODAY, servings: 2 }],
    })
    await addShoppingPurchase({
      shoppingDate: TODAY,
      itemKey: mozzarellaKey,
      listId: standardShoppingListId(TODAY),
      periodStart: TODAY,
      amounts: [],
      snapshot: [],
      qualitative: true,
    })

    const before = await getOpenDemandByList(TODAY)
    expect(before.unquantified.some((entry) => entry.itemKey === mozzarellaKey)).toBe(true)
    expect(before.serviceConflicts).toHaveLength(0)

    await deleteDishPlan(dish.session.id)

    expect(await db.shoppingPurchases.count()).toBe(0)
    const after = await getOpenDemandByList(TODAY)
    expect(after.unquantified).toHaveLength(0)
    expect(after.requiresReview).toBe(false)
    expect(after.serviceConflicts).toHaveLength(0)
    expect(after.conflicts).toHaveLength(0)
  })

  it('keeps a quantity-less purchase while another dish still needs the ingredient', async () => {
    const mozzarellaKey = shoppingItemKey('Mozzarella')
    await db.recipes.bulkPut([
      makeRecipe('r1', {
        title: 'Mozzarella A',
        ingredients: [ingredientWithoutQuantity('i1', 'Mozzarella')],
      }),
      makeRecipe('r2', {
        title: 'Mozzarella B',
        ingredients: [ingredientWithoutQuantity('i2', 'Mozzarella')],
      }),
    ])
    const first = await saveDishPlan({
      recipeId: 'r1',
      days: [{ date: TODAY, servings: 2 }],
    })
    await saveDishPlan({
      recipeId: 'r2',
      days: [{ date: '2026-05-26', servings: 2 }],
    })
    await addShoppingPurchase({
      shoppingDate: TODAY,
      itemKey: mozzarellaKey,
      listId: standardShoppingListId(TODAY),
      periodStart: TODAY,
      amounts: [],
      snapshot: [],
      qualitative: true,
    })

    await deleteDishPlan(first.session.id)

    expect(await db.shoppingPurchases.count()).toBe(1)
    const after = await getOpenDemandByList(TODAY)
    expect(after.unquantified.some((entry) => entry.itemKey === mozzarellaKey)).toBe(true)
    expect(after.requiresReview).toBe(false)
    expect(after.serviceConflicts).toHaveLength(0)
  })

  it('keeps a numeric purchase when only quantity-less demand remains', async () => {
    const tomatoKey = shoppingItemKey('Tomaten')
    await db.recipes.bulkPut([
      makeRecipe('r1', {
        title: 'Tomaten mit Menge',
        ingredients: [ingredient('i1', 'Tomaten', 4, 'Stück', 0)],
      }),
      makeRecipe('r2', {
        title: 'Tomaten ohne Menge',
        ingredients: [ingredientWithoutQuantity('i2', 'Tomaten')],
      }),
    ])
    const first = await saveDishPlan({
      recipeId: 'r1',
      days: [{ date: TODAY, servings: 2 }],
    })
    await saveDishPlan({
      recipeId: 'r2',
      days: [{ date: '2026-05-26', servings: 2 }],
    })
    await buy(tomatoKey, 4)

    await deleteDishPlan(first.session.id)

    expect(await db.shoppingPurchases.count()).toBe(1)
    const after = await getOpenDemandByList(TODAY)
    const summary = after.lists.find((entry) => entry.listId === after.standardListId)
    expect(summary).toMatchObject({ openPositions: 0, donePositions: 1 })
    expect(after.requiresReview).toBe(false)
    expect(after.serviceConflicts).toHaveLength(0)
  })

  it('keeps a purchase from a removed numeric share for quantity-less demand', async () => {
    const tomatoKey = shoppingItemKey('Tomaten')
    await db.recipes.bulkPut([
      makeRecipe('r1', {
        title: 'Tomaten mit Menge',
        ingredients: [ingredient('i1', 'Tomaten', 4, 'Stück', 0)],
      }),
      makeRecipe('r2', {
        title: 'Tomaten ohne Menge',
        ingredients: [ingredientWithoutQuantity('i2', 'Tomaten')],
      }),
    ])
    const first = await saveDishPlan({
      recipeId: 'r1',
      days: [{ date: TODAY, servings: 2 }],
    })
    await saveDishPlan({
      recipeId: 'r2',
      days: [{ date: '2026-05-26', servings: 2 }],
    })
    const market = await createFreeShoppingList({ name: 'Markt' })
    await assignShoppingSubquantity({
      periodStart: TODAY,
      itemKey: tomatoKey,
      dimension: 'count',
      targetListId: market.id,
      quantity: 2,
    })
    await buy(tomatoKey, 2, market.id)

    const before = await getOpenDemandByList(TODAY)
    expect(before.serviceConflicts).toHaveLength(0)

    await deleteDishPlan(first.session.id)

    expect(await db.shoppingPurchases.count()).toBe(1)
    expect(await db.shoppingDemandAllocations.count()).toBe(0)
    const after = await getOpenDemandByList(TODAY)
    const summary = after.lists.find((entry) => entry.listId === after.standardListId)
    expect(summary).toMatchObject({ openPositions: 0, donePositions: 1 })
    expect(after.requiresReview).toBe(false)
    expect(after.serviceConflicts).toHaveLength(0)
  })

  it('removes fully checked purchases when the last demand disappears', async () => {
    const tomatoKey = shoppingItemKey('Tomaten')
    const onionKey = shoppingItemKey('Zwiebeln')
    await db.recipes.put(
      makeRecipe('r1', {
        title: 'Tomaten-Zwiebeln',
        servingsText: '2',
        servingsNumber: 2,
        ingredients: [
          ingredient('i1', 'Tomaten', 4, 'Stück', 0),
          ingredient('i2', 'Zwiebeln', 2, 'Stück', 1),
        ],
      }),
    )
    const dish = await saveDishPlan({
      recipeId: 'r1',
      days: [{ date: TODAY, servings: 2 }],
    })
    await buy(tomatoKey, 4)
    await buy(onionKey, 2)

    await deleteDishPlan(dish.session.id)

    expect(await db.shoppingPurchases.count()).toBe(0)
    const after = await getOpenDemandByList(TODAY)
    expect(after.positions).toHaveLength(0)
    expect(after.requiresReview).toBe(false)
    expect(after.serviceConflicts).toHaveLength(0)
    expect(after.conflicts).toHaveLength(0)
  })

  it('keeps purchases and list allocations for an ingredient shared with another dish', async () => {
    const tomatoKey = shoppingItemKey('Tomaten')
    const breadKey = shoppingItemKey('Brötchen')
    await db.recipes.bulkPut([
      makeRecipe('r1', {
        title: 'Tomaten A',
        servingsText: '2',
        servingsNumber: 2,
        ingredients: [ingredient('i1', 'Tomaten', 4, 'Stück', 0)],
      }),
      makeRecipe('r2', {
        title: 'Tomaten B',
        servingsText: '2',
        servingsNumber: 2,
        ingredients: [
          ingredient('i2', 'Tomaten', 4, 'Stück', 0),
          ingredient('i3', 'Brötchen', 2, 'Stück', 1),
        ],
      }),
    ])
    const first = await saveDishPlan({
      recipeId: 'r1',
      days: [{ date: TODAY, servings: 2 }],
    })
    await saveDishPlan({
      recipeId: 'r2',
      days: [{ date: TODAY, servings: 2 }],
    })
    const market = await createFreeShoppingList({ name: 'Markt' })
    await assignShoppingSubquantity({
      periodStart: TODAY,
      itemKey: tomatoKey,
      dimension: 'count',
      targetListId: market.id,
      quantity: 4,
    })
    await buy(tomatoKey, 2, market.id)
    await buy(breadKey, 2)

    await deleteDishPlan(first.session.id)

    expect(await db.shoppingPurchases.count()).toBe(2)
    expect(await db.shoppingDemandAllocations.count()).toBe(1)
    expect(await db.mealPlans.count()).toBe(1)
    expect(await db.cookSessions.count()).toBe(1)

    const view = await getOpenDemandByList(TODAY)
    const position = view.positions.find(
      (entry) => entry.itemKey === tomatoKey && entry.listId === market.id,
    )
    expect(position).toMatchObject({
      assignedLower: 4,
      purchasedLower: 2,
      openLower: 2,
    })
    const breadPosition = view.positions.find(
      (entry) => entry.itemKey === breadKey,
    )
    expect(breadPosition).toMatchObject({
      assignedLower: 2,
      purchasedLower: 2,
      openLower: 0,
    })
    expect(view.requiresReview).toBe(false)
    expect(view.serviceConflicts).toHaveLength(0)
  })

  it('leaves manual articles and their purchases on other lists untouched', async () => {
    await db.recipes.put(
      makeRecipe('r1', {
        title: 'Tomaten',
        servingsText: '2',
        servingsNumber: 2,
        ingredients: [ingredient('i1', 'Tomaten', 4, 'Stück', 0)],
      }),
    )
    const dish = await saveDishPlan({
      recipeId: 'r1',
      days: [{ date: TODAY, servings: 2 }],
    })
    const drogerie = await createFreeShoppingList({ name: 'Drogerie' })
    const manual = await createManualListItem({
      listId: drogerie.id,
      name: 'Zahnpasta',
      quantityText: '1',
      unit: 'Stück',
      shoppingDate: TODAY,
    })
    await setManualItemPurchased(manual.id, true)

    await deleteDishPlan(dish.session.id)

    expect(await db.shoppingManualItems.count()).toBe(1)
    expect(await db.shoppingPurchases.count()).toBe(1)
    expect(await db.shoppingLists.get(drogerie.id)).toBeTruthy()
    const view = await getOpenDemandByList(TODAY)
    expect(view.requiresReview).toBe(false)
    expect(
      view.manualItems.some(
        (entry) => entry.manualItem.id === manual.id && entry.done,
      ),
    ).toBe(true)
  })

  it('cleans shopping rows when deleting a recipe with planned cooking events', async () => {
    const tomatoKey = shoppingItemKey('Tomaten')
    const breadKey = shoppingItemKey('Brötchen')
    await db.recipes.bulkPut([
      makeRecipe('r1', {
        title: 'Tomaten',
        servingsText: '2',
        servingsNumber: 2,
        ingredients: [ingredient('i1', 'Tomaten', 4, 'Stück', 0)],
      }),
      makeRecipe('r2', {
        title: 'Brötchen',
        servingsText: '2',
        servingsNumber: 2,
        ingredients: [ingredient('i2', 'Brötchen', 2, 'Stück', 0)],
      }),
    ])
    await saveDishPlan({
      recipeId: 'r1',
      days: [{ date: TODAY, servings: 2 }],
    })
    await saveDishPlan({
      recipeId: 'r2',
      days: [{ date: TODAY, servings: 2 }],
    })
    const market = await createFreeShoppingList({ name: 'Markt' })
    await assignShoppingSubquantity({
      periodStart: TODAY,
      itemKey: tomatoKey,
      dimension: 'count',
      targetListId: market.id,
      quantity: 2,
    })
    await buy(tomatoKey, 2, market.id)
    await buy(breadKey, 2)

    await deleteRecipe('r1')

    expect(await db.recipes.get('r1')).toBeUndefined()
    expect(await db.cookSessions.count()).toBe(1)
    expect(await db.mealPlans.count()).toBe(1)
    expect(await db.shoppingPurchases.count()).toBe(1)
    expect(await db.shoppingDemandAllocations.count()).toBe(0)
    const view = await getOpenDemandByList(TODAY)
    expect(view.positions.some((entry) => entry.itemKey === tomatoKey)).toBe(false)
    expect(
      view.positions.find((entry) => entry.itemKey === breadKey),
    ).toMatchObject({ assignedLower: 2, purchasedLower: 2, openLower: 0 })
    expect(view.requiresReview).toBe(false)
  })

  it('requires explicit confirmation before redefining a cooked amount', async () => {
    const first = await saveDishPlan({
      recipeId: 'r1',
      slot: 'dinner',
      days: [
        { date: TODAY, servings: 2 },
        { date: '2026-05-26', servings: 2 },
      ],
    })
    await setDishPlanCooked(first.session.id, true)

    await expect(
      saveDishPlan({
        cookSessionId: first.session.id,
        recipeId: 'r1',
        slot: 'dinner',
        days: [
          {
            entryId: first.entries[0]!.id,
            date: first.entries[0]!.date,
            servings: 1,
          },
        ],
      }),
    ).rejects.toBeInstanceOf(CookedPlanConflictError)

    const confirmed = await saveDishPlan({
      cookSessionId: first.session.id,
      recipeId: 'r1',
      slot: 'dinner',
      days: [
        {
          entryId: first.entries[0]!.id,
          date: first.entries[0]!.date,
          servings: 1,
        },
      ],
      allowCookedChange: true,
    })
    expect(confirmed.session.servings).toBe(1)
    expect(confirmed.session.status).toBe('cooked')
  })

  it('adopts an old appointment without losing data or creating a parallel plan', async () => {
    const legacy = legacyEntry('plan-old-1', TODAY)
    const untouched = legacyEntry('plan-old-2', '2026-05-27')
    await db.mealPlans.bulkAdd([legacy, untouched])

    const result = await saveDishPlan({
      recipeId: 'r1',
      slot: 'dinner',
      days: [{ entryId: legacy.id, date: legacy.date, servings: 3 }],
    })

    expect(result.entries[0]?.id).toBe(legacy.id)
    expect(result.entries[0]?.cookSessionId).toBe(result.session.id)
    expect((await db.mealPlans.get(legacy.id))?.recipeId).toBe('r1')
    expect(await db.mealPlans.get(untouched.id)).toEqual(untouched)
    expect(await db.recipes.count()).toBe(3)
  })

  it('repairs an old appointment whose cooking event is missing', async () => {
    const broken = { ...legacyEntry('plan-broken', TODAY), cookSessionId: 'cook-missing' }
    await db.mealPlans.put(broken)

    const result = await saveDishPlan({
      recipeId: 'r1',
      slot: 'dinner',
      days: [{ entryId: broken.id, date: broken.date, servings: 2 }],
    })

    expect(result.entries[0]?.id).toBe(broken.id)
    expect(result.entries[0]?.cookSessionId).toBe(result.session.id)
    expect((await db.mealPlans.get(broken.id))?.cookSessionId).toBe(result.session.id)
    expect(await db.mealPlans.count()).toBe(1)
  })

  it('never overwrites a manual multi-day dish by the automatic planner', async () => {
    const group = await saveDishPlan({
      recipeId: 'r1',
      slot: 'dinner',
      days: [
        { date: TODAY, servings: 2 },
        { date: '2026-05-26', servings: 1 },
        { date: '2026-05-27', servings: 3 },
      ],
    })

    await generatePlan({ today: TODAY, seed: 4, restarts: 1 })

    const stored = await db.mealPlans.where('date').anyOf([
      '2026-05-25',
      '2026-05-26',
      '2026-05-27',
    ]).toArray()
    expect(stored).toHaveLength(3)
    expect(stored.every((entry) => entry.cookSessionId === group.session.id)).toBe(true)
    expect(stored.every((entry) => entry.auto === false)).toBe(true)
    expect((await db.cookSessions.get(group.session.id))?.servings).toBe(6)
  })

  it('does not add an automatic dish to a day with a manual legacy-slot dish', async () => {
    const manual = { ...legacyEntry('manual-lunch', TODAY), slot: 'lunch' }
    await db.mealPlans.put(manual)

    await generatePlan({ today: TODAY, seed: 7, restarts: 1 })

    const sameDay = await db.mealPlans.where('date').equals(TODAY).toArray()
    expect(sameDay).toHaveLength(1)
    expect(sameDay[0]?.id).toBe(manual.id)
    expect(sameDay[0]?.slot).toBe('lunch')
  })

  it('stores a user correction for an unclear original serving count', async () => {
    await db.recipes.put(
      makeRecipe('r4', { servingsNumber: null, servingsText: 'für viele' }),
    )
    await saveDishPlan({
      recipeId: 'r4',
      slot: 'dinner',
      days: [{ date: TODAY, servings: 6 }],
      originalServings: 4,
    })
    const corrected = await db.recipes.get('r4')
    expect(corrected?.servingsNumber).toBe(4)
    expect(corrected?.ingredients[0]?.quantityText).toBe('400')
    expect(corrected?.servingsText).toBe('für viele')
  })
})
