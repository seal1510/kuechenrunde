import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../db'
import { addDays } from '../domain/dates'
import { cookSessionBalance } from '../domain/mealplan'
import type { Recipe } from '../types'
import {
  deleteCookSession,
  generatePlan,
  MealPlanError,
  removeMealEntry,
  saveMeal,
  setCookSessionStatus,
  setMealStatus,
  updateCookSession,
} from './service'

const TODAY = '2026-05-25'

function makeRecipe(id: string, overrides: Partial<Recipe> = {}): Recipe {
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
    ...overrides,
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
  await db.cookSessions.clear()
  await db.recipes.clear()
  await db.images.clear()
  await db.recipes.bulkAdd([makeRecipe('r1'), makeRecipe('r2'), makeRecipe('r3')])
})

describe('manual meal planning', () => {
  it('stores several meals and dishes per day with individual portions', async () => {
    const morning = await saveMeal({
      date: TODAY,
      slot: 'breakfast',
      recipeId: 'r1',
      servings: 1,
      source: 'fresh',
      cookServings: 2,
    })
    await saveMeal({
      date: TODAY,
      slot: 'lunch',
      recipeId: 'r2',
      servings: 3,
      source: 'fresh',
      cookServings: 3,
    })
    const dinnerA = await saveMeal({
      date: TODAY,
      slot: 'dinner',
      recipeId: 'r1',
      servings: 2,
      source: 'fresh',
      cookServings: 4,
    })
    const dinnerB = await saveMeal({
      date: TODAY,
      slot: 'dinner',
      recipeId: 'r3',
      servings: 1,
      source: 'fresh',
      cookServings: 1,
    })

    const entries = await db.mealPlans.where('date').equals(TODAY).toArray()
    expect(entries).toHaveLength(4)
    expect(entries.filter((entry) => entry.slot === 'dinner')).toHaveLength(2)
    expect(morning.servings).toBe(1)
    expect(dinnerA.servings).toBe(2)
    expect(dinnerB.servings).toBe(1)
    expect(dinnerA.id).not.toBe(dinnerB.id)
    expect(dinnerA.position).toBe(0)
    expect(dinnerB.position).toBe(1)
  })

  it('lets one cooking event feed several meals across days, weeks and years', async () => {
    const cookDate = '2026-12-31'
    const monday = await saveMeal({
      date: cookDate,
      slot: 'dinner',
      recipeId: 'r1',
      servings: 2,
      source: 'fresh',
      cookServings: 6,
    })
    const sessionId = monday.cookSessionId!
    expect(sessionId).toBeTruthy()

    const tuesday = await saveMeal({
      date: '2027-01-02',
      slot: 'dinner',
      recipeId: 'r1',
      servings: 2,
      source: 'leftover',
      cookSessionId: sessionId,
    })
    const later = await saveMeal({
      date: '2027-02-15',
      slot: 'lunch',
      recipeId: 'r1',
      servings: 2,
      source: 'leftover',
      cookSessionId: sessionId,
    })

    expect(monday.cookSessionId).toBe(tuesday.cookSessionId)
    expect(later.cookSessionId).toBe(sessionId)
    expect(await db.cookSessions.count()).toBe(1)
    const session = (await db.cookSessions.get(sessionId))!
    expect(cookSessionBalance(session, [monday, tuesday, later])).toEqual({
      provided: 6,
      assigned: 6,
      remaining: 0,
      overAssigned: false,
    })
  })

  it('frees portions when a meal is removed or reduced and rejects over-assignment', async () => {
    const first = await saveMeal({
      date: TODAY,
      slot: 'dinner',
      recipeId: 'r1',
      servings: 2,
      source: 'fresh',
      cookServings: 5,
    })
    const sessionId = first.cookSessionId!
    const second = await saveMeal({
      date: addDays(TODAY, 1),
      slot: 'dinner',
      recipeId: 'r1',
      servings: 2,
      source: 'leftover',
      cookSessionId: sessionId,
    })

    await expect(
      saveMeal({
        date: addDays(TODAY, 2),
        slot: 'dinner',
        recipeId: 'r1',
        servings: 2,
        source: 'leftover',
        cookSessionId: sessionId,
      }),
    ).rejects.toThrow(MealPlanError)

    const reduced = await saveMeal({
      id: second.id,
      date: second.date,
      slot: second.slot,
      recipeId: 'r1',
      servings: 1,
      source: 'leftover',
      cookSessionId: sessionId,
    })
    expect(reduced.servings).toBe(1)
    let session = (await db.cookSessions.get(sessionId))!
    let balance = cookSessionBalance(session, await db.mealPlans.toArray())
    expect(balance.remaining).toBe(2)

    await removeMealEntry(second.id)
    session = (await db.cookSessions.get(sessionId))!
    balance = cookSessionBalance(session, await db.mealPlans.toArray())
    expect(balance.remaining).toBe(3)
  })

  it('refuses to shrink a cooking event below its assigned portions', async () => {
    const meal = await saveMeal({
      date: TODAY,
      slot: 'dinner',
      recipeId: 'r1',
      servings: 3,
      source: 'fresh',
      cookServings: 6,
    })
    await expect(updateCookSession(meal.cookSessionId!, { servings: 2 })).rejects.toThrow(
      'nicht unter 3 Portionen',
    )
    await expect(
      saveMeal({
        id: meal.id,
        date: meal.date,
        slot: meal.slot,
        recipeId: meal.recipeId!,
        servings: meal.servings ?? 3,
        source: 'fresh',
        cookServings: 1,
      }),
    ).rejects.toThrow(MealPlanError)
  })

  it('handles deletion of a cooking event with linked meals explicitly', async () => {
    const first = await saveMeal({
      date: TODAY,
      slot: 'dinner',
      recipeId: 'r1',
      servings: 2,
      source: 'fresh',
      cookServings: 4,
    })
    await saveMeal({
      date: addDays(TODAY, 1),
      slot: 'dinner',
      recipeId: 'r1',
      servings: 2,
      source: 'leftover',
      cookSessionId: first.cookSessionId!,
    })

    const detached = await deleteCookSession(first.cookSessionId!, 'detach')
    expect(detached.detached).toBe(2)
    expect(await db.mealPlans.count()).toBe(2)
    expect(await db.cookSessions.count()).toBe(0)
    expect((await db.mealPlans.toArray()).every((entry) => !entry.cookSessionId)).toBe(true)

    const again = await saveMeal({
      date: TODAY,
      slot: 'dinner',
      recipeId: 'r1',
      servings: 2,
      source: 'fresh',
      cookServings: 2,
    })
    const deleted = await deleteCookSession(again.cookSessionId!, 'delete-meals')
    expect(deleted.deletedMeals).toBe(1)
    // The two detached meals from above stay; only the linked one was removed.
    expect(await db.mealPlans.count()).toBe(2)
  })

  it('keeps eaten/cooked status separate from the cooking event status', async () => {
    const meal = await saveMeal({
      date: TODAY,
      slot: 'dinner',
      recipeId: 'r1',
      servings: 2,
      source: 'fresh',
      cookServings: 4,
    })
    await setMealStatus(meal.id, 'eaten')
    expect((await db.mealPlans.get(meal.id))?.cooked).toBe(true)
    expect((await db.cookSessions.get(meal.cookSessionId!))?.status).toBe('planned')

    await setCookSessionStatus(meal.cookSessionId!, 'cooked')
    expect((await db.cookSessions.get(meal.cookSessionId!))?.status).toBe('cooked')
    expect((await db.mealPlans.get(meal.id))?.status).toBe('eaten')
  })
})

