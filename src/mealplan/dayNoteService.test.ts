import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../db'
import { planDayTotal } from '../domain/dishplan'
import type { Recipe } from '../types'
import { moveDishPlanEntry, saveDishPlan } from './dishService'
import {
  DayNoteMoveConflictError,
  dayNoteSignature,
  deleteDayNote,
  getDayNote,
  moveDayNote,
  normalizeDayNoteText,
  saveDayNote,
  undoDayNoteMove,
} from './dayNoteService'

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

beforeEach(async () => {
  await db.mealPlans.clear()
  await db.mealDays.clear()
  await db.settings.clear()
  await db.cookSessions.clear()
  await db.dayNotes.clear()
  await db.recipes.clear()
  await db.images.clear()
  await db.recipes.bulkAdd([makeRecipe('r1'), makeRecipe('r2')])
})

describe('day notes', () => {
  it('creates, edits and deletes a note for one date', async () => {
    const created = await saveDayNote('2026-05-29', '  Essen gehen  ')
    expect(created?.text).toBe('Essen gehen')
    expect(created?.date).toBe('2026-05-29')
    expect(await getDayNote('2026-05-29')).toEqual(created)

    const edited = await saveDayNote('2026-05-29', 'Bei Freunden eingeladen')
    expect(edited?.text).toBe('Bei Freunden eingeladen')
    expect(edited?.createdAt).toBe(created?.createdAt)
    expect((edited?.updatedAt ?? 0) >= (created?.updatedAt ?? 0)).toBe(true)

    await deleteDayNote('2026-05-29')
    expect(await getDayNote('2026-05-29')).toBeUndefined()
  })

  it('keeps multi-line text and removes surrounding whitespace', async () => {
    expect(normalizeDayNoteText('  Mittags unterwegs\r\nKeine Zeit  ')).toBe(
      'Mittags unterwegs\nKeine Zeit',
    )
    const note = await saveDayNote('2026-05-29', 'Mittags unterwegs\r\nKeine Zeit')
    expect(note?.text).toBe('Mittags unterwegs\nKeine Zeit')
  })

  it('removes the note when saving an empty text', async () => {
    await saveDayNote('2026-05-29', 'Essen gehen')
    const removed = await saveDayNote('2026-05-29', '   ')
    expect(removed).toBeNull()
    expect(await db.dayNotes.count()).toBe(0)
  })

  it('rejects invalid dates', async () => {
    await expect(saveDayNote('2026-13-01', 'Test')).rejects.toThrow('Ungültiges Datum')
    await expect(deleteDayNote('kein-datum')).rejects.toThrow('Ungültiges Datum')
  })

  it('coexists with several dishes and never changes portions or cooking events', async () => {
    const first = await saveDishPlan({
      recipeId: 'r1',
      days: [
        { date: '2026-05-29', servings: 2 },
        { date: '2026-05-30', servings: 1 },
      ],
    })
    await saveDishPlan({
      recipeId: 'r2',
      days: [{ date: '2026-05-29', servings: 3 }],
    })
    const totalBefore = planDayTotal(
      (await db.mealPlans.toArray()).map((entry) => ({
        date: entry.date,
        servings: entry.servings ?? 0,
      })),
    )
    const sessionsBefore = await db.cookSessions.toArray()

    const note = await saveDayNote('2026-05-29', 'Mittags unterwegs')

    expect(note?.text).toBe('Mittags unterwegs')
    expect(await db.mealPlans.count()).toBe(3)
    expect(await db.cookSessions.toArray()).toEqual(sessionsBefore)
    expect(planDayTotal(
      (await db.mealPlans.toArray()).map((entry) => ({
        date: entry.date,
        servings: entry.servings ?? 0,
      })),
    )).toBe(totalBefore)
    expect((await db.cookSessions.get(first.session.id))?.servings).toBe(3)
    expect(await db.dayNotes.count()).toBe(1)
  })

  it('stays on its date when a connected dish is moved away', async () => {
    const created = await saveDishPlan({
      recipeId: 'r1',
      days: [
        { date: '2026-05-29', servings: 2 },
        { date: '2026-05-30', servings: 3 },
      ],
    })
    await saveDayNote('2026-05-29', 'Essen gehen')

    await moveDishPlanEntry(created.entries[0]!.id, '2026-06-01')

    expect((await getDayNote('2026-05-29'))?.text).toBe('Essen gehen')
    expect(await getDayNote('2026-06-01')).toBeUndefined()
    expect(await db.dayNotes.count()).toBe(1)
    expect(await db.mealPlans.where('date').equals('2026-05-29').count()).toBe(0)
  })
})

