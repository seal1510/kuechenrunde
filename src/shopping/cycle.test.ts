/*
 * openCook Web
 * Copyright (C) 2026 openCook Web contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Focused synthetic tests for the simplified shopping settings. The shopping
 * weekday is a plain setting; existing standard lists and their shopping data
 * keep their persisted boundaries. All state lives in fake-indexeddb.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../db'
import { shoppingItemKey } from '../domain/shopping'
import {
  periodContainsDate,
  shoppingPeriod,
  shoppingPeriodFromRange,
  standardShoppingListId,
} from '../domain/shoppingLists'
import { deleteAllData } from '../import/importer'
import {
  adjacentShoppingPeriodStart,
  applyShoppingSettings,
  resolveShoppingPeriod,
} from './cycle'
import {
  assignShoppingSubquantity,
  createFreeShoppingList,
  createManualListItem,
  ensureStandardShoppingList,
  getOpenDemandByList,
  getShoppingPeriodDemand,
} from './listService'
import { addShoppingPurchase } from './service'
import {
  getShoppingSettings,
  normalizeLegacyShoppingSettingsRows,
  shoppingSettingsFromRows,
} from '../settings/shopping'
import { generatePlan } from '../mealplan/service'
import { getCalendarSettings, setCalendarSettings } from '../settings/calendar'
import { exportBackup, inspectBackup, restoreBackup } from '../backup/backup'
import type { CookSession, Ingredient, Recipe, ShoppingList } from '../types'

const THURSDAY = '2026-11-05'
const THURSDAY_END = '2026-11-11'

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer
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

function recipe(): Recipe {
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
  }
}

function session(id: string, date: string): CookSession {
  return {
    id,
    recipeId: 'r1',
    date,
    servings: 2,
    status: 'planned',
    auto: false,
    createdAt: 1,
    updatedAt: 1,
  }
}

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

async function seedRecipeAndSessions(dates: string[]): Promise<void> {
  await db.recipes.put(recipe())
  for (const [index, date] of dates.entries()) {
    await db.cookSessions.put(session(`s${index}`, date))
  }
}

async function standardLists(): Promise<ShoppingList[]> {
  return db.shoppingLists.where('kind').equals('standard').toArray()
}

function amountFor(key: string, demand: Awaited<ReturnType<typeof getShoppingPeriodDemand>>) {
  return demand.items.find((item) => item.key === key)?.positions[0]?.lower ?? 0
}

beforeEach(async () => {
  await clearAll()
})

describe('plain shopping settings', () => {
  it('starts existing installations with Thursday and a neutral name', async () => {
    const settings = await getShoppingSettings()
    expect(settings).toEqual({
      periodStartDay: 3,
      standardListName: 'Wocheneinkauf',
    })
    const list = await ensureStandardShoppingList(THURSDAY)
    expect(list.periodStart).toBe(THURSDAY)
    expect(list.periodEnd).toBe(THURSDAY_END)
    expect(list.name).toContain('Wocheneinkauf')
    expect(list.name).not.toContain('Donnerstag')
  })

  it('computes Monday, Saturday and Thursday periods from one general rule', () => {
    expect(shoppingPeriod('2026-11-09', 0)).toMatchObject({
      start: '2026-11-09',
      end: '2026-11-15',
    })
    expect(shoppingPeriod('2026-11-09', 5)).toMatchObject({
      start: '2026-11-07',
      end: '2026-11-13',
    })
    expect(shoppingPeriod('2026-11-09', 3)).toMatchObject({
      start: THURSDAY,
      end: THURSDAY_END,
    })
    expect(shoppingPeriod('2027-01-02', 3)).toMatchObject({
      start: '2026-12-31',
      end: '2027-01-06',
    })
  })

  it('keeps the calendar setting independent and persists weekday plus name', async () => {
    await setCalendarSettings({ weekStartDay: 0 })
    await applyShoppingSettings(
      { periodStartDay: 5, standardListName: 'Großeinkauf' },
      '2026-11-09',
    )
    expect((await getCalendarSettings()).weekStartDay).toBe(0)
    const settings = await getShoppingSettings()
    expect(settings.periodStartDay).toBe(5)
    expect(settings.standardListName).toBe('Großeinkauf')
    expect((await ensureStandardShoppingList('2026-11-16')).name).toContain('Großeinkauf')
    expect((await resolveShoppingPeriod('2026-11-16')).start).toBe('2026-11-14')
  })

  it('promotes a legacy pending weekday and drops only that obsolete row', () => {
    const rows = normalizeLegacyShoppingSettingsRows([
      { key: 'shoppingPeriodStartDay', value: 3 },
      { key: 'standardShoppingListName', value: 'Wocheneinkauf' },
      { key: 'householdSize', value: 4 },
      {
        key: 'shoppingCyclePending',
        value: JSON.stringify({ periodStartDay: 5, effectiveFrom: '2026-11-21' }),
      },
    ])
    expect(rows).toEqual(
      expect.arrayContaining([
        { key: 'shoppingPeriodStartDay', value: 5 },
        { key: 'standardShoppingListName', value: 'Wocheneinkauf' },
        { key: 'householdSize', value: 4 },
      ]),
    )
    expect(rows.some((row) => row.key === 'shoppingCyclePending')).toBe(false)
    expect(shoppingSettingsFromRows(rows)).toMatchObject({
      periodStartDay: 5,
      standardListName: 'Wocheneinkauf',
    })
  })
})

describe('changing the shopping weekday', () => {
  it('keeps purchases and period boundaries and trims only uncovered dates', async () => {
    await seedRecipeAndSessions(['2026-11-06', '2026-11-12', '2026-11-13', '2026-11-14'])
    const oldList = await ensureStandardShoppingList(THURSDAY)
    const purchase = await addShoppingPurchase({
      shoppingDate: '2026-11-06',
      itemKey: shoppingItemKey('Tomaten'),
      amounts: [{ dimension: 'count', lower: 2, upper: 2 }],
      snapshot: [{ dimension: 'count', unit: 'Stück', lower: 8, upper: 8, qualifier: '' }],
    })
    expect(purchase.listId).toBe(oldList.id)

    await applyShoppingSettings({ periodStartDay: 5 }, '2026-11-09')

    expect(await resolveShoppingPeriod(THURSDAY)).toMatchObject({
      start: THURSDAY,
      end: THURSDAY_END,
    })
    // The old list is authoritative until its persisted end. The new Saturday
    // rhythm only fills the remaining two days, without a stored transition.
    expect(await resolveShoppingPeriod('2026-11-12')).toMatchObject({
      start: '2026-11-12',
      end: '2026-11-13',
    })
    expect(await resolveShoppingPeriod('2026-11-14')).toMatchObject({
      start: '2026-11-14',
      end: '2026-11-20',
    })

    const storedPurchase = (await db.shoppingPurchases.toArray())[0]
    expect(storedPurchase?.listId).toBe(standardShoppingListId(THURSDAY))
    expect(storedPurchase?.shoppingDate).toBe('2026-11-06')
    expect(storedPurchase?.amounts).toEqual([
      { dimension: 'count', lower: 2, upper: 2 },
    ])
    expect(await db.shoppingLists.get(oldList.id)).toMatchObject({
      periodStart: THURSDAY,
      periodEnd: THURSDAY_END,
    })

    // Every planned dish belongs to exactly one visible period. The short
    // 12–13 Nov segment must not repeat the 5–11 Nov demand.
    const key = shoppingItemKey('Tomaten')
    expect(amountFor(key, await getShoppingPeriodDemand(THURSDAY))).toBe(8)
    expect(amountFor(key, await getShoppingPeriodDemand('2026-11-12'))).toBe(16)
    expect(amountFor(key, await getShoppingPeriodDemand('2026-11-14'))).toBe(8)
  })

  it('navigates through trimmed periods and back without gaps', async () => {
    await seedRecipeAndSessions(['2026-11-06'])
    await ensureStandardShoppingList(THURSDAY)
    await createManualListItem({
      listId: standardShoppingListId(THURSDAY),
      name: 'Milch',
      quantityText: '1',
      unit: 'l',
      shoppingDate: '2026-11-06',
    })
    await applyShoppingSettings({ periodStartDay: 5 }, '2026-11-09')
    const settings = await getShoppingSettings()
    const lists = await standardLists()

    const short = adjacentShoppingPeriodStart(THURSDAY, 1, settings, lists)
    expect(short).toBe('2026-11-12')
    const regular = adjacentShoppingPeriodStart(short, 1, settings, lists)
    expect(regular).toBe('2026-11-14')
    expect(adjacentShoppingPeriodStart(regular, -1, settings, lists)).toBe('2026-11-12')
    expect(adjacentShoppingPeriodStart(short, -1, settings, lists)).toBe(THURSDAY)
    expect(
      periodContainsDate(shoppingPeriodFromRange('2026-11-12', '2026-11-13'), '2026-11-13'),
    ).toBe(true)
  })

  it('removes empty current and future lists but preserves lists with data', async () => {
    await seedRecipeAndSessions(['2026-11-06'])
    // An empty list under the old rhythm must not block the new setting.
    await db.shoppingLists.put({
      id: standardShoppingListId('2026-11-05'),
      kind: 'standard',
      name: 'Wocheneinkauf · 05.11. – 11.11.2026',
      periodStart: '2026-11-05',
      periodEnd: '2026-11-11',
      createdAt: 1,
      updatedAt: 1,
    })
    await db.shoppingLists.put({
      id: standardShoppingListId('2026-11-12'),
      kind: 'standard',
      name: 'Wocheneinkauf · 12.11. – 18.11.2026',
      periodStart: '2026-11-12',
      periodEnd: '2026-11-18',
      createdAt: 1,
      updatedAt: 1,
    })
    // A future list with a manual article is real data and must survive.
    await db.shoppingLists.put({
      id: standardShoppingListId('2026-11-19'),
      kind: 'standard',
      name: 'Wocheneinkauf · 19.11. – 25.11.2026',
      periodStart: '2026-11-19',
      periodEnd: '2026-11-25',
      createdAt: 1,
      updatedAt: 1,
    })
    const manual = await createManualListItem({
      listId: standardShoppingListId('2026-11-19'),
      name: 'Milch',
      quantityText: '1',
      unit: 'l',
      shoppingDate: '2026-11-20',
    })

    await applyShoppingSettings({ periodStartDay: 5 }, '2026-11-09')

    expect(await db.shoppingLists.get(standardShoppingListId('2026-11-05'))).toBeUndefined()
    expect(await db.shoppingLists.get(standardShoppingListId('2026-11-12'))).toBeUndefined()
    expect(await db.shoppingLists.get(standardShoppingListId('2026-11-19'))).toMatchObject({
      periodStart: '2026-11-19',
      periodEnd: '2026-11-25',
    })
    expect((await db.shoppingManualItems.get(manual.id))?.listId).toBe(
      standardShoppingListId('2026-11-19'),
    )
    // The new rhythm applies only after the data-bearing future list.
    expect(await resolveShoppingPeriod('2026-11-20')).toMatchObject({
      start: '2026-11-19',
      end: '2026-11-25',
    })
    expect(await resolveShoppingPeriod('2026-11-26')).toMatchObject({
      start: '2026-11-26',
      end: '2026-11-27',
    })
  })

  it('renames existing generated lists on a name-only change without deleting them', async () => {
    await db.shoppingLists.put({
      id: standardShoppingListId('2026-11-12'),
      kind: 'standard',
      name: 'Wocheneinkauf · 12.11. – 18.11.2026',
      periodStart: '2026-11-12',
      periodEnd: '2026-11-18',
      createdAt: 1,
      updatedAt: 1,
    })
    await applyShoppingSettings({ standardListName: 'Großeinkauf' }, '2026-11-09')
    expect((await getShoppingSettings()).periodStartDay).toBe(3)
    expect(await db.shoppingLists.get(standardShoppingListId('2026-11-12'))).toMatchObject({
      periodStart: '2026-11-12',
      periodEnd: '2026-11-18',
    })
    expect((await db.shoppingLists.get(standardShoppingListId('2026-11-12')))?.name).toContain(
      'Großeinkauf',
    )
  })

  it('keeps existing allocations and manual articles attached after a change', async () => {
    await seedRecipeAndSessions(['2026-11-06'])
    await ensureStandardShoppingList(THURSDAY)
    const market = await createFreeShoppingList({ name: 'Markt' })
    const key = shoppingItemKey('Tomaten')
    const allocation = await assignShoppingSubquantity({
      periodStart: THURSDAY,
      itemKey: key,
      dimension: 'count',
      targetListId: market.id,
      quantity: 5,
    })
    const manual = await createManualListItem({
      listId: standardShoppingListId(THURSDAY),
      name: 'Milch',
      quantityText: '1',
      unit: 'l',
      shoppingDate: '2026-11-06',
    })
    await applyShoppingSettings({ periodStartDay: 5 }, '2026-11-09')
    expect((await db.shoppingDemandAllocations.get(allocation.allocation.id))?.periodStart).toBe(
      THURSDAY,
    )
    expect((await db.shoppingManualItems.get(manual.id))?.listId).toBe(
      standardShoppingListId(THURSDAY),
    )
    const open = await getOpenDemandByList(THURSDAY)
    expect(
      open.positions.find(
        (position) => position.itemKey === key && position.listId === market.id,
      ),
    ).toMatchObject({ assignedLower: 5, purchasedLower: 0, openLower: 5 })
  })

  it('reports overlapping persisted periods instead of guessing', async () => {
    await db.shoppingLists.bulkPut([
      {
        id: standardShoppingListId('2026-11-05'),
        kind: 'standard',
        name: 'Wocheneinkauf',
        periodStart: '2026-11-05',
        periodEnd: '2026-11-11',
        createdAt: 1,
        updatedAt: 1,
      },
      {
        id: standardShoppingListId('2026-11-07'),
        kind: 'standard',
        name: 'Wocheneinkauf',
        periodStart: '2026-11-07',
        periodEnd: '2026-11-13',
        createdAt: 1,
        updatedAt: 1,
      },
    ])
    await expect(resolveShoppingPeriod('2026-11-10')).rejects.toMatchObject({
      code: 'overlapping-periods',
    })
    await expect(getOpenDemandByList('2026-11-10')).rejects.toMatchObject({
      code: 'overlapping-periods',
    })
  })

  it('uses the configured period for automatic meal planning', async () => {
    await seedRecipeAndSessions([])
    await db.settings.put({ key: 'shoppingPeriodStartDay', value: 0 })
    const monday = await generatePlan({ today: '2026-11-09', seed: 1, restarts: 1 })
    expect(monday.dates[0]).toBe('2026-11-09')
    expect(monday.dates).toHaveLength(7)
    expect(monday.dates[6]).toBe('2026-11-15')

    await clearAll()
    await seedRecipeAndSessions([])
    await db.settings.put({ key: 'shoppingPeriodStartDay', value: 3 })
    const thursday = await generatePlan({ today: '2026-11-09', seed: 2, restarts: 1 })
    expect(thursday.dates).toEqual(['2026-11-09', '2026-11-10', '2026-11-11'])

    await clearAll()
    await seedRecipeAndSessions([])
    await db.settings.put({ key: 'shoppingPeriodStartDay', value: 5 })
    const saturday = await generatePlan({ today: '2026-11-09', seed: 3, restarts: 1 })
    expect(saturday.dates[0]).toBe('2026-11-09')
    expect(saturday.dates[4]).toBe('2026-11-13')
    expect(saturday.dates).toHaveLength(5)
  })
})

describe('backup integrity with the simplified settings', () => {
  it('roundtrips a Saturday setting and preserves persisted periods and purchases', async () => {
    await seedRecipeAndSessions(['2026-11-06', '2026-11-12'])
    await ensureStandardShoppingList(THURSDAY)
    await addShoppingPurchase({
      shoppingDate: '2026-11-06',
      itemKey: shoppingItemKey('Tomaten'),
      amounts: [{ dimension: 'count', lower: 2, upper: 2 }],
      snapshot: [],
    })
    await applyShoppingSettings({ periodStartDay: 5 }, '2026-11-09')
    const { bytes } = await exportBackup()
    const inspection = await inspectBackup(toArrayBuffer(bytes))
    expect(inspection.shoppingCycle.periodStartDay).toBe(5)
    expect(inspection.shoppingLists.map((list) => [list.periodStart, list.periodEnd])).toEqual(
      expect.arrayContaining([[THURSDAY, THURSDAY_END]]),
    )

    await clearAll()
    await db.settings.put({ key: 'shoppingPeriodStartDay', value: 3 })
    await db.settings.put({ key: 'standardShoppingListName', value: 'Wocheneinkauf' })
    await restoreBackup(inspection, 'replace')
    expect((await getShoppingSettings()).periodStartDay).toBe(5)
    expect((await resolveShoppingPeriod('2026-11-12')).end).toBe('2026-11-13')
    expect((await db.shoppingPurchases.toArray())[0]?.shoppingDate).toBe('2026-11-06')
    expect((await db.shoppingPurchases.toArray())[0]?.listId).toBe(
      standardShoppingListId(THURSDAY),
    )
  })

  it('merges a different shopping setting without re-dating imported periods', async () => {
    await seedRecipeAndSessions(['2026-11-06'])
    await ensureStandardShoppingList(THURSDAY)
    await addShoppingPurchase({
      shoppingDate: '2026-11-06',
      itemKey: shoppingItemKey('Tomaten'),
      amounts: [{ dimension: 'count', lower: 1, upper: 1 }],
      snapshot: [],
    })
    await applyShoppingSettings({ periodStartDay: 5 }, '2026-11-09')
    const { bytes } = await exportBackup()

    await clearAll()
    await db.settings.put({ key: 'shoppingPeriodStartDay', value: 0 })
    const before = shoppingSettingsFromRows(await db.settings.toArray())
    expect(before.periodStartDay).toBe(0)
    const inspection = await inspectBackup(toArrayBuffer(bytes))
    expect(inspection.conflicts.shoppingCycle).toBeGreaterThan(0)

    await restoreBackup(inspection, 'merge')
    // Merge keeps the local configuration, but imported periods keep their own
    // persisted boundaries instead of being recomputed with Monday.
    expect((await getShoppingSettings()).periodStartDay).toBe(0)
    expect(await resolveShoppingPeriod('2026-11-06')).toMatchObject({
      start: THURSDAY,
      end: THURSDAY_END,
    })
  })

  it('rejects a merge that would create overlapping standard periods', async () => {
    await db.shoppingLists.bulkPut([
      {
        id: standardShoppingListId('2026-11-05'),
        kind: 'standard',
        name: 'Wocheneinkauf',
        periodStart: '2026-11-05',
        periodEnd: '2026-11-11',
        createdAt: 1,
        updatedAt: 1,
      },
      {
        id: standardShoppingListId('2026-11-07'),
        kind: 'standard',
        name: 'Wocheneinkauf',
        periodStart: '2026-11-07',
        periodEnd: '2026-11-13',
        createdAt: 1,
        updatedAt: 1,
      },
    ])
    const { bytes } = await exportBackup()
    const inspection = await inspectBackup(toArrayBuffer(bytes))
    expect(inspection.conflicts.overlappingStandardPeriods).toBeGreaterThan(0)

    await db.shoppingLists.delete(standardShoppingListId('2026-11-07'))
    const localListsBefore = await db.shoppingLists.count()
    await expect(restoreBackup(inspection, 'merge')).rejects.toThrow(/überlappende Standardperioden/)
    expect(await db.shoppingLists.count()).toBe(localListsBefore)
  })
})

describe('complete data deletion', () => {
  it('clears every shopping table transactionally and keeps settings', async () => {
    await seedRecipeAndSessions(['2026-11-06'])
    await ensureStandardShoppingList(THURSDAY)
    const market = await createFreeShoppingList({ name: 'Markt' })
    await createManualListItem({
      listId: standardShoppingListId(THURSDAY),
      name: 'Milch',
      quantityText: '1',
      unit: 'l',
      shoppingDate: '2026-11-06',
    })
    await addShoppingPurchase({
      shoppingDate: '2026-11-06',
      itemKey: shoppingItemKey('Tomaten'),
      amounts: [{ dimension: 'count', lower: 1, upper: 1 }],
      snapshot: [],
    })
    await assignShoppingSubquantity({
      periodStart: THURSDAY,
      itemKey: shoppingItemKey('Tomaten'),
      dimension: 'count',
      targetListId: market.id,
      quantity: 2,
    })
    await db.shoppingItemRules.put({
      key: 'tomaten',
      displayName: 'Tomaten',
      categoryId: null,
      purchaseNote: '',
      updatedAt: 1,
    })
    await db.shoppingQuantityCorrections.put({
      id: 'corr',
      shoppingDate: '2026-11-06',
      itemKey: 'tomaten',
      dimension: 'count',
      quantityText: '8',
      unit: 'Stück',
      sourceSignature: 'sig',
      createdAt: 1,
      updatedAt: 1,
    })
    await db.shoppingChecks.put({
      id: `${THURSDAY}|tomaten`,
      weekStart: THURSDAY,
      itemKey: 'tomaten',
      checked: true,
      purchased: [{ dimension: 'count', lower: 1, upper: 1 }],
      shoppingDate: '2026-11-06',
      updatedAt: 1,
    })
    await db.settings.put({ key: 'householdSize', value: 4 })

    await deleteAllData()

    expect(await db.shoppingLists.count()).toBe(0)
    expect(await db.shoppingDemandAllocations.count()).toBe(0)
    expect(await db.shoppingManualItems.count()).toBe(0)
    expect(await db.shoppingPurchases.count()).toBe(0)
    expect(await db.shoppingItemRules.count()).toBe(0)
    expect(await db.shoppingQuantityCorrections.count()).toBe(0)
    expect(await db.shoppingChecks.count()).toBe(0)
    expect(await db.recipes.count()).toBe(0)
    expect((await db.settings.get('householdSize'))?.value).toBe(4)
  })

  it('rolls back the whole reset when one table fails', async () => {
    await db.recipes.put(recipe())
    await ensureStandardShoppingList(THURSDAY)
    const spy = vi
      .spyOn(db.shoppingLists, 'clear')
      .mockRejectedValueOnce(new Error('simulierter Fehler'))
    await expect(deleteAllData()).rejects.toThrow('simulierter Fehler')
    spy.mockRestore()
    expect(await db.recipes.count()).toBe(1)
    expect(await db.shoppingLists.get(standardShoppingListId(THURSDAY))).toBeTruthy()
  })
})
