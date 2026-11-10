/*
 * Küchenrunde – Tests der Cloud-Wochenplanung
 * Copyright (C) 2026 openCook Web contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Die Tests laufen gegen ein atomares In-Memory-Abbild von apply_ops. Damit
 * lassen sich Mehrzeilen-Transaktionen, Revisionskonflikte und Realtime ohne
 * Supabase und ohne Browser prüfen.
 */

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { CloudConflictError } from '../data/cloudErrors'
import {
  CloudRecordsStore,
  type ApplyOpsPayload,
  type ApplyOpsResult,
  type RecordChange,
  type RecordRow,
  type RecordsBackend,
  type RecordsSubscriptionHandlers,
} from '../data/cloudRecords'
import { shoppingItemKey } from '../domain/shopping'
import { shoppingPeriod, standardShoppingListId } from '../domain/shoppingLists'
import { dayNoteSignature, DayNoteMoveConflictError } from '../mealplan/dayNoteService'
import {
  CookedMoveConflictError,
  DishPlanMoveConflictError,
  dishPlanMoveSignature,
} from '../mealplan/dishService'
import { PlanBackendProvider } from '../mealplan/planBackend'
import { PlanPage } from '../pages/PlanPage'
import type {
  CookSession,
  DayNote,
  MealPlanEntry,
  Recipe,
  SettingRecord,
} from '../types'
import { createCloudPlanBackend, readPlanData } from './cloudPlanBackend'

function key(collection: string, id: string): string {
  return `${collection}\u0000${id}`
}

/** Atomares Test-Double für apply_ops inklusive Revisionsprüfung. */
class TestBackend implements RecordsBackend {
  readonly rows = new Map<string, RecordRow>()
  readonly calls: ApplyOpsPayload[] = []
  failNext: Error | null = null
  private handlers: RecordsSubscriptionHandlers | null = null

  async snapshot(): Promise<RecordRow[]> {
    return [...this.rows.values()].map((row) => structuredClone(row))
  }

  async fetch(collection: string, id: string): Promise<RecordRow | null> {
    const row = this.rows.get(key(collection, id))
    return row ? structuredClone(row) : null
  }

  async applyOps(payload: ApplyOpsPayload): Promise<ApplyOpsResult> {
    this.calls.push(structuredClone(payload))
    if (this.failNext) {
      const error = this.failNext
      this.failNext = null
      throw error
    }

    const next = new Map(this.rows)
    const applied: ApplyOpsResult['applied'] = []
    const deleted: ApplyOpsResult['deleted'] = []

    for (const collection of payload.clear) {
      for (const [entryKey, row] of next) {
        if (row.collection === collection) next.delete(entryKey)
      }
    }

    for (const upsert of payload.upserts) {
      const entryKey = key(upsert.collection, upsert.id)
      const current = next.get(entryKey)
      if (upsert.expected_rev === 0) {
        if (current) throw new CloudConflictError()
        next.set(entryKey, {
          collection: upsert.collection,
          id: upsert.id,
          rev: 1,
          data: structuredClone(upsert.data),
        })
        applied.push({ collection: upsert.collection, id: upsert.id, rev: 1 })
        continue
      }
      if (!current || current.rev !== upsert.expected_rev) {
        throw new CloudConflictError()
      }
      const rev = current.rev + 1
      next.set(entryKey, {
        collection: upsert.collection,
        id: upsert.id,
        rev,
        data: structuredClone(upsert.data),
      })
      applied.push({ collection: upsert.collection, id: upsert.id, rev })
    }

    for (const remove of payload.deletes) {
      const entryKey = key(remove.collection, remove.id)
      const current = next.get(entryKey)
      if (!current) continue
      if (remove.expected_rev !== null && current.rev !== remove.expected_rev) {
        throw new CloudConflictError()
      }
      next.delete(entryKey)
      deleted.push({ collection: remove.collection, id: remove.id })
    }

    this.rows.clear()
    for (const [entryKey, row] of next) this.rows.set(entryKey, row)
    return { applied, deleted }
  }

