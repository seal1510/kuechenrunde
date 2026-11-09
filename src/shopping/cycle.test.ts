/*
 * openCook Web
 * Copyright (C) 2026 openCook Web contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Focused synthetic tests for the configurable shopping cycle. They exercise
 * real Dexie/service state with fake-indexeddb, never the user's data.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { strToU8, zipSync } from 'fflate'
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
  applyShoppingCycleChange,
  previewShoppingCycleChange,
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
import { getShoppingSettings, shoppingSettingsFromRows } from '../settings/shopping'
import { generatePlan, getHouseholdSize, setHouseholdSize } from '../mealplan/service'
import { getCalendarSettings, setCalendarSettings } from '../settings/calendar'
import {
  BACKUP_FORMAT,
  BACKUP_VERSION,
  exportBackup,
  inspectBackup,
  restoreBackup,
} from '../backup/backup'
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

describe('shopping cycle configuration', () => {
  it('starts existing installations with Thursday and a neutral standard-list name', async () => {
    const settings = await getShoppingSettings()
    expect(settings).toEqual({
      periodStartDay: 3,
      standardListName: 'Wocheneinkauf',
      pending: null,
    })
    const list = await ensureStandardShoppingList(THURSDAY)
    expect(list.periodStart).toBe(THURSDAY)
    expect(list.periodEnd).toBe(THURSDAY_END)
    expect(list.name).toContain('Wocheneinkauf')
    expect(list.name).not.toContain('Donnerstag')
  })

  it('computes Monday, Saturday and Thursday periods from one general rule', async () => {
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

  it('keeps the visual calendar setting independent from the shopping weekday', async () => {
    await setCalendarSettings({ weekStartDay: 0 })
    await applyShoppingCycleChange({ periodStartDay: 5 }, '2026-11-09')
    expect((await getCalendarSettings()).weekStartDay).toBe(0)
    expect((await getShoppingSettings()).periodStartDay).toBe(5)
    expect((await resolveShoppingPeriod('2026-11-16')).start).toBe('2026-11-14')
  })

  it('persists the weekday and the freely chosen standard-list name', async () => {
    await applyShoppingCycleChange(
      { periodStartDay: 0, standardListName: 'Großeinkauf' },
      '2026-11-09',
    )
    const settings = await getShoppingSettings()
    expect(settings.periodStartDay).toBe(0)
    expect(settings.standardListName).toBe('Großeinkauf')
    expect((await ensureStandardShoppingList('2026-11-16')).name).toContain('Großeinkauf')
  })

  it('changes Thursday to Saturday with an explicit transition and no data re-dating', async () => {
    await seedRecipeAndSessions(['2026-11-06', '2026-11-12', '2026-11-13', '2026-11-14'])
    const oldList = await ensureStandardShoppingList(THURSDAY)
    const purchase = await addShoppingPurchase({
      shoppingDate: '2026-11-06',
      itemKey: shoppingItemKey('Tomaten'),
      amounts: [{ dimension: 'count', lower: 2, upper: 2 }],
      snapshot: [{ dimension: 'count', unit: 'Stück', lower: 8, upper: 8, qualifier: '' }],
    })
    expect(purchase.listId).toBe(oldList.id)

    const preview = await previewShoppingCycleChange({ periodStartDay: 5 }, '2026-11-09')
    expect(preview.blocked).toBe(false)
    expect(preview.currentPeriod).toMatchObject({ start: THURSDAY, end: THURSDAY_END })
    expect(preview.transition).toMatchObject({
      start: '2026-11-12',
      end: '2026-11-13',
      isTransition: true,
    })
    expect(preview.transition?.days).toHaveLength(2)
    expect(preview.firstRegularPeriod).toMatchObject({
      start: '2026-11-14',
      end: '2026-11-20',
    })

    await applyShoppingCycleChange({ periodStartDay: 5 }, '2026-11-09')

    const unchanged = await resolveShoppingPeriod(THURSDAY)
    expect(unchanged).toMatchObject({ start: THURSDAY, end: THURSDAY_END })
    const transition = await resolveShoppingPeriod('2026-11-12')
    expect(transition).toMatchObject({
      start: '2026-11-12',
      end: '2026-11-13',
      isTransition: true,
    })
    const regular = await resolveShoppingPeriod('2026-11-14')
    expect(regular).toMatchObject({ start: '2026-11-14', end: '2026-11-20' })

    // The existing purchase keeps its list, date and amount.
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

    // Each planned dish belongs to exactly one of the three periods.
    const key = shoppingItemKey('Tomaten')
    expect(amountFor(key, await getShoppingPeriodDemand(THURSDAY))).toBe(8)
    expect(amountFor(key, await getShoppingPeriodDemand('2026-11-12'))).toBe(16)
    expect(amountFor(key, await getShoppingPeriodDemand('2026-11-14'))).toBe(8)
  })

  it('navigates through the transition and back without gaps', async () => {
    await applyShoppingCycleChange({ periodStartDay: 5 }, '2026-11-09')
    const settings = await getShoppingSettings()
    const lists = await standardLists()
    const transition = adjacentShoppingPeriodStart(THURSDAY, 1, settings, lists)
    expect(transition).toBe('2026-11-12')
    const regular = adjacentShoppingPeriodStart(transition, 1, settings, lists)
    expect(regular).toBe('2026-11-14')
    expect(adjacentShoppingPeriodStart(regular, -1, settings, lists)).toBe('2026-11-12')
    expect(adjacentShoppingPeriodStart('2026-11-12', -1, settings, lists)).toBe(THURSDAY)
    expect(
      periodContainsDate(shoppingPeriodFromRange('2026-11-12', '2026-11-13'), '2026-11-13'),
    ).toBe(true)
  })

  it('removes an unused future standard list instead of blocking the change', async () => {
    await seedRecipeAndSessions(['2026-11-06'])
    await db.shoppingLists.put({
      id: standardShoppingListId('2026-11-12'),
      kind: 'standard',
      name: 'Wocheneinkauf · 12.11. – 18.11.2026',
      periodStart: '2026-11-12',
      periodEnd: '2026-11-18',
      createdAt: 1,
      updatedAt: 1,
    })
    const preview = await previewShoppingCycleChange({ periodStartDay: 5 }, '2026-11-09')
    expect(preview.blocked).toBe(false)
    expect(preview.mode).toBe('immediate')
    expect(preview.unusedFuturePeriods.map((period) => period.start)).toEqual(['2026-11-12'])

    await applyShoppingCycleChange({ periodStartDay: 5 }, '2026-11-09')
    expect((await getShoppingSettings())).toMatchObject({
      periodStartDay: 5,
      pending: null,
    })
    // The same start date is now the explicit two-day transition, not the old
    // empty regular list.
    expect(await db.shoppingLists.get(standardShoppingListId('2026-11-12'))).toMatchObject({
      periodStart: '2026-11-12',
      periodEnd: '2026-11-13',
      isTransition: true,
    })
  })

  it('schedules the new rhythm after binding future periods', async () => {
    await seedRecipeAndSessions(['2026-11-06', '2026-11-14'])
    await db.shoppingLists.put({
      id: standardShoppingListId('2026-11-12'),
      kind: 'standard',
      name: 'Wocheneinkauf · 12.11. – 18.11.2026',
      periodStart: '2026-11-12',
      periodEnd: '2026-11-18',
      createdAt: 1,
      updatedAt: 1,
    })
    // A planned cooking event makes the future period binding.
    const preview = await previewShoppingCycleChange({ periodStartDay: 5 }, '2026-11-09')
    expect(preview.blocked).toBe(false)
    expect(preview.mode).toBe('scheduled')
    expect(preview.bindingFuturePeriods.map((period) => period.start)).toEqual(['2026-11-12'])
    expect(preview.effectiveFrom).toBe('2026-11-21')
    expect(preview.transition).toMatchObject({
      start: '2026-11-19',
      end: '2026-11-20',
    })

    await applyShoppingCycleChange({ periodStartDay: 5 }, '2026-11-09')
    const settings = await getShoppingSettings()
    expect(settings.pending).toMatchObject({
      periodStartDay: 5,
      effectiveFrom: '2026-11-21',
    })
    expect((await db.shoppingLists.get(standardShoppingListId('2026-11-12')))?.periodEnd).toBe(
      '2026-11-18',
    )
    expect((await db.shoppingLists.get(standardShoppingListId('2026-11-19')))).toMatchObject({
      periodEnd: '2026-11-20',
      isTransition: true,
    })
    // No user action at the effective date: the pending day governs the date.
    expect((await resolveShoppingPeriod('2026-11-21')).start).toBe('2026-11-21')
    expect((await resolveShoppingPeriod('2026-11-19')).start).toBe('2026-11-19')
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
    await applyShoppingCycleChange({ periodStartDay: 5 }, '2026-11-09')
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
})

describe('backup and legacy integrity with configurable periods', () => {
  it('roundtrips Saturday periods and preserves them when imported into a Thursday install', async () => {
    await seedRecipeAndSessions(['2026-11-06', '2026-11-12'])
    await ensureStandardShoppingList(THURSDAY)
    await applyShoppingCycleChange({ periodStartDay: 5 }, '2026-11-09')
    await addShoppingPurchase({
      shoppingDate: '2026-11-06',
      itemKey: shoppingItemKey('Tomaten'),
      amounts: [{ dimension: 'count', lower: 2, upper: 2 }],
      snapshot: [],
    })
    const { bytes } = await exportBackup()
    const inspection = await inspectBackup(toArrayBuffer(bytes))
    expect(inspection.shoppingCycle.periodStartDay).toBe(5)
    expect(inspection.shoppingLists.map((list) => [list.periodStart, list.periodEnd])).toEqual(
      expect.arrayContaining([
        [THURSDAY, THURSDAY_END],
        ['2026-11-12', '2026-11-13'],
      ]),
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

  it('merges a different shopping cycle without re-dating the imported periods', async () => {
    await ensureStandardShoppingList(THURSDAY)
    await applyShoppingCycleChange({ periodStartDay: 5 }, '2026-11-09')
    const { bytes } = await exportBackup()

    await clearAll()
    await db.settings.put({ key: 'shoppingPeriodStartDay', value: 0 })
    const before = shoppingSettingsFromRows(await db.settings.toArray())
    expect(before.periodStartDay).toBe(0)
    const inspection = await inspectBackup(toArrayBuffer(bytes))
    expect(inspection.conflicts.shoppingCycle).toBeGreaterThan(0)

    await restoreBackup(inspection, 'merge')
    // Merge keeps the local configuration, but the imported periods keep their
    // own persisted boundaries instead of being recomputed with Monday.
    expect((await getShoppingSettings()).periodStartDay).toBe(0)
    expect((await resolveShoppingPeriod('2026-11-12')).end).toBe('2026-11-13')
  })

  it('marks new purchases as recorded and keeps truly unknown legacy rows ambiguous', async () => {
    await seedRecipeAndSessions(['2026-11-06'])
    await ensureStandardShoppingList(THURSDAY)
    const purchase = await addShoppingPurchase({
      shoppingDate: '2026-11-06',
      itemKey: shoppingItemKey('Tomaten'),
      amounts: [{ dimension: 'count', lower: 8, upper: 8 }],
      snapshot: [],
    })
    expect(purchase.provenance).toBe('recorded')

    const open = await getOpenDemandByList(THURSDAY)
    expect(
      open.positions.find((position) => position.itemKey === shoppingItemKey('Tomaten')),
    ).toMatchObject({ purchasedLower: 8, openLower: 0 })
    expect(open.serviceConflicts).toHaveLength(0)

    const { bytes } = await exportBackup()
    const inspection = await inspectBackup(toArrayBuffer(bytes))
    expect(inspection.shoppingPurchases[0]?.legacyWeekAmbiguous).toBeUndefined()

    // A genuinely old v10 aggregate backup has no provenance and no stored
    // historical week start; it must stay a review conflict.
    const legacy = zipSync({
      'manifest.json': strToU8(
        JSON.stringify({
          format: BACKUP_FORMAT,
          version: 10,
          createdAt: '2026-01-01T00:00:00.000Z',
          appVersion: '0.6.0',
          counts: {},
          includes: [],
        }),
      ),
      'recipes.json': strToU8(JSON.stringify({ version: 10, recipes: [] })),
      'images.json': strToU8(JSON.stringify({ version: 10, images: [] })),
      'mealplan.json': strToU8(
        JSON.stringify({
          version: 10,
          mealPlans: [],
          mealDays: [],
          settings: [],
          cookSessions: [],
          dayNotes: [],
          freeDishes: [],
        }),
      ),
      'shopping.json': strToU8(
        JSON.stringify({
          version: 10,
          shoppingLists: [
            {
              id: standardShoppingListId(THURSDAY),
              kind: 'standard',
              name: 'Standard',
              periodStart: THURSDAY,
              periodEnd: THURSDAY_END,
              createdAt: 1,
              updatedAt: 1,
            },
          ],
          shoppingPurchases: [
            {
              id: 'legacy-history',
              shoppingDate: '2026-11-09',
              itemKey: shoppingItemKey('Tomaten'),
              listId: standardShoppingListId(THURSDAY),
              amounts: [{ dimension: 'count', lower: 2, upper: 2 }],
              snapshot: [],
              qualitative: false,
              createdAt: 1,
              updatedAt: 1,
            },
          ],
        }),
      ),
    })
    const legacyInspection = await inspectBackup(toArrayBuffer(legacy))
    expect(legacyInspection.shoppingPurchases[0]?.legacyWeekAmbiguous).toBe(true)
  })

  it('reports and preserves a purchase whose manual article is missing', async () => {
    await db.shoppingPurchases.put({
      id: 'orphan-purchase',
      shoppingDate: '2026-11-06',
      itemKey: shoppingItemKey('Milch'),
      listId: standardShoppingListId(THURSDAY),
      manualItemId: 'missing-manual',
      amounts: [{ dimension: 'unit:l', lower: 1, upper: 1 }],
      snapshot: [],
      qualitative: false,
      createdAt: 1,
      updatedAt: 1,
    })
    const { bytes } = await exportBackup()
    const inspection = await inspectBackup(toArrayBuffer(bytes))
    expect(inspection.conflicts.orphanedManualPurchaseReferences).toBe(1)
    await clearAll()
    const result = await restoreBackup(inspection, 'replace')
    expect(result.orphanedManualPurchaseReferences).toBe(1)
    expect(await db.shoppingPurchases.get('orphan-purchase')).toMatchObject({
      manualItemId: 'missing-manual',
    })
    expect(await db.shoppingPurchases.count()).toBe(1)
  })

  it('surfaces a review conflict instead of counting an ambiguous historical purchase', async () => {
    await seedRecipeAndSessions(['2026-11-06'])
    await db.shoppingLists.put({
      id: standardShoppingListId(THURSDAY),
      kind: 'standard',
      name: 'Wocheneinkauf',
      periodStart: THURSDAY,
      periodEnd: THURSDAY_END,
      createdAt: 1,
      updatedAt: 1,
    })
    await db.shoppingPurchases.put({
      id: 'ambiguous-purchase',
      shoppingDate: '2026-11-06',
      itemKey: shoppingItemKey('Tomaten'),
      listId: standardShoppingListId(THURSDAY),
      legacyWeekAmbiguous: true,
      amounts: [{ dimension: 'count', lower: 8, upper: 8 }],
      snapshot: [],
      qualitative: false,
      createdAt: 1,
      updatedAt: 1,
    })
    const open = await getOpenDemandByList(THURSDAY)
    expect(open.serviceConflicts.some((conflict) => conflict.code === 'legacy-week-ambiguous')).toBe(
      true,
    )
    expect(
      open.positions.find((position) => position.itemKey === shoppingItemKey('Tomaten')),
    ).toMatchObject({ purchasedLower: 0, openLower: 8 })
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

describe('existing tests still see the historical default', () => {
  it('keeps the Thursday default available through the pure helper', () => {
    expect(shoppingPeriod(THURSDAY, 3).end).toBe(THURSDAY_END)
  })
})

describe('14A.3 period integrity', () => {
  async function putFutureList(start: string, end: string, isTransition = false) {
    await db.shoppingLists.put({
      id: standardShoppingListId(start),
      kind: 'standard',
      name: `Wocheneinkauf · ${start}`,
      periodStart: start,
      periodEnd: end,
      ...(isTransition ? { isTransition: true } : {}),
      createdAt: 1,
      updatedAt: 1,
    })
  }

  it('changes only the standard-list name while binding future periods exist', async () => {
    await seedRecipeAndSessions(['2026-11-06', '2026-11-14', '2026-11-21'])
    await putFutureList('2026-11-12', '2026-11-18')
    await putFutureList('2026-11-19', '2026-11-25')
    await db.shoppingLists.update(standardShoppingListId('2026-11-19'), {
      name: 'Mein Markt',
    })
    await applyShoppingCycleChange({ periodStartDay: 5 }, '2026-11-09')
    const before = await db.shoppingLists.get(standardShoppingListId('2026-11-12'))
    expect((await db.shoppingLists.get(standardShoppingListId('2026-11-19')))?.name).toBe(
      'Mein Markt',
    )

    await applyShoppingCycleChange({ standardListName: 'Großeinkauf' }, '2026-11-09')
    expect((await getShoppingSettings()).standardListName).toBe('Großeinkauf')
    expect((await db.shoppingLists.get(standardShoppingListId('2026-11-12')))).toMatchObject({
      periodStart: before?.periodStart,
      periodEnd: before?.periodEnd,
    })
    expect((await db.shoppingLists.get(standardShoppingListId('2026-11-12')))?.name).toContain(
      'Großeinkauf',
    )
    expect((await getShoppingSettings()).pending?.periodStartDay).toBe(5)
  })

  it('replaces a not-yet-effective change without waiting', async () => {
    await seedRecipeAndSessions(['2026-11-06', '2026-11-14'])
    await putFutureList('2026-11-12', '2026-11-18')
    await applyShoppingCycleChange({ periodStartDay: 5 }, '2026-11-09')
    expect((await getShoppingSettings()).pending?.effectiveFrom).toBe('2026-11-21')

    await applyShoppingCycleChange({ periodStartDay: 0 }, '2026-11-09')
    const settings = await getShoppingSettings()
    expect(settings.pending).toMatchObject({
      periodStartDay: 0,
      effectiveFrom: '2026-11-23',
    })
    // The old two-day pending transition was replaced by the new four-day one.
    expect(await db.shoppingLists.get(standardShoppingListId('2026-11-19'))).toMatchObject({
      periodEnd: '2026-11-22',
      isTransition: true,
    })
    expect((await resolveShoppingPeriod('2026-11-23')).start).toBe('2026-11-23')
  })

  it('can cancel a future planned change without touching binding periods', async () => {
    await seedRecipeAndSessions(['2026-11-06', '2026-11-14'])
    await putFutureList('2026-11-12', '2026-11-18')
    await applyShoppingCycleChange({ periodStartDay: 5 }, '2026-11-09')
    expect(await db.shoppingLists.get(standardShoppingListId('2026-11-19'))).toBeTruthy()

    await applyShoppingCycleChange(
      { periodStartDay: 3, standardListName: 'Wocheneinkauf' },
      '2026-11-09',
      { cancelPending: true },
    )
    expect((await getShoppingSettings()).pending).toBeNull()
    expect(await db.shoppingLists.get(standardShoppingListId('2026-11-19'))).toBeUndefined()
    expect(await db.shoppingLists.get(standardShoppingListId('2026-11-12'))).toMatchObject({
      periodEnd: '2026-11-18',
    })
  })

  it('reports existing overlapping periods instead of selecting the latest list', async () => {
    await putFutureList('2026-11-05', '2026-11-11')
    await putFutureList('2026-11-07', '2026-11-13')
    await expect(resolveShoppingPeriod('2026-11-10')).rejects.toMatchObject({
      code: 'overlapping-periods',
    })
    await expect(getOpenDemandByList('2026-11-10')).rejects.toMatchObject({
      code: 'overlapping-periods',
    })
  })

  it('rejects a backup merge that would overlap local standard periods', async () => {
    await seedRecipeAndSessions(['2026-11-06'])
    await putFutureList('2026-11-05', '2026-11-11')
    await putFutureList('2026-11-07', '2026-11-13')
    await db.shoppingPurchases.put({
      id: 'overlap-purchase',
      shoppingDate: '2026-11-10',
      itemKey: shoppingItemKey('Tomaten'),
      listId: standardShoppingListId('2026-11-07'),
      amounts: [{ dimension: 'count', lower: 2, upper: 2 }],
      snapshot: [],
      qualitative: false,
      createdAt: 1,
      updatedAt: 1,
    })
    const { bytes } = await exportBackup()
    const inspection = await inspectBackup(toArrayBuffer(bytes))
    expect(inspection.conflicts.overlappingStandardPeriods).toBeGreaterThan(0)

    // Simulate a local installation with only the Thursday period.
    await db.shoppingPurchases.delete('overlap-purchase')
    await db.shoppingLists.delete(standardShoppingListId('2026-11-07'))
    const localListsBefore = await db.shoppingLists.count()
    const localPurchasesBefore = await db.shoppingPurchases.count()

    await expect(restoreBackup(inspection, 'merge')).rejects.toThrow(/überlappende Standardperioden/)
    expect(await db.shoppingLists.count()).toBe(localListsBefore)
    expect(await db.shoppingPurchases.count()).toBe(localPurchasesBefore)
  })

  it('rejects a replace with internally overlapping standard periods', async () => {
    await putFutureList('2026-11-05', '2026-11-11')
    await putFutureList('2026-11-07', '2026-11-13')
    const { bytes } = await exportBackup()
    const inspection = await inspectBackup(toArrayBuffer(bytes))
    await clearAll()
    await db.recipes.put(recipe())
    await expect(restoreBackup(inspection, 'replace')).rejects.toThrow(
      /überlappende Standardperioden/,
    )
    expect(await db.recipes.count()).toBe(1)
    expect(await db.shoppingLists.count()).toBe(0)
  })

  it('never counts a purchase with a foreign explicit listId in the wrong period', async () => {
    await seedRecipeAndSessions(['2026-11-06'])
    await putFutureList('2026-11-05', '2026-11-11')
    await putFutureList('2026-11-12', '2026-11-18')
    const purchase = await addShoppingPurchase({
      shoppingDate: '2026-11-06',
      itemKey: shoppingItemKey('Tomaten'),
      listId: standardShoppingListId('2026-11-12'),
      amounts: [{ dimension: 'count', lower: 8, upper: 8 }],
      snapshot: [],
    })
    expect(purchase.listId).toBe(standardShoppingListId('2026-11-12'))

    const current = await getOpenDemandByList('2026-11-05')
    expect(current.serviceConflicts.some((conflict) => conflict.code === 'purchase-list-mismatch')).toBe(
      true,
    )
    expect(
      current.positions.find((position) => position.itemKey === shoppingItemKey('Tomaten')),
    ).toMatchObject({ purchasedLower: 0, openLower: 8 })
  })

  it('keeps an orphaned manual purchase visible as a conflict in the shopping read path', async () => {
    await seedRecipeAndSessions(['2026-11-06'])
    await ensureStandardShoppingList('2026-11-05')
    await db.shoppingPurchases.put({
      id: 'orphan-read',
      shoppingDate: '2026-11-06',
      itemKey: shoppingItemKey('Milch'),
      listId: standardShoppingListId('2026-11-05'),
      manualItemId: 'missing-manual',
      amounts: [{ dimension: 'unit:l', lower: 1, upper: 1 }],
      snapshot: [],
      qualitative: false,
      createdAt: 1,
      updatedAt: 1,
    })
    const open = await getOpenDemandByList('2026-11-05')
    expect(
      open.serviceConflicts.some(
        (conflict) =>
          conflict.code === 'orphaned-manual-purchase' &&
          conflict.purchaseId === 'orphan-read' &&
          conflict.manualItemId === 'missing-manual',
      ),
    ).toBe(true)
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

    await clearAll()
    await seedRecipeAndSessions([])
    await db.settings.put({ key: 'shoppingPeriodStartDay', value: 5 })
    await putFutureList('2026-11-12', '2026-11-13', true)
    const transition = await generatePlan({ today: '2026-11-12', seed: 4, restarts: 1 })
    expect(transition.dates).toEqual(['2026-11-12', '2026-11-13'])
  })

  it('preserves manual items and purchases in binding future periods when scheduling', async () => {
    await seedRecipeAndSessions(['2026-11-06'])
    await putFutureList('2026-11-12', '2026-11-18')
    const manual = await createManualListItem({
      listId: standardShoppingListId('2026-11-12'),
      name: 'Milch',
      quantityText: '1',
      unit: 'l',
      shoppingDate: '2026-11-14',
    })
    const purchase = await addShoppingPurchase({
      shoppingDate: '2026-11-14',
      itemKey: shoppingItemKey('Tomaten'),
      listId: standardShoppingListId('2026-11-12'),
      amounts: [{ dimension: 'count', lower: 2, upper: 2 }],
      snapshot: [],
    })

    await applyShoppingCycleChange({ periodStartDay: 5 }, '2026-11-09')
    expect((await getShoppingSettings()).pending?.effectiveFrom).toBe('2026-11-21')
    expect(await db.shoppingLists.get(standardShoppingListId('2026-11-12'))).toMatchObject({
      periodStart: '2026-11-12',
      periodEnd: '2026-11-18',
    })
    expect((await db.shoppingManualItems.get(manual.id))?.listId).toBe(
      standardShoppingListId('2026-11-12'),
    )
    expect((await db.shoppingPurchases.get(purchase.id))?.listId).toBe(
      standardShoppingListId('2026-11-12'),
    )
  })

  it('roundtrips a planned cycle change through backup replace', async () => {
    await seedRecipeAndSessions(['2026-11-06', '2026-11-14'])
    await putFutureList('2026-11-12', '2026-11-18')
    await applyShoppingCycleChange({ periodStartDay: 5 }, '2026-11-09')
    const { bytes } = await exportBackup()
    const inspection = await inspectBackup(toArrayBuffer(bytes))
    expect(inspection.shoppingCycle.pending).toMatchObject({
      periodStartDay: 5,
      effectiveFrom: '2026-11-21',
    })

    await clearAll()
    await restoreBackup(inspection, 'replace')
    expect((await getShoppingSettings()).pending).toMatchObject({
      periodStartDay: 5,
      effectiveFrom: '2026-11-21',
    })
    expect((await resolveShoppingPeriod('2026-11-21')).start).toBe('2026-11-21')
    expect((await resolveShoppingPeriod('2026-11-19')).end).toBe('2026-11-20')
  })

  it('rejects a merge with a different planned cycle change', async () => {
    await seedRecipeAndSessions(['2026-11-06', '2026-11-14'])
    await putFutureList('2026-11-12', '2026-11-18')
    await applyShoppingCycleChange({ periodStartDay: 5 }, '2026-11-09')
    const { bytes } = await exportBackup()

    await clearAll()
    await db.settings.put({ key: 'shoppingPeriodStartDay', value: 0 })
    const inspection = await inspectBackup(toArrayBuffer(bytes))
    await expect(restoreBackup(inspection, 'merge')).rejects.toThrow(
      /geplante Rhythmusänderung/,
    )
  })

  it('persists a household size changed through the existing setting service', async () => {
    await setHouseholdSize(4)
    expect(await getHouseholdSize()).toBe(4)
    expect((await db.settings.get('householdSize'))?.value).toBe(4)
  })
})
