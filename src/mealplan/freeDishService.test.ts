import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../db'
import { groupDates, scalePlan } from '../domain/dishplan'
import { scaleDishIngredients } from '../domain/dishSource'
import type { MealPlanEntry, Recipe } from '../types'
import {
  deleteDishPlan,
  dishPlanMoveSignature,
  moveDishPlanEntry,
  undoDishPlanMove,
  saveDishPlan,
} from './dishService'
import { saveFreeDishPlan } from './freeDishService'

function makeRecipe(id: string): Recipe {
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
        purchaseNote: '',
        preparationNote: '',
        parseStatus: 'parsed',
        links: [],
      },
    ],
    instructions: [],
    servingsText: '4 Portionen',
    servingsNumber: 4,
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
  }
}

async function clearAll(): Promise<void> {
  if (!db.isOpen()) await db.open()
  await db.recipes.clear()
  await db.freeDishes.clear()
  await db.mealPlans.clear()
  await db.mealDays.clear()
  await db.settings.clear()
  await db.cookSessions.clear()
  await db.dayNotes.clear()
}

beforeEach(async () => {
  await clearAll()
})

describe('free dish planning', () => {
  it('creates a free dish without ingredients and without touching the recipe library', async () => {
    const created = await saveFreeDishPlan({
      name: 'Brotzeit',
      days: [{ date: '2026-05-28', servings: 2 }],
      referenceServings: 2,
      ingredients: [],
    })

    expect(created.freeDish.name).toBe('Brotzeit')
    expect(created.freeDish.ingredients).toEqual([])
    expect(created.freeDish.referenceServings).toBe(2)
    expect(created.session.recipeId).toBeNull()
    expect(created.session.freeDishId).toBe(created.freeDish.id)
    expect(created.session.servings).toBe(2)
    expect(created.entries).toHaveLength(1)
    expect(created.entries[0]?.recipeId).toBeNull()
    expect(created.entries[0]?.freeDishId).toBe(created.freeDish.id)
    expect(await db.recipes.count()).toBe(0)
    expect(await db.freeDishes.count()).toBe(1)
    expect(await db.cookSessions.count()).toBe(1)
    expect(await db.mealPlans.count()).toBe(1)
  })

  it('stores multiple structured ingredients with separate purchase and preparation notes', async () => {
    const created = await saveFreeDishPlan({
      name: 'Nudeln mit Pesto',
      days: [{ date: '2026-05-28', servings: 3 }],
      referenceServings: 3,
      ingredients: [
        { quantity: '300', unit: 'g', name: 'Nudeln' },
        {
          quantity: '1',
          unit: 'Glas',
          name: 'Pesto',
          purchaseNote: 'bevorzugt Barilla',
        },
        {
          quantity: '50',
          unit: 'g',
          name: 'Parmesan',
          preparationNote: 'frisch gerieben',
        },
      ],
    })

    expect(created.freeDish.ingredients).toHaveLength(3)
    expect(created.freeDish.ingredients[0]).toMatchObject({
      name: 'Nudeln',
      quantity: 300,
      quantityText: '300',
      unit: 'g',
      parseStatus: 'parsed',
    })
    expect(created.freeDish.ingredients[1]?.purchaseNote).toBe('bevorzugt Barilla')
    expect(created.freeDish.ingredients[1]?.preparationNote).toBe('')
    expect(created.freeDish.ingredients[2]?.preparationNote).toBe('frisch gerieben')
    expect(created.freeDish.ingredients[2]?.purchaseNote).toBe('')
  })

  it('plans non-consecutive days with individual eaters and one shared cooking event', async () => {
    const created = await saveFreeDishPlan({
      name: 'Nudeln mit Pesto',
      days: [
        { date: '2026-05-28', servings: 2 },
        { date: '2026-06-06', servings: 1 },
      ],
      referenceServings: 3,
      ingredients: [{ quantity: '300', unit: 'g', name: 'Nudeln' }],
    })

    expect(created.entries.map((entry) => entry.date)).toEqual(['2026-05-28', '2026-06-06'])
    expect(created.entries.map((entry) => entry.servings)).toEqual([2, 1])
    expect(created.session.servings).toBe(3)
    expect(new Set(created.entries.map((entry) => entry.cookSessionId))).toEqual(
      new Set([created.session.id]),
    )
    expect(groupDates(created.entries, created.session.id)).toEqual([
      '2026-05-28',
      '2026-06-06',
    ])
  })

  it('keeps the stored reference portions when eat days change and scales without double scaling', async () => {
    const created = await saveFreeDishPlan({
      name: 'Nudeln mit Pesto',
      days: [{ date: '2026-05-28', servings: 3 }],
      referenceServings: 3,
      ingredients: [{ quantity: '300', unit: 'g', name: 'Nudeln' }],
    })

    const updated = await saveFreeDishPlan({
      cookSessionId: created.session.id,
      freeDishId: created.freeDish.id,
      name: 'Nudeln mit Pesto',
      days: [
        { entryId: created.entries[0]!.id, date: '2026-05-28', servings: 2 },
        { date: '2026-05-30', servings: 3 },
      ],
      referenceServings: created.freeDish.referenceServings,
      ingredients: created.freeDish.ingredients.map((ingredient) => ({
        id: ingredient.id,
        quantity: ingredient.quantityText ?? '',
        unit: ingredient.unit ?? '',
        name: ingredient.name,
        purchaseNote: ingredient.purchaseNote,
        preparationNote: ingredient.preparationNote,
      })),
    })

    expect(updated.session.servings).toBe(5)
    expect(updated.freeDish.referenceServings).toBe(3)
    expect(updated.freeDish.ingredients[0]?.quantityText).toBe('300')

    const scale = scaleDishIngredients(
      { kind: 'free', freeDish: updated.freeDish },
      updated.session.servings,
    )
    expect(scale.factor).toBeCloseTo(5 / 3)
    expect(scale.items[0]?.quantityText).toBe('500')

    // Saving again does not multiply the already stored reference amount.
    const again = await saveFreeDishPlan({
      cookSessionId: updated.session.id,
      freeDishId: updated.freeDish.id,
      name: updated.freeDish.name,
      days: updated.entries.map((entry) => ({
        entryId: entry.id,
        date: entry.date,
        servings: entry.servings ?? 1,
      })),
      referenceServings: updated.freeDish.referenceServings,
      ingredients: updated.freeDish.ingredients.map((ingredient) => ({
        id: ingredient.id,
        quantity: ingredient.quantityText ?? '',
        unit: ingredient.unit ?? '',
        name: ingredient.name,
      })),
    })
    expect(again.freeDish.ingredients[0]?.quantityText).toBe('300')
  })

  it('edits name and ingredients for every linked calendar entry', async () => {
    const created = await saveFreeDishPlan({
      name: 'Ofengemüse',
      days: [
        { date: '2026-05-28', servings: 2 },
        { date: '2026-05-29', servings: 2 },
      ],
      referenceServings: 4,
      ingredients: [{ quantity: '1', unit: 'kg', name: 'Gemüse' }],
    })
    const ingredient = created.freeDish.ingredients[0]!

    const updated = await saveFreeDishPlan({
      cookSessionId: created.session.id,
      freeDishId: created.freeDish.id,
      name: 'Ofengemüse mit Feta',
      days: created.entries.map((entry) => ({
        entryId: entry.id,
        date: entry.date,
        servings: entry.servings ?? 1,
      })),
      referenceServings: 4,
      ingredients: [
        {
          id: ingredient.id,
          quantity: ingredient.quantityText ?? '',
          unit: ingredient.unit ?? '',
          name: 'Gemüse',
        },
        { quantity: '200', unit: 'g', name: 'Feta', purchaseNote: 'Schafskäse' },
      ],
    })

    expect(updated.freeDish.id).toBe(created.freeDish.id)
    expect(updated.session.id).toBe(created.session.id)
    expect(updated.freeDish.createdAt).toBe(created.freeDish.createdAt)
    expect(updated.freeDish.name).toBe('Ofengemüse mit Feta')
    expect(updated.freeDish.ingredients).toHaveLength(2)
    expect(updated.freeDish.ingredients[1]?.purchaseNote).toBe('Schafskäse')
    expect(updated.entries.map((entry) => entry.id)).toEqual(
      created.entries.map((entry) => entry.id),
    )
    expect((await db.freeDishes.get(updated.freeDish.id))?.name).toBe(
      'Ofengemüse mit Feta',
    )
  })

  it('keeps two free dishes with the same name completely separate', async () => {
    const first = await saveFreeDishPlan({
      name: 'Brotzeit',
      days: [{ date: '2026-05-28', servings: 2 }],
      referenceServings: 2,
      ingredients: [],
    })
    const second = await saveFreeDishPlan({
      name: 'Brotzeit',
      days: [{ date: '2026-05-29', servings: 1 }],
      referenceServings: 1,
      ingredients: [],
    })

    expect(first.freeDish.id).not.toBe(second.freeDish.id)
    expect(first.session.id).not.toBe(second.session.id)
    expect(await db.freeDishes.count()).toBe(2)
    expect(await db.cookSessions.count()).toBe(2)
  })

  it('persists free dishes and their links across a database close/open', async () => {
    const created = await saveFreeDishPlan({
      name: 'Selbstgemachte Burger',
      days: [{ date: '2026-05-28', servings: 3 }],
      referenceServings: 3,
      ingredients: [
        { quantity: '600', unit: 'g', name: 'Hackfleisch' },
        {
          quantity: '1',
          unit: 'Glas',
          name: 'Relish',
          purchaseNote: 'nach Wahl',
          preparationNote: 'kalt',
        },
      ],
    })

    db.close()
    await db.open()

    const stored = await db.freeDishes.get(created.freeDish.id)
    expect(stored?.name).toBe('Selbstgemachte Burger')
    expect(stored?.referenceServings).toBe(3)
    expect(stored?.ingredients[1]?.purchaseNote).toBe('nach Wahl')
    expect(stored?.ingredients[1]?.preparationNote).toBe('kalt')
    const session = await db.cookSessions.get(created.session.id)
    expect(session?.freeDishId).toBe(created.freeDish.id)
    expect(session?.recipeId).toBeNull()
    const entries = await db.mealPlans
      .where('cookSessionId')
      .equals(created.session.id)
      .toArray()
    expect(entries).toHaveLength(1)
    expect(entries[0]?.freeDishId).toBe(created.freeDish.id)
  })

  it('deletes the whole free dish without touching recipes, other dishes or notes', async () => {
    await db.recipes.put(makeRecipe('r1'))
    const recipeDish = await saveDishPlan({
      recipeId: 'r1',
      days: [{ date: '2026-05-28', servings: 2 }],
    })
    const free = await saveFreeDishPlan({
      name: 'Brotzeit',
      days: [
        { date: '2026-05-28', servings: 1 },
        { date: '2026-05-29', servings: 1 },
      ],
      referenceServings: 2,
      ingredients: [{ quantity: '1', unit: 'Brot', name: 'Bauernbrot' }],
    })
    await db.dayNotes.put({
      date: '2026-05-28',
      text: 'Kommentar bleibt',
      createdAt: 1,
      updatedAt: 1,
    })

    const deleted = await deleteDishPlan(free.session.id)

    expect(deleted.deletedMeals).toBe(2)
    expect(await db.freeDishes.get(free.freeDish.id)).toBeUndefined()
    expect(await db.cookSessions.get(free.session.id)).toBeUndefined()
    expect(await db.mealPlans.get(free.entries[0]!.id)).toBeUndefined()
    expect(await db.mealPlans.get(free.entries[1]!.id)).toBeUndefined()
    expect(await db.cookSessions.get(recipeDish.session.id)).toBeTruthy()
    expect(await db.mealPlans.get(recipeDish.entries[0]!.id)).toBeTruthy()
    expect((await db.dayNotes.get('2026-05-28'))?.text).toBe('Kommentar bleibt')
    expect(await db.recipes.count()).toBe(1)
  })

  it('moves all free-dish days together, keeps gaps and supports undo', async () => {
    const created = await saveFreeDishPlan({
      name: 'Nudeln mit Pesto',
      days: [
        { date: '2026-05-28', servings: 2 },
        { date: '2026-05-30', servings: 1 },
      ],
      referenceServings: 3,
      ingredients: [{ quantity: '300', unit: 'g', name: 'Nudeln' }],
    })
    const anchor = created.entries.find((entry) => entry.date === '2026-05-28')!

    const moved = await moveDishPlanEntry(anchor.id, '2026-05-29')

    expect(moved.moved).toBe(true)
    expect(moved.deltaDays).toBe(1)
    expect(moved.entries.map((entry) => entry.date)).toEqual([
      '2026-05-29',
      '2026-05-31',
    ])
    expect(moved.entries.map((entry) => entry.servings)).toEqual([2, 1])
    expect(moved.session?.date).toBe('2026-05-29')
    expect(moved.entries.every((entry) => entry.freeDishId === created.freeDish.id)).toBe(
      true,
    )
    expect(await db.freeDishes.get(created.freeDish.id)).toBeTruthy()

    const undone = await undoDishPlanMove({
      entryId: anchor.id,
      originalDate: anchor.date,
      expected: {
        cookSessionId: moved.session?.id ?? null,
        signature: dishPlanMoveSignature(moved.entries, moved.session),
      },
    })
    expect(undone.moved).toBe(true)
    expect(undone.entries.map((entry) => entry.date)).toEqual([
      '2026-05-28',
      '2026-05-30',
    ])
    expect(undone.entries.map((entry) => entry.servings)).toEqual([2, 1])
  })

  it('leaves library recipe planning unchanged', async () => {
    await db.recipes.put(makeRecipe('r1'))
    const recipeDish = await saveDishPlan({
      recipeId: 'r1',
      days: [{ date: '2026-05-28', servings: 2 }],
    })
    const recipeBefore = await db.mealPlans.get(recipeDish.entries[0]!.id)

    const free = await saveFreeDishPlan({
      name: 'Brotzeit',
      days: [{ date: '2026-05-28', servings: 1 }],
      referenceServings: 1,
      ingredients: [],
    })

    expect(await db.mealPlans.get(recipeDish.entries[0]!.id)).toEqual(recipeBefore)
    expect((await db.cookSessions.get(recipeDish.session.id))?.recipeId).toBe('r1')
    expect(free.freeDish.id).not.toBe('r1')
    expect(scalePlan(makeRecipe('r1'), [{ date: '2026-05-28', servings: 2 }]).totalServings).toBe(
      2,
    )
  })

  it('rejects empty names and invalid reference portions without writing anything', async () => {
    await expect(
      saveFreeDishPlan({
        name: '   ',
        days: [{ date: '2026-05-28', servings: 2 }],
        referenceServings: 2,
        ingredients: [],
      }),
    ).rejects.toThrow('Namen')
    await expect(
      saveFreeDishPlan({
        name: 'Brotzeit',
        days: [{ date: '2026-05-28', servings: 2 }],
        referenceServings: 0,
        ingredients: [],
      }),
    ).rejects.toThrow('Portionszahl')
    expect(await db.freeDishes.count()).toBe(0)
    expect(await db.cookSessions.count()).toBe(0)
    expect(await db.mealPlans.count()).toBe(0)
  })

  it('rejects a stale cooking event for a different free dish', async () => {
    const first = await saveFreeDishPlan({
      name: 'Erstes Gericht',
      days: [{ date: '2026-05-28', servings: 2 }],
      referenceServings: 2,
      ingredients: [],
    })
    const second = await saveFreeDishPlan({
      name: 'Zweites Gericht',
      days: [{ date: '2026-05-29', servings: 2 }],
      referenceServings: 2,
      ingredients: [],
    })

    await expect(
      saveFreeDishPlan({
        cookSessionId: first.session.id,
        freeDishId: second.freeDish.id,
        name: 'Zweites Gericht',
        days: [{ entryId: second.entries[0]!.id, date: '2026-05-29', servings: 2 }],
        referenceServings: 2,
        ingredients: [],
      }),
    ).rejects.toThrow('Kochvorgang')
  })

  it('keeps unrelated entries untouched when one free dish is saved', async () => {
    const other = await saveFreeDishPlan({
      name: 'Anderes Gericht',
      days: [{ date: '2026-05-27', servings: 2 }],
      referenceServings: 2,
      ingredients: [],
    })
    const before: MealPlanEntry[] = await db.mealPlans.toArray()

    await saveFreeDishPlan({
      name: 'Neues Gericht',
      days: [{ date: '2026-05-28', servings: 1 }],
      referenceServings: 1,
      ingredients: [],
    })

    expect(await db.mealPlans.get(other.entries[0]!.id)).toEqual(before[0])
  })
})