  subscribe(handlers: RecordsSubscriptionHandlers): () => void {
    this.handlers = handlers
    return () => {
      if (this.handlers === handlers) this.handlers = null
    }
  }

  emit(change: RecordChange): void {
    this.handlers?.onChange(change)
  }

  seed(collection: string, id: string, data: unknown, rev = 1): void {
    this.rows.set(key(collection, id), {
      collection,
      id,
      rev,
      data: structuredClone(data),
    })
  }

  row<T = unknown>(collection: string, id: string): RecordRow<T> | undefined {
    return this.rows.get(key(collection, id)) as RecordRow<T> | undefined
  }
}

function makeRecipe(id: string, overrides: Partial<Recipe> = {}): Recipe {
  return {
    id,
    importId: `manual-${id}`,
    importSource: 'manual',
    title: `Rezept ${id}`,
    description: '',
    ingredientGroups: [],
    ingredients: [],
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

function makeEntry(
  id: string,
  date: string,
  overrides: Partial<MealPlanEntry> = {},
): MealPlanEntry {
  return {
    id,
    date,
    slot: 'dinner',
    recipeId: 'r1',
    servings: 2,
    position: 0,
    cookSessionId: 'cook-1',
    status: 'planned',
    auto: false,
    pinned: false,
    leftover: false,
    cooked: false,
    reasons: [],
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }
}

function makeSession(id: string, overrides: Partial<CookSession> = {}): CookSession {
  return {
    id,
    recipeId: 'r1',
    date: '2026-05-29',
    servings: 4,
    status: 'planned',
    auto: false,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }
}

async function setup(
  seedRows: Array<[string, string, unknown]> = [],
): Promise<{
  backend: TestBackend
  store: CloudRecordsStore
  plan: ReturnType<typeof createCloudPlanBackend>
}> {
  const backend = new TestBackend()
  for (const [collection, id, data] of seedRows) backend.seed(collection, id, data)
  const store = new CloudRecordsStore(backend)
  await store.load()
  return { backend, store, plan: createCloudPlanBackend(store) }
}

describe('Cloud-Wochenplanung – Speichern und Laden', () => {
  it('plant ein Rezept manuell und schreibt Kochvorgang, Tag und Tagesstatus atomar', async () => {
    const { backend, store, plan } = await setup([
      ['recipes', 'r1', makeRecipe('r1')],
    ])

    const result = await plan.saveDishPlan({
      recipeId: 'r1',
      days: [{ date: '2026-05-29', servings: 3 }],
    })

    expect(result.session.id).toMatch(/^cook-/)
    expect(result.session.recipeId).toBe('r1')
    expect(result.session.servings).toBe(3)
    expect(result.session.status).toBe('planned')
    expect(result.session.auto).toBe(false)

    expect(result.entries).toHaveLength(1)
    const entry = result.entries[0]!
    expect(entry.id).toMatch(/^meal-/)
    expect(entry.date).toBe('2026-05-29')
    expect(entry.slot).toBe('dinner')
    expect(entry.recipeId).toBe('r1')
    expect(entry.servings).toBe(3)
    expect(entry.cookSessionId).toBe(result.session.id)
    expect(entry.auto).toBe(false)
    expect(entry.leftover).toBe(false)
    expect(entry.status).toBe('planned')

    expect(backend.calls).toHaveLength(1)
    const payload = backend.calls[0]!
    expect(payload.clear).toEqual([])
    expect(payload.deletes).toEqual([])
    expect(payload.upserts.map((row) => row.collection).sort()).toEqual([
      'cookSessions',
      'mealDays',
      'mealPlans',
    ])
    expect(payload.upserts.every((row) => row.expected_rev === 0)).toBe(true)

    expect(store.list('cookSessions')).toHaveLength(1)
    expect(store.list('mealPlans')).toHaveLength(1)
    expect(store.get<{ skipped: boolean }>('mealDays', '2026-05-29')?.data.skipped).toBe(
      false,
    )
    expect(readPlanData(store)?.recipes.map((recipe) => recipe.id)).toEqual(['r1'])
  })

  it('ändert Portionen und Tage, ohne doppelte Zeilen oder verwaiste Esstage zu erzeugen', async () => {
    const { store, plan } = await setup([
      ['recipes', 'r1', makeRecipe('r1')],
    ])
    const initial = await plan.saveDishPlan({
      recipeId: 'r1',
      days: [
        { date: '2026-05-29', servings: 2 },
        { date: '2026-05-30', servings: 2 },
      ],
    })
    const first = initial.entries.find((entry) => entry.date === '2026-05-29')!

    const edited = await plan.saveDishPlan({
      cookSessionId: initial.session.id,
      recipeId: 'r1',
      days: [
        { entryId: first.id, date: '2026-05-29', servings: 3 },
        { date: '2026-05-31', servings: 5 },
      ],
    })

    expect(edited.session.id).toBe(initial.session.id)
    expect(edited.session.servings).toBe(8)
    expect(edited.entries).toHaveLength(2)
    expect(edited.entries.map((entry) => entry.date)).toEqual([
      '2026-05-29',
      '2026-05-31',
    ])
    expect(edited.entries.map((entry) => entry.servings)).toEqual([3, 5])
    expect(store.list('mealPlans')).toHaveLength(2)
    expect(store.list('cookSessions')).toHaveLength(1)
    expect(
      store.list<MealPlanEntry>('mealPlans').some((row) => row.data.date === '2026-05-30'),
    ).toBe(false)
  })

  it('speichert eine Originalportionen-Korrektur im selben atomaren Aufruf', async () => {
    const { backend, store, plan } = await setup([
      [
        'recipes',
        'r2',
        makeRecipe('r2', { servingsText: '', servingsNumber: null }),
      ],
    ])

    await plan.saveDishPlan({
      recipeId: 'r2',
      days: [{ date: '2026-05-29', servings: 4 }],
      originalServings: 4,
    })

    expect(store.get<Recipe>('recipes', 'r2')?.data.servingsNumber).toBe(4)
    const collections = backend.calls
      .flatMap((call) => call.upserts.map((row) => row.collection))
      .sort()
    expect(collections).toContain('recipes')
    expect(backend.calls).toHaveLength(1)
  })
})

describe('Cloud-Wochenplanung – Verschieben und Entfernen', () => {
  it('verschiebt ein verbundenes Gericht als Gruppe und macht das Rückgängig revisionssicher', async () => {
    const { backend, store, plan } = await setup([
      ['recipes', 'r1', makeRecipe('r1')],
    ])
    const initial = await plan.saveDishPlan({
      recipeId: 'r1',
      days: [
        { date: '2026-05-29', servings: 2 },
        { date: '2026-05-31', servings: 2 },
      ],
    })
    const first = initial.entries.find((entry) => entry.date === '2026-05-29')!
    const callsBeforeMove = backend.calls.length

    const moved = await plan.moveDishPlanEntry(first.id, '2026-06-01')
    expect(backend.calls.length).toBe(callsBeforeMove + 1)
    expect(
      backend.calls.at(-1)!.upserts.map((row) => row.collection).sort(),
    ).toEqual(['cookSessions', 'mealDays', 'mealDays', 'mealPlans', 'mealPlans'])
    expect(moved.moved).toBe(true)
    expect(moved.deltaDays).toBe(3)
    expect(moved.entries.map((entry) => entry.date)).toEqual([
      '2026-06-01',
      '2026-06-03',
    ])
    expect(moved.entries.map((entry) => entry.servings)).toEqual([2, 2])
    expect(moved.session?.date).toBe('2026-06-01')
    expect(store.list('mealPlans')).toHaveLength(2)

    const snapshot = {
      cookSessionId: moved.entries[0]!.cookSessionId ?? null,
      signature: dishPlanMoveSignature(moved.entries, moved.session ?? null),
    }
    const undone = await plan.undoDishPlanMove({
      entryId: first.id,
      originalDate: '2026-05-29',
      expected: snapshot,
    })
    expect(undone.entries.map((entry) => entry.date)).toEqual([
      '2026-05-29',
      '2026-05-31',
    ])

    // A later edit makes the old undo snapshot invalid.
    const movedAgain = await plan.moveDishPlanEntry(first.id, '2026-06-05')
    await plan.saveDishPlan({
      cookSessionId: movedAgain.session!.id,
      recipeId: 'r1',
      days: movedAgain.entries.map((entry) => ({
        entryId: entry.id,
        date: entry.date,
        servings: entry.servings ?? 2,
      })),
    })
    await expect(
      plan.undoDishPlanMove({
        entryId: first.id,
        originalDate: '2026-05-29',
        expected: snapshot,
      }),
    ).rejects.toBeInstanceOf(DishPlanMoveConflictError)
  })

  it('erkennt gekochte Gerichte beim Verschieben und erlaubt die Bestätigung', async () => {
    const { backend, store, plan } = await setup([
      ['recipes', 'r1', makeRecipe('r1')],
    ])
    const initial = await plan.saveDishPlan({
      recipeId: 'r1',
      days: [{ date: '2026-05-29', servings: 2 }],
    })
    const sessionRow = backend.row('cookSessions', initial.session.id)!
    backend.seed(
      'cookSessions',
      initial.session.id,
      { ...initial.session, status: 'cooked' },
      sessionRow.rev + 1,
    )
    await store.refresh('cookSessions', initial.session.id)

    await expect(
      plan.moveDishPlanEntry(initial.entries[0]!.id, '2026-06-01'),
    ).rejects.toBeInstanceOf(CookedMoveConflictError)

    const moved = await plan.moveDishPlanEntry(
      initial.entries[0]!.id,
      '2026-06-01',
      { allowCookedChange: true },
    )
    expect(moved.entries[0]!.date).toBe('2026-06-01')
    expect(moved.session?.status).toBe('cooked')
  })

  it('entfernt ein komplettes freies Gericht samt Zutaten-Snapshot ohne Waisen', async () => {
    const { backend, store, plan } = await setup()

    const saved = await plan.saveFreeDishPlan({
      name: 'Nudeln mit Pesto',
      days: [
        { date: '2026-05-29', servings: 2 },
        { date: '2026-05-30', servings: 1 },
      ],
      referenceServings: 2,
      ingredients: [{ quantity: '250', unit: 'g', name: 'Nudeln' }],
    })

    expect(saved.freeDish.name).toBe('Nudeln mit Pesto')
    expect(saved.freeDish.referenceServings).toBe(2)
    expect(saved.freeDish.ingredients.map((ingredient) => ingredient.name)).toEqual([
      'Nudeln',
    ])
    expect(saved.entries).toHaveLength(2)

    const callsBeforeDelete = backend.calls.length
    await plan.deleteDishPlan(saved.session.id)
    expect(backend.calls.length).toBe(callsBeforeDelete + 1)
    expect(backend.calls.at(-1)!.deletes).toHaveLength(4)

    expect(store.list('mealPlans')).toHaveLength(0)
    expect(store.list('cookSessions')).toHaveLength(0)
    expect(store.list('freeDishes')).toHaveLength(0)
    expect(
      store.list<MealPlanEntry>('mealPlans').some((row) => row.data.freeDishId),
    ).toBe(false)
  })

  it('bereinigt offene Cloud-Einkaufszeilen des Gerichts, ohne fremde Einkäufe zu ändern', async () => {
    const tomatoKey = shoppingItemKey('Tomaten')
    const periodStart = shoppingPeriod('2026-05-29', 3).start
    const recipe = makeRecipe('r1', {
      ingredients: [
        {
          id: 'i1',
          groupId: null,
          position: 0,
          raw: '4 Tomaten',
          name: 'Tomaten',
          quantity: 4,
          quantityText: '4',
          unit: 'Stück',
          parseStatus: 'parsed',
          links: [],
        },
      ],
    })
    const { backend, store, plan } = await setup([['recipes', 'r1', recipe]])
    const saved = await plan.saveDishPlan({
      recipeId: 'r1',
      days: [{ date: '2026-05-29', servings: 4 }],
    })

    backend.seed('shoppingPurchases', 'purchase-tomato', {
      id: 'purchase-tomato',
      shoppingDate: '2026-05-29',
      itemKey: tomatoKey,
      amounts: [{ dimension: 'count', lower: 4, upper: 4 }],
      snapshot: [{ dimension: 'count', lower: 4, upper: 4 }],
      qualitative: false,
      createdAt: 1,
      updatedAt: 1,
    })
    backend.seed('shoppingPurchases', 'purchase-milk', {
      id: 'purchase-milk',
      shoppingDate: '2026-05-29',
      itemKey: shoppingItemKey('Milch'),
      amounts: [{ dimension: 'volume', lower: 1000, upper: 1000 }],
      snapshot: [{ dimension: 'volume', lower: 1000, upper: 1000 }],
      qualitative: false,
      createdAt: 1,
      updatedAt: 1,
    })
    backend.seed('shoppingDemandAllocations', 'allocation-tomato', {
      id: 'allocation-tomato',
      periodStart,
      itemKey: tomatoKey,
      dimension: 'count',
      listId: standardShoppingListId(periodStart),
      mode: 'partial',
      quantityMilli: 2000,
      createdAt: 1,
      updatedAt: 1,
    })
    await store.load()

    await plan.deleteDishPlan(saved.session.id)

    expect(store.get('shoppingPurchases', 'purchase-tomato')).toBeUndefined()
    expect(store.get('shoppingPurchases', 'purchase-milk')).toBeDefined()
    expect(store.get('shoppingDemandAllocations', 'allocation-tomato')).toBeUndefined()
  })

  it('entfernt den Zutaten-Snapshot, wenn der letzte freie Esstag ohne Kochvorgang gelöscht wird', async () => {
    const { backend, store, plan } = await setup()
    backend.seed('freeDishes', 'free-1', {
      id: 'free-1',
      name: 'Restessen',
      referenceServings: 2,
      ingredients: [],
      createdAt: 1,
      updatedAt: 1,
    })
    backend.seed(
      'mealPlans',
      'meal-free-1',
      makeEntry('meal-free-1', '2026-05-29', {
        recipeId: null,
        freeDishId: 'free-1',
        cookSessionId: null,
      }),
    )
    await store.load()

    await plan.removeMealEntry('meal-free-1')

    expect(store.list('mealPlans')).toHaveLength(0)
    expect(store.list('freeDishes')).toHaveLength(0)
  })
})

describe('Cloud-Wochenplanung – freie Gerichte, Notizen und Einstellungen', () => {
  it('speichert freie Gerichte und Tagesnotizen inklusive Verschieben und Rückgängig', async () => {
    const { backend, store, plan } = await setup()

    const note = await plan.saveDayNote('2026-05-29', '  Essen gehen\n')
    expect(note?.text).toBe('Essen gehen')
    expect(store.get<DayNote>('dayNotes', '2026-05-29')?.data.text).toBe('Essen gehen')

    const callsBeforeMove = backend.calls.length
    const moved = await plan.moveDayNote('2026-05-29', '2026-05-30')
    expect(backend.calls.length).toBe(callsBeforeMove + 1)
    expect(backend.calls.at(-1)!.deletes).toHaveLength(1)
    expect(backend.calls.at(-1)!.upserts).toHaveLength(1)
    expect(moved.date).toBe('2026-05-30')
    expect(store.get('dayNotes', '2026-05-29')).toBeUndefined()
    expect(store.get<DayNote>('dayNotes', '2026-05-30')?.data.text).toBe('Essen gehen')

    const undone = await plan.undoDayNoteMove({
      currentDate: '2026-05-30',
      originalDate: '2026-05-29',
      expected: { signature: dayNoteSignature(moved) },
    })
    expect(undone.date).toBe('2026-05-29')

    await plan.saveDayNote('2026-05-30', 'Anderer Kommentar')
    await expect(plan.moveDayNote('2026-05-29', '2026-05-30')).rejects.toBeInstanceOf(
      DayNoteMoveConflictError,
    )

    await plan.deleteDayNote('2026-05-29')
    expect(store.get('dayNotes', '2026-05-29')).toBeUndefined()
  })

  it('speichert Kalenderoptionen und Haushaltsgröße als gemeinsame Einstellungen', async () => {
    const { store, plan } = await setup()

    const settings = await plan.setCalendarSettings({
      weekStartDay: 0,
      overlapBefore: 3,
      overlapAfter: 1,
    })
    expect(settings).toEqual({ weekStartDay: 0, overlapBefore: 3, overlapAfter: 1 })
    expect(store.get<SettingRecord>('settings', 'weekStartDay')?.data.value).toBe(0)
    expect(store.get<SettingRecord>('settings', 'overlapBefore')?.data.value).toBe(3)
    expect(store.get<SettingRecord>('settings', 'overlapAfter')?.data.value).toBe(1)

    await plan.setHouseholdSize(5)
    expect(store.get<SettingRecord>('settings', 'householdSize')?.data.value).toBe(5)
    await plan.setHouseholdSize(500)
    expect(store.get<SettingRecord>('settings', 'householdSize')?.data.value).toBe(20)
  })
})

describe('Cloud-Wochenplanung – Konflikte, Fehler und Realtime', () => {
  it('verwirft eine konkurrierende Bearbeitung vollständig und lädt den Serverstand neu', async () => {
    const { backend, store, plan } = await setup([
      ['recipes', 'r1', makeRecipe('r1')],
    ])
    const initial = await plan.saveDishPlan({
      recipeId: 'r1',
      days: [{ date: '2026-05-29', servings: 2 }],
    })

    const secondStore = new CloudRecordsStore(backend)
    await secondStore.load()
    const secondPlan = createCloudPlanBackend(secondStore)

    const firstEdit = await plan.saveDishPlan({
      cookSessionId: initial.session.id,
      recipeId: 'r1',
      days: [
        {
          entryId: initial.entries[0]!.id,
          date: '2026-05-29',
          servings: 4,
        },
      ],
    })
    expect(firstEdit.session.servings).toBe(4)

    const callsBefore = backend.calls.length
    await expect(
      secondPlan.saveDishPlan({
        cookSessionId: initial.session.id,
        recipeId: 'r1',
        days: [
          {
            entryId: initial.entries[0]!.id,
            date: '2026-05-29',
            servings: 6,
          },
        ],
      }),
    ).rejects.toBeInstanceOf(CloudConflictError)

    // The rejected call reached the server exactly once and changed nothing.
    expect(backend.calls.length).toBe(callsBefore + 1)
    expect(backend.row<CookSession>('cookSessions', initial.session.id)?.data.servings).toBe(4)
    expect(
      backend.row<MealPlanEntry>('mealPlans', initial.entries[0]!.id)?.data.servings,
    ).toBe(4)

    // The stale store reloaded and sees the confirmed state.
    expect(readPlanData(secondStore)?.entries[0]?.servings).toBe(4)
    expect(readPlanData(secondStore)?.sessions[0]?.servings).toBe(4)
  })

  it('hinterlässt bei einem fehlgeschlagenen Schreibvorgang keine Teilplanung', async () => {
    const { backend, store, plan } = await setup([
      ['recipes', 'r1', makeRecipe('r1')],
    ])
    const initial = await plan.saveDishPlan({
      recipeId: 'r1',
      days: [
        { date: '2026-05-29', servings: 2 },
        { date: '2026-05-30', servings: 2 },
      ],
    })
    const before = structuredClone([...backend.rows.values()])

    backend.failNext = new Error('Netzwerkfehler')
    await expect(
      plan.saveDishPlan({
        cookSessionId: initial.session.id,
        recipeId: 'r1',
        days: [{ date: '2026-06-01', servings: 9 }],
      }),
    ).rejects.toThrow('Netzwerkfehler')

    expect([...backend.rows.values()]).toEqual(before)
    expect(readPlanData(store)?.entries).toHaveLength(2)
    expect(
      store.list<MealPlanEntry>('mealPlans').some((row) => row.data.date === '2026-06-01'),
    ).toBe(false)
  })

  it('übernimmt Realtime-Änderungen anderer Sitzungen in die Planungsansicht', () => {
    return setup([['recipes', 'r1', makeRecipe('r1')]]).then(({ backend, store }) => {
      const before = readPlanData(store)!
      expect(before.entries).toHaveLength(0)

      backend.emit({
        type: 'upsert',
        row: {
          collection: 'mealPlans',
          id: 'meal-remote',
          rev: 1,
          data: makeEntry('meal-remote', '2026-05-29'),
        },
      })
      const afterInsert = readPlanData(store)!
      expect(afterInsert.entries.map((entry) => entry.id)).toEqual(['meal-remote'])

      backend.emit({
        type: 'upsert',
        row: {
          collection: 'mealPlans',
          id: 'meal-remote',
          rev: 2,
          data: makeEntry('meal-remote', '2026-05-29', { servings: 5 }),
        },
      })
      expect(readPlanData(store)!.entries[0]!.servings).toBe(5)

      backend.emit({
        type: 'delete',
        collection: 'mealPlans',
        id: 'meal-remote',
        rev: 2,
      })
      expect(readPlanData(store)!.entries).toHaveLength(0)
    })
  })
})

describe('Cloud-Wochenplanung – Oberfläche', () => {
  it('rendert den vorhandenen Wochenplan mit Cloud-Daten und ohne Automatik', async () => {
    const today = new Date()
    const date = [
      today.getFullYear(),
      String(today.getMonth() + 1).padStart(2, '0'),
      String(today.getDate()).padStart(2, '0'),
    ].join('-')
    const session = makeSession('cook-1', { date })
    const entry = makeEntry('meal-1', date, { cookSessionId: 'cook-1' })
    const { plan } = await setup([
      ['recipes', 'r1', makeRecipe('r1', { title: 'Cloud-Pasta' })],
      ['cookSessions', 'cook-1', session],
      ['mealPlans', 'meal-1', entry],
    ])

    const html = renderToStaticMarkup(
      <PlanBackendProvider value={plan}>
        <PlanPage />
      </PlanBackendProvider>,
    )

    expect(html).toContain('Essensplan')
    expect(html).toContain('Cloud-Pasta')
    expect(html).toContain('Wochenbeginn')
    expect(html).not.toMatch(/automatisch/i)
    expect(html).not.toContain('Automatisch planen')
  })

  it('zeigt gelöschte Rezepte als fehlende Zuordnung statt als kaputte Planung', async () => {
    const today = new Date()
    const date = [
      today.getFullYear(),
      String(today.getMonth() + 1).padStart(2, '0'),
      String(today.getDate()).padStart(2, '0'),
    ].join('-')
    const { plan } = await setup([
      [
        'mealPlans',
        'meal-1',
        makeEntry('meal-1', date, { recipeId: 'deleted-recipe' }),
      ],
    ])

    const html = renderToStaticMarkup(
      <PlanBackendProvider value={plan}>
        <PlanPage />
      </PlanBackendProvider>,
    )

    expect(html).toContain('Rezept nicht gefunden')
    expect(html).toContain('Essensplan')
    expect(html).not.toContain('Lade Essensplan')
  })
})
