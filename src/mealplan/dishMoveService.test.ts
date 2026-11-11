import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../db'
import { buildCalendarWindow } from '../domain/calendar'
import { scalePlan } from '../domain/dishplan'
import { buildShoppingList } from '../domain/shopping'
import type { Recipe } from '../types'
import {
  CookedMoveConflictError,
  DishPlanMoveConflictError,
  dishPlanMoveSignature,
  moveDishPlanEntry,
  saveDishPlan,
  setDishPlanCooked,
  undoDishPlanMove,
} from './dishService'

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

async function seedGroup(recipeId = 'r1') {
  return saveDishPlan({
    recipeId,
    days: [
      { date: '2026-05-29', servings: 2 },
      { date: '2026-05-30', servings: 3 },
      { date: '2026-06-01', servings: 1 },
    ],
  })
}

beforeEach(async () => {
  await db.mealPlans.clear()
  await db.mealDays.clear()
  await db.settings.clear()
  await db.cookSessions.clear()
  await db.dayNotes.clear()
  await db.recipes.clear()
  await db.images.clear()
  await db.recipes.bulkAdd([
    makeRecipe('r1'),
    makeRecipe('r2', { title: 'Rezept r2' }),
  ])
})

describe('moving planned dishes', () => {
  it('moves a single dish to another day without changing its identity', async () => {
    const created = await saveDishPlan({
      recipeId: 'r1',
      days: [{ date: '2026-05-25', servings: 2 }],
    })
    const entry = created.entries[0]!

    const moved = await moveDishPlanEntry(entry.id, '2026-05-27')

    expect(moved.moved).toBe(true)
    expect(moved.deltaDays).toBe(2)
    expect(moved.entries).toHaveLength(1)
    expect(moved.entries[0]?.id).toBe(entry.id)
    expect(moved.entries[0]?.date).toBe('2026-05-27')
    expect(moved.entries[0]?.servings).toBe(2)
    expect(moved.session?.id).toBe(created.session.id)
    expect(moved.session?.date).toBe('2026-05-27')
    expect(moved.session?.servings).toBe(2)
  })

  it('moves a whole group by the dragged date difference and keeps gaps', async () => {
    const created = await seedGroup()
    const friday = created.entries.find((entry) => entry.date === '2026-05-29')!

    const moved = await moveDishPlanEntry(friday.id, '2026-05-31')

    expect(moved.deltaDays).toBe(2)
    expect(moved.entries.map((entry) => entry.date)).toEqual([
      '2026-05-31',
      '2026-06-01',
      '2026-06-03',
    ])
    expect(moved.entries.map((entry) => entry.servings)).toEqual([2, 3, 1])
    expect(moved.entries.map((entry) => entry.id)).toEqual(
      created.entries.map((entry) => entry.id),
    )
    expect(moved.session?.date).toBe('2026-05-31')
    expect(moved.session?.servings).toBe(6)
    expect(await db.cookSessions.count()).toBe(1)
    expect(await db.mealPlans.count()).toBe(3)

    // Moving never rewrites the recipe: only the dates of the appointments change.
    const recipe = (await db.recipes.get('r1'))!
    expect(recipe.ingredients[0]?.quantityText).toBe('400')
    const scaled = scalePlan(
      recipe,
      moved.entries.map((entry) => ({
        date: entry.date,
        servings: entry.servings ?? 0,
      })),
    )
    expect(scaled.totalServings).toBe(6)
    expect(scaled.scaling.items[0]?.quantityText).toBe('600')
  })

  it('uses the middle group entry as anchor when it is dragged', async () => {
    const created = await seedGroup()
    const saturday = created.entries.find((entry) => entry.date === '2026-05-30')!

    const moved = await moveDishPlanEntry(saturday.id, '2026-06-01')

    expect(moved.deltaDays).toBe(2)
    expect(moved.entries.map((entry) => entry.date)).toEqual([
      '2026-05-31',
      '2026-06-01',
      '2026-06-03',
    ])
    expect(moved.session?.date).toBe('2026-05-31')
  })

  it('uses the last group entry as anchor when it is dragged', async () => {
    const created = await seedGroup()
    const monday = created.entries.find((entry) => entry.date === '2026-06-01')!

    const moved = await moveDishPlanEntry(monday.id, '2026-06-03')

    expect(moved.deltaDays).toBe(2)
    expect(moved.entries.map((entry) => entry.date)).toEqual([
      '2026-05-31',
      '2026-06-01',
      '2026-06-03',
    ])
    expect(moved.session?.date).toBe('2026-05-31')
  })

  it('never overwrites another dish on an occupied target day', async () => {
    const first = await saveDishPlan({
      recipeId: 'r1',
      days: [{ date: '2026-05-29', servings: 2 }],
    })
    const other = await saveDishPlan({
      recipeId: 'r2',
      days: [{ date: '2026-05-31', servings: 1 }],
    })

    const moved = await moveDishPlanEntry(first.entries[0]!.id, '2026-05-31')

    expect(moved.entries[0]?.date).toBe('2026-05-31')
    const targetEntries = await db.mealPlans.where('date').equals('2026-05-31').toArray()
    expect(targetEntries.map((entry) => entry.id).sort()).toEqual(
      [first.entries[0]!.id, other.entries[0]!.id].sort(),
    )
    const otherAfter = await db.mealPlans.get(other.entries[0]!.id)
    expect(otherAfter).toEqual(other.entries[0])
    expect((await db.cookSessions.get(other.session.id))?.date).toBe('2026-05-31')
  })

  it('accepts dates outside the visible core week, including overlap days', async () => {
    const before = await saveDishPlan({
      recipeId: 'r1',
      days: [{ date: '2026-05-29', servings: 2 }],
    })
    const after = await saveDishPlan({
      recipeId: 'r2',
      days: [{ date: '2026-05-29', servings: 1 }],
    })

    const window = buildCalendarWindow('2026-05-29', 3, 2, 2)
    expect(window.beforeDays).toContain('2026-05-27')
    expect(window.afterDays).toContain('2026-06-04')

    const movedBefore = await moveDishPlanEntry(before.entries[0]!.id, '2026-05-27')
    const movedAfter = await moveDishPlanEntry(after.entries[0]!.id, '2026-06-04')

    expect(movedBefore.entries[0]?.date).toBe('2026-05-27')
    expect(movedAfter.entries[0]?.date).toBe('2026-06-04')
  })

  it('crosses month and year boundaries while keeping the cooking date earliest', async () => {
    const created = await saveDishPlan({
      recipeId: 'r1',
      days: [
        { date: '2026-12-30', servings: 2 },
        { date: '2027-01-01', servings: 1 },
      ],
    })
    const first = created.entries.find((entry) => entry.date === '2026-12-30')!

    const moved = await moveDishPlanEntry(first.id, '2027-01-02')

    expect(moved.deltaDays).toBe(3)
    expect(moved.entries.map((entry) => entry.date)).toEqual([
      '2027-01-02',
      '2027-01-04',
    ])
    expect(moved.session?.date).toBe('2027-01-02')
    expect(moved.session?.servings).toBe(3)
  })

  it('moves a dish two weeks ahead without losing its portions', async () => {
    const created = await saveDishPlan({
      recipeId: 'r1',
      days: [{ date: '2026-11-11', servings: 2 }],
    })
    const entry = created.entries[0]!

    const moved = await moveDishPlanEntry(entry.id, '2026-11-25')

    expect(moved.deltaDays).toBe(14)
    expect(moved.entries[0]?.date).toBe('2026-11-25')
    expect(moved.entries[0]?.servings).toBe(2)
    expect(moved.session?.date).toBe('2026-11-25')
    expect(moved.session?.servings).toBe(2)
  })

  it('moves a dish one week backwards', async () => {
    const created = await saveDishPlan({
      recipeId: 'r1',
      days: [{ date: '2026-11-11', servings: 2 }],
    })
    const entry = created.entries[0]!

    const moved = await moveDishPlanEntry(entry.id, '2026-11-04')

    expect(moved.deltaDays).toBe(-7)
    expect(moved.entries[0]?.date).toBe('2026-11-04')
    expect(moved.entries[0]?.servings).toBe(2)
    expect(moved.session?.date).toBe('2026-11-04')
    expect(moved.session?.servings).toBe(2)
  })

  it('moves Wednesday 11.11. to Friday 13.11. and shifts shopping demand to the next week', async () => {
    const created = await saveDishPlan({
      recipeId: 'r1',
      days: [{ date: '2026-11-11', servings: 2 }],
    })
    const entry = created.entries[0]!
    const recipes = await db.recipes.toArray()
    const sessionsBefore = await db.cookSessions.toArray()
    const beforeWeek = buildShoppingList({
      anchor: '2026-11-11',
      weekStartDay: 3,
      recipes,
      freeDishes: [],
      cookSessions: sessionsBefore,
      manualItems: [],
      rules: [],
    })
    expect(beforeWeek.week.start).toBe('2026-11-05')
    expect(beforeWeek.week.end).toBe('2026-11-11')
    expect(beforeWeek.items.some((item) => item.name.includes('Spaghetti'))).toBe(true)

    const moved = await moveDishPlanEntry(entry.id, '2026-11-13')

    expect(moved.deltaDays).toBe(2)
    expect(moved.entries[0]?.date).toBe('2026-11-13')
    expect(moved.entries[0]?.servings).toBe(2)
    expect(moved.session?.date).toBe('2026-11-13')
    expect(moved.session?.servings).toBe(2)
    expect((await db.recipes.get('r1'))?.ingredients[0]?.quantityText).toBe('400')

    const sessionsAfter = await db.cookSessions.toArray()
    const afterOldWeek = buildShoppingList({
      anchor: '2026-11-11',
      weekStartDay: 3,
      recipes,
      freeDishes: [],
      cookSessions: sessionsAfter,
      manualItems: [],
      rules: [],
    })
    const afterNextWeek = buildShoppingList({
      anchor: '2026-11-12',
      weekStartDay: 3,
      recipes,
      freeDishes: [],
      cookSessions: sessionsAfter,
      manualItems: [],
      rules: [],
    })

    expect(afterOldWeek.items.some((item) => item.name.includes('Spaghetti'))).toBe(false)
    expect(afterNextWeek.week.start).toBe('2026-11-12')
    expect(afterNextWeek.week.end).toBe('2026-11-18')
    expect(
      afterNextWeek.items.some((item) => item.name.includes('Spaghetti')),
    ).toBe(true)
  })

  it('leaves all other dishes and their cooking events untouched', async () => {
    const group = await seedGroup()
    const other = await saveDishPlan({
      recipeId: 'r2',
      days: [
        { date: '2026-05-29', servings: 1 },
        { date: '2026-06-02', servings: 4 },
      ],
    })
    const beforeOther = await db.mealPlans
      .where('cookSessionId')
      .equals(other.session.id)
      .toArray()
    const beforeSession = await db.cookSessions.get(other.session.id)

    await moveDishPlanEntry(group.entries[0]!.id, '2026-05-31')

    const afterOther = await db.mealPlans
      .where('cookSessionId')
      .equals(other.session.id)
      .toArray()
    expect(afterOther.sort((a, b) => (a.date < b.date ? -1 : 1))).toEqual(
      beforeOther.sort((a, b) => (a.date < b.date ? -1 : 1)),
    )
    expect(await db.cookSessions.get(other.session.id)).toEqual(beforeSession)
  })

  it('moves automatically generated dishes as normal planned dishes', async () => {
    const created = await saveDishPlan({
      recipeId: 'r1',
      days: [{ date: '2026-05-29', servings: 2 }],
      auto: true,
    })

    const moved = await moveDishPlanEntry(created.entries[0]!.id, '2026-05-30')

    expect(moved.entries[0]?.date).toBe('2026-05-30')
    expect(moved.entries[0]?.auto).toBe(true)
    expect(moved.session?.auto).toBe(true)
  })

  it('does not change anything when dropped on the original day', async () => {
    const created = await saveDishPlan({
      recipeId: 'r1',
      days: [{ date: '2026-05-29', servings: 2 }],
    })
    const before = await db.mealPlans.get(created.entries[0]!.id)

    const result = await moveDishPlanEntry(created.entries[0]!.id, '2026-05-29')

    expect(result.moved).toBe(false)
    expect(result.deltaDays).toBe(0)
    expect(await db.mealPlans.get(created.entries[0]!.id)).toEqual(before)
    expect(await db.cookSessions.get(created.session.id)).toEqual(created.session)
  })

  it('rejects invalid targets and missing entries without partial changes', async () => {
    const created = await saveDishPlan({
      recipeId: 'r1',
      days: [{ date: '2026-05-29', servings: 2 }],
    })
    const entriesBefore = await db.mealPlans.toArray()
    const sessionsBefore = await db.cookSessions.toArray()

    await expect(
      moveDishPlanEntry(created.entries[0]!.id, '2026-13-01'),
    ).rejects.toThrow('Ungültiges Zieldatum')
    await expect(
      moveDishPlanEntry('missing-entry', '2026-05-30'),
    ).rejects.toThrow('existiert nicht mehr')

    expect(await db.mealPlans.toArray()).toEqual(entriesBefore)
    expect(await db.cookSessions.toArray()).toEqual(sessionsBefore)
  })

  it('requires explicit confirmation before moving a cooked dish', async () => {
    const created = await saveDishPlan({
      recipeId: 'r1',
      days: [
        { date: '2026-05-29', servings: 2 },
        { date: '2026-05-30', servings: 2 },
      ],
    })
    await setDishPlanCooked(created.session.id, true)
    const before = await db.mealPlans.toArray()

    await expect(
      moveDishPlanEntry(created.entries[0]!.id, '2026-05-31'),
    ).rejects.toBeInstanceOf(CookedMoveConflictError)

    expect(await db.mealPlans.toArray()).toEqual(before)
    expect((await db.cookSessions.get(created.session.id))?.date).toBe('2026-05-29')

    const moved = await moveDishPlanEntry(created.entries[0]!.id, '2026-05-31', {
      allowCookedChange: true,
    })
    expect(moved.entries.map((entry) => entry.date)).toEqual([
      '2026-05-31',
      '2026-06-01',
    ])
    expect((await db.cookSessions.get(created.session.id))?.status).toBe('cooked')
    expect((await db.cookSessions.get(created.session.id))?.servings).toBe(4)
  })

  it('clears a skipped target day and keeps empty source days free', async () => {
    const created = await saveDishPlan({
      recipeId: 'r1',
      days: [{ date: '2026-05-29', servings: 2 }],
    })
    await db.mealDays.put({
      date: '2026-05-30',
      skipped: true,
      createdAt: 1,
      updatedAt: 1,
    })
    await db.mealDays.put({
      date: '2026-05-29',
      skipped: true,
      createdAt: 1,
      updatedAt: 1,
    })

    await moveDishPlanEntry(created.entries[0]!.id, '2026-05-30')

    expect((await db.mealDays.get('2026-05-30'))?.skipped).toBe(false)
    expect((await db.mealDays.get('2026-05-29'))?.skipped).toBe(false)
  })
})