describe('automatic planner and manual priority', () => {
  it('never replaces manual, pinned, eaten or cooked entries', async () => {
    const manual = await saveMeal({
      date: TODAY,
      slot: 'dinner',
      recipeId: 'r1',
      servings: 2,
      source: 'fresh',
      cookServings: 4,
      auto: false,
    })

    const outcome = await generatePlan({ today: TODAY, seed: 2, restarts: 1 })
    expect(outcome.protectedMeals).toBe(1)
    expect((await db.mealPlans.get(manual.id))?.recipeId).toBe('r1')
    expect((await db.mealPlans.get(manual.id))?.auto).toBe(false)

    const autoEntries = (await db.mealPlans.toArray()).filter((entry) => entry.auto)
    expect(autoEntries.length).toBeGreaterThan(0)
    const pinned = autoEntries[0]!
    await db.mealPlans.put({ ...pinned, pinned: true })
    const pinnedSession = await db.cookSessions.get(pinned.cookSessionId!)
    await db.cookSessions.put({ ...pinnedSession!, status: 'cooked' })

    await generatePlan({ today: TODAY, seed: 9, restarts: 1 })
    expect(await db.mealPlans.get(pinned.id)).toBeTruthy()
    expect((await db.mealPlans.get(pinned.id))?.pinned).toBe(true)

    const other = (await db.mealPlans.toArray()).find(
      (entry) => entry.auto && entry.id !== pinned.id && !entry.pinned,
    )
    if (other) {
      await setMealStatus(other.id, 'eaten')
      await generatePlan({ today: TODAY, seed: 11, restarts: 1 })
      expect((await db.mealPlans.get(other.id))?.status).toBe('eaten')
    }
  })

  it('creates cooking events for automatic dinners and reuses them for leftover suggestions', async () => {
    await generatePlan({ today: TODAY, seed: 4, restarts: 1 })
    const entries = await db.mealPlans.toArray()
    const sessions = await db.cookSessions.toArray()
    expect(entries.every((entry) => Boolean(entry.cookSessionId))).toBe(true)
    expect(sessions.length).toBeGreaterThan(0)
    const sessionIds = new Set(sessions.map((session) => session.id))
    for (const entry of entries) expect(sessionIds.has(entry.cookSessionId!)).toBe(true)

    const leftovers = entries.filter((entry) => entry.leftover)
    for (const leftover of leftovers) {
      const source = await db.cookSessions.get(leftover.cookSessionId!)
      expect(source).toBeTruthy()
      expect(source!.recipeId).toBe(leftover.recipeId)
    }
  })

  it('leaves manual entries in other slots untouched by a replan', async () => {
    const lunch = await saveMeal({
      date: addDays(TODAY, 1),
      slot: 'lunch',
      recipeId: 'r2',
      servings: 1,
      source: 'fresh',
      cookServings: 1,
    })
    await generatePlan({ today: TODAY, seed: 5, restarts: 1 })
    await generatePlan({ today: TODAY, seed: 6, restarts: 1 })
    expect((await db.mealPlans.get(lunch.id))?.recipeId).toBe('r2')
    expect((await db.mealPlans.get(lunch.id))?.auto).toBe(false)
  })
})