describe('moving day notes', () => {
  it('moves a note to a free day and preserves its text and creation time', async () => {
    const original = await saveDayNote('2026-05-29', 'Essen gehen\nmit Freunden')

    const moved = await moveDayNote('2026-05-29', '2026-05-31')

    expect(moved.date).toBe('2026-05-31')
    expect(moved.text).toBe('Essen gehen\nmit Freunden')
    expect(moved.createdAt).toBe(original?.createdAt)
    expect(await getDayNote('2026-05-29')).toBeUndefined()
    expect((await getDayNote('2026-05-31'))?.text).toBe('Essen gehen\nmit Freunden')
    expect(await db.dayNotes.count()).toBe(1)
  })

  it('allows a target day that already has dishes and leaves them untouched', async () => {
    const created = await saveDishPlan({
      recipeId: 'r1',
      days: [{ date: '2026-05-30', servings: 2 }],
    })
    await saveDayNote('2026-05-29', 'Bei Freunden eingeladen')

    await moveDayNote('2026-05-29', '2026-05-30')

    expect((await getDayNote('2026-05-30'))?.text).toBe('Bei Freunden eingeladen')
    expect(await db.mealPlans.get(created.entries[0]!.id)).toEqual(created.entries[0])
    expect(await db.mealPlans.count()).toBe(1)
  })

  it('moves notes across week and year boundaries', async () => {
    await saveDayNote('2026-12-31', 'Jahreswechsel')

    const moved = await moveDayNote('2026-12-31', '2027-01-02')

    expect(moved.date).toBe('2027-01-02')
    expect(await getDayNote('2026-12-31')).toBeUndefined()
    expect((await getDayNote('2027-01-02'))?.text).toBe('Jahreswechsel')
  })

  it('refuses to overwrite an existing target comment', async () => {
    await saveDayNote('2026-05-29', 'Quelle')
    await saveDayNote('2026-05-30', 'Ziel')

    await expect(
      moveDayNote('2026-05-29', '2026-05-30'),
    ).rejects.toBeInstanceOf(DayNoteMoveConflictError)

    expect((await getDayNote('2026-05-29'))?.text).toBe('Quelle')
    expect((await getDayNote('2026-05-30'))?.text).toBe('Ziel')
    expect(await db.dayNotes.count()).toBe(2)
  })

  it('treats the same date as a no-op', async () => {
    const note = (await saveDayNote('2026-05-29', 'Unverändert'))!

    const moved = await moveDayNote('2026-05-29', '2026-05-29')

    expect(moved).toEqual(note)
    expect((await getDayNote('2026-05-29'))?.updatedAt).toBe(note.updatedAt)
    expect(await db.dayNotes.count()).toBe(1)
  })

  it('rejects invalid target dates without changing anything', async () => {
    await saveDayNote('2026-05-29', 'Bleibt hier')

    await expect(
      moveDayNote('2026-05-29', '2026-13-01'),
    ).rejects.toThrow('Ungültiges Datum')

    expect((await getDayNote('2026-05-29'))?.text).toBe('Bleibt hier')
    expect(await db.dayNotes.count()).toBe(1)
  })

  it('undoes a comment move and restores the original date and text', async () => {
    const original = await saveDayNote('2026-05-29', 'Essen gehen')
    const moved = await moveDayNote('2026-05-29', '2026-05-31')

    const undone = await undoDayNoteMove({
      currentDate: '2026-05-31',
      originalDate: '2026-05-29',
      expected: { signature: dayNoteSignature(moved) },
    })

    expect(undone.date).toBe('2026-05-29')
    expect(undone.text).toBe('Essen gehen')
    expect(undone.createdAt).toBe(original?.createdAt)
    expect(await getDayNote('2026-05-31')).toBeUndefined()
    expect((await getDayNote('2026-05-29'))?.text).toBe('Essen gehen')
    expect(await db.dayNotes.count()).toBe(1)
  })

  it('aborts undo when the moved comment was changed in the meantime', async () => {
    await saveDayNote('2026-05-29', 'Essen gehen')
    const moved = await moveDayNote('2026-05-29', '2026-05-31')
    const expected = { signature: dayNoteSignature(moved) }
    await saveDayNote('2026-05-31', 'Zwischenzeitlich geändert')

    await expect(
      undoDayNoteMove({
        currentDate: '2026-05-31',
        originalDate: '2026-05-29',
        expected,
      }),
    ).rejects.toBeInstanceOf(DayNoteMoveConflictError)

    expect((await getDayNote('2026-05-31'))?.text).toBe('Zwischenzeitlich geändert')
    expect(await getDayNote('2026-05-29')).toBeUndefined()
  })

  it('aborts undo when the original date was filled again', async () => {
    await saveDayNote('2026-05-29', 'Essen gehen')
    const moved = await moveDayNote('2026-05-29', '2026-05-31')
    const expected = { signature: dayNoteSignature(moved) }
    await saveDayNote('2026-05-29', 'Neu am Ausgang')

    await expect(
      undoDayNoteMove({
        currentDate: '2026-05-31',
        originalDate: '2026-05-29',
        expected,
      }),
    ).rejects.toBeInstanceOf(DayNoteMoveConflictError)

    expect((await getDayNote('2026-05-29'))?.text).toBe('Neu am Ausgang')
    expect((await getDayNote('2026-05-31'))?.text).toBe('Essen gehen')
  })
})