describe('undoing the last move', () => {
  it('undoes a single move completely', async () => {
    const created = await saveDishPlan({
      recipeId: 'r1',
      days: [{ date: '2026-05-29', servings: 2 }],
    })
    const entry = created.entries[0]!
    const moved = await moveDishPlanEntry(entry.id, '2026-05-31')
    const expected = {
      cookSessionId: moved.entries[0]!.cookSessionId ?? null,
      signature: dishPlanMoveSignature(moved.entries, moved.session ?? null),
    }

    const undone = await undoDishPlanMove({
      entryId: entry.id,
      originalDate: entry.date,
      expected,
    })

    expect(undone.moved).toBe(true)
    expect(undone.entries[0]?.id).toBe(entry.id)
    expect(undone.entries[0]?.date).toBe('2026-05-29')
    expect(undone.entries[0]?.servings).toBe(2)
    expect(undone.session?.date).toBe('2026-05-29')
    expect(undone.session?.servings).toBe(2)
    expect(await db.mealPlans.count()).toBe(1)
    expect(await db.cookSessions.count()).toBe(1)
  })

  it('undoes a gap-preserving group move with stable ids and portions', async () => {
    const created = await seedGroup()
    const friday = created.entries.find((entry) => entry.date === '2026-05-29')!
    const moved = await moveDishPlanEntry(friday.id, '2026-05-31')
    expect(moved.entries.map((entry) => entry.date)).toEqual([
      '2026-05-31',
      '2026-06-01',
      '2026-06-03',
    ])
    const expected = {
      cookSessionId: moved.entries[0]!.cookSessionId ?? null,
      signature: dishPlanMoveSignature(moved.entries, moved.session ?? null),
    }

    const undone = await undoDishPlanMove({
      entryId: friday.id,
      originalDate: '2026-05-29',
      expected,
    })

    expect(undone.entries.map((entry) => entry.date)).toEqual([
      '2026-05-29',
      '2026-05-30',
      '2026-06-01',
    ])
    expect(undone.entries.map((entry) => entry.servings)).toEqual([2, 3, 1])
    expect(undone.entries.map((entry) => entry.id)).toEqual(
      created.entries.map((entry) => entry.id),
    )
    expect(undone.session?.date).toBe('2026-05-29')
    expect(undone.session?.servings).toBe(6)
    expect(await db.mealPlans.count()).toBe(3)
    expect(await db.cookSessions.count()).toBe(1)
  })

  it('refuses to overwrite a group that changed after the move', async () => {
    const created = await seedGroup()
    const friday = created.entries.find((entry) => entry.date === '2026-05-29')!
    const moved = await moveDishPlanEntry(friday.id, '2026-05-31')
    const expected = {
      cookSessionId: moved.entries[0]!.cookSessionId ?? null,
      signature: dishPlanMoveSignature(moved.entries, moved.session ?? null),
    }

    await saveDishPlan({
      cookSessionId: moved.session!.id,
      recipeId: 'r1',
      days: moved.entries.map((entry, index) => ({
        entryId: entry.id,
        date: entry.date,
        servings: index === 0 ? 4 : entry.servings ?? 1,
      })),
    })

    await expect(
      undoDishPlanMove({
        entryId: friday.id,
        originalDate: '2026-05-29',
        expected,
      }),
    ).rejects.toBeInstanceOf(DishPlanMoveConflictError)

    const unchanged = await db.mealPlans
      .where('cookSessionId')
      .equals(moved.session!.id)
      .toArray()
    expect(unchanged.find((entry) => entry.id === friday.id)?.servings).toBe(4)
    expect(unchanged.map((entry) => entry.date).sort()).toEqual([
      '2026-05-31',
      '2026-06-01',
      '2026-06-03',
    ])
  })

  it('does not offer undo for a no-op move result', async () => {
    const created = await saveDishPlan({
      recipeId: 'r1',
      days: [{ date: '2026-05-29', servings: 2 }],
    })
    const entry = created.entries[0]!
    const result = await moveDishPlanEntry(entry.id, entry.date)

    expect(result.moved).toBe(false)
    expect(result.entries).toHaveLength(1)
  })
})
