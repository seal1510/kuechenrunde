import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../db'
import { addDays } from '../domain/dates'
import type { Recipe } from '../types'
import {
  generatePlan,
  getHouseholdSize,
  PRIMARY_SLOT,
  setCooked,
  setDaySkipped,
  setHouseholdSize,
  setMealRecipe,
  setPinned,
} from './service'

const TODAY = '2026-05-25'

function makeRecipe(id: string): Recipe {
  return {
    id,
    importId: `mela-${id}`,
    importSource: 'mela',
    title: `Rezept ${id}`,
    description: '',
    ingredientGroups: [],
    ingredients: [],
    instructions: [],
    servingsText: '2',
    servingsNumber: 2,
    prepTime: '',
    cookTime: '',
    totalTime: '30 min',
    categories: [id === 'r2' ? 'Fleisch' : 'Pasta'],
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
  }
}

beforeEach(async () => {
  await db.mealPlans.clear()
  await db.mealDays.clear()
  await db.settings.clear()
  await db.shoppingLists.clear()
  // These historical tests assume a Monday-based planning week. The product
  // default is now the configured shopping day; the explicit test setting keeps
  // the existing expectations deterministic.
  await db.settings.put({ key: 'shoppingPeriodStartDay', value: 0 })
  await db.recipes.clear()
  await db.images.clear()
  await db.recipes.bulkAdd([makeRecipe('r1'), makeRecipe('r2'), makeRecipe('r3')])
})

describe('week plan service', () => {
  it('creates and persists a plan for today through Sunday', async () => {
    const outcome = await generatePlan({ today: TODAY, seed: 1, restarts: 2 })
    expect(outcome.dates).toHaveLength(7)
    expect(outcome.plan).toBeTruthy()
    expect(outcome.emptyDates).toHaveLength(4) // three recipes, ten-day cool-down

    const entries = await db.mealPlans.where('date').anyOf(outcome.dates).toArray()
    expect(entries).toHaveLength(3)
    expect(entries.every((entry) => entry.auto)).toBe(true)
    expect(entries.every((entry) => entry.slot === PRIMARY_SLOT)).toBe(true)
    expect(entries.every((entry) => entry.reasons.length > 0)).toBe(true)

    // Simulate a reload: the rows are still there with their reasons.
    const first = entries[0]!
    const stored = await db.mealPlans.get(first.id)
    expect(stored?.recipeId).toBe(first.recipeId)
    expect(stored?.reasons).toEqual(first.reasons)
  })

  it('keeps pinned entries when regenerating', async () => {
    const date = TODAY
    await db.mealPlans.put({
      id: 'pinned-1',
      date,
      slot: PRIMARY_SLOT,
      recipeId: 'r1',
      auto: false,
      pinned: true,
      leftover: false,
      cooked: false,
      reasons: [],
      createdAt: 1,
      updatedAt: 1,
    })

    await generatePlan({ today: TODAY, seed: 7, restarts: 1 })
    const kept = await db.mealPlans.get('pinned-1')
    expect(kept?.recipeId).toBe('r1')
    expect(kept?.pinned).toBe(true)
  })

  it('leaves skipped days empty and deletes their previous dish', async () => {
    const date = addDays(TODAY, 1)
    await setMealRecipe(date, 'r2')
    expect(await db.mealPlans.where('date').equals(date).count()).toBe(1)

    await setDaySkipped(date, true)
    expect(await db.mealPlans.where('date').equals(date).count()).toBe(0)
    expect((await db.mealDays.get(date))?.skipped).toBe(true)

    await generatePlan({ today: TODAY, seed: 3, restarts: 1 })
    expect(await db.mealPlans.where('date').equals(date).count()).toBe(0)
  })

  it('supports manual swap, pin, unskip and cooked flag', async () => {
    const date = addDays(TODAY, 2)
    await setDaySkipped(date, true)
    await setMealRecipe(date, 'r3')

    const entry = await db.mealPlans.where('[date+slot]').equals([date, PRIMARY_SLOT]).first()
    expect(entry?.recipeId).toBe('r3')
    expect(entry?.auto).toBe(false)
    expect(entry?.reasons).toEqual([])
    expect((await db.mealDays.get(date))?.skipped).toBe(false)

    await setPinned(date, true)
    expect((await db.mealPlans.get(entry!.id))?.pinned).toBe(true)

    await setCooked(date, true)
    expect((await db.mealPlans.get(entry!.id))?.cooked).toBe(true)
  })

  it('stores household size with a safe default and bounds', async () => {
    expect(await getHouseholdSize()).toBe(2)
    await setHouseholdSize(4)
    expect(await getHouseholdSize()).toBe(4)
    await setHouseholdSize(0)
    expect(await getHouseholdSize()).toBe(1)
    await setHouseholdSize(99)
    expect(await getHouseholdSize()).toBe(20)
  })
})
