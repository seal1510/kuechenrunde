import { beforeEach, describe, expect, it } from 'vitest'
import { strToU8, zipSync } from 'fflate'
import { db } from '../db'
import { shoppingItemKey } from '../domain/shopping'
import {
  shoppingPeriod,
  standardShoppingListId,
} from '../domain/shoppingLists'
import {
  assignShoppingSubquantity,
  createFreeShoppingList,
  createManualListItem,
  ensureStandardShoppingList,
  getShoppingDistribution,
} from '../shopping/listService'
import type { CookSession, Ingredient, Recipe } from '../types'
import {
  BACKUP_FORMAT,
  BACKUP_VERSION,
  exportBackup,
  inspectBackup,
  restoreBackup,
} from './backup'

const PERIOD = '2026-11-05'

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
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

function ingredient(): Ingredient {
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

function session(): CookSession {
  return {
    id: 's1',
    recipeId: 'r1',
    date: PERIOD,
    servings: 2,
    status: 'planned',
    auto: false,
    createdAt: 1,
    updatedAt: 1,
  }
}

function standardId(): string {
  return standardShoppingListId(shoppingPeriod(PERIOD, 3).start)
}

function minimalBackup(version: number, shopping: Record<string, unknown>) {
  const manifest = {
    format: BACKUP_FORMAT,
    version,
    createdAt: '2026-01-01T00:00:00.000Z',
    appVersion: '0.6.0',
    counts: {
      recipes: 0,
      images: 0,
      mealPlans: 0,
      mealDays: 0,
      settings: 0,
      dayNotes: 0,
      freeDishes: 0,
      shoppingManualItems: 0,
      shoppingChecks: 0,
      shoppingPurchases: 0,
      shoppingItemRules: 0,
      shoppingQuantityCorrections: 0,
      shoppingLists: 0,
      shoppingDemandAllocations: 0,
    },
    includes: ['shoppingList', 'shoppingLists'],
  }
  return zipSync({
    'manifest.json': strToU8(JSON.stringify(manifest)),
    'recipes.json': strToU8(JSON.stringify({ version, recipes: [] })),
    'images.json': strToU8(JSON.stringify({ version, images: [] })),
    'mealplan.json': strToU8(
      JSON.stringify({
        version,
        mealPlans: [],
        mealDays: [],
        settings: [],
        cookSessions: [],
        dayNotes: [],
        freeDishes: [],
      }),
    ),
    'shopping.json': strToU8(JSON.stringify({ version, ...shopping })),
  })
}

beforeEach(async () => {
  await clearAll()
})

describe('shopping lists in backups', () => {
  it('roundtrips lists, partial allocations, manual articles and purchases', async () => {
    await db.recipes.put(recipe())
    await db.cookSessions.put(session())
    await ensureStandardShoppingList(PERIOD)
    const market = await createFreeShoppingList({ name: 'Markt Samstag' })
    const key = shoppingItemKey('Tomaten')
    await assignShoppingSubquantity({
      periodStart: PERIOD,
      itemKey: key,
      dimension: 'count',
      targetListId: market.id,
      quantity: 5,
    })
    const manual = await createManualListItem({
      listId: market.id,
      name: 'Blumen',
      quantityText: '1',
      unit: 'Bund',
      shoppingDate: PERIOD,
    })
    await db.shoppingPurchases.put({
      id: 'purchase-market',
      shoppingDate: PERIOD,
      itemKey: key,
      listId: market.id,
      amounts: [{ dimension: 'count', lower: 2, upper: 2 }],
      snapshot: [{ dimension: 'count', lower: 5, upper: 5 }],
      qualitative: false,
      createdAt: 1,
      updatedAt: 1,
    })

    const { bytes, manifest } = await exportBackup()
    expect(manifest.version).toBe(BACKUP_VERSION)
    expect(manifest.counts.shoppingLists).toBe(2)
    expect(manifest.counts.shoppingDemandAllocations).toBe(1)
    expect(manifest.includes).toContain('shoppingDemandAllocations')

    const inspection = await inspectBackup(toArrayBuffer(bytes))
    expect(inspection.shoppingLists.map((list) => list.name).sort()).toEqual([
      'Markt Samstag',
      'Wocheneinkauf · 05.11. – 11.11.2026',
    ])
    expect(inspection.shoppingDemandAllocations).toHaveLength(1)
    expect(inspection.shoppingDemandAllocations[0]?.quantityMilli).toBe(5000)
    expect(inspection.shoppingManualItems[0]?.listId).toBe(market.id)
    expect(inspection.shoppingPurchases[0]?.listId).toBe(market.id)

    await clearAll()
    const restored = await restoreBackup(inspection, 'replace')
    expect(restored.addedShoppingLists).toBe(2)
    expect(restored.addedShoppingDemandAllocations).toBe(1)
    expect(await db.shoppingLists.count()).toBe(2)
    expect((await db.shoppingDemandAllocations.get(
      `${PERIOD}|${key}|count|${market.id}`,
    ))?.quantityMilli).toBe(5000)
    expect((await db.shoppingManualItems.get(manual.id))?.listId).toBe(market.id)
    expect((await db.shoppingPurchases.get('purchase-market'))?.listId).toBe(market.id)

    const distribution = await getShoppingDistribution(PERIOD)
    const position = distribution.positions.find(
      (entry) => entry.itemKey === key && entry.dimension === 'count',
    )
    expect(position?.amounts.find((amount) => amount.listId === market.id)?.lower).toBe(5)
    expect(position?.amounts.find((amount) => amount.listId === standardId())?.lower).toBe(3)

    // Repeated merge imports must not duplicate lists or allocations.
    const first = await restoreBackup(inspection, 'merge')
    expect(first.addedShoppingLists).toBe(0)
    expect(first.addedShoppingDemandAllocations).toBe(0)
    const second = await restoreBackup(inspection, 'merge')
    expect(second.addedShoppingLists).toBe(0)
    expect(second.addedShoppingDemandAllocations).toBe(0)
    expect(await db.shoppingLists.count()).toBe(2)
    expect(await db.shoppingDemandAllocations.count()).toBe(1)
  })

  it('imports an older v9 backup and attaches rows to the Thursday list', async () => {
    const bytes = minimalBackup(9, {
      shoppingManualItems: [
        {
          id: 'old-manual',
          shoppingDate: '2026-11-05',
          weekStart: '2026-11-05',
          name: 'Milch',
          quantityText: '1',
          unit: 'l',
          purchaseNote: '',
          categoryId: 'dairy',
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      shoppingPurchases: [
        {
          id: 'old-purchase',
          shoppingDate: '2026-11-09',
          itemKey: 'zwiebel',
          amounts: [{ dimension: 'count', lower: 2, upper: 2 }],
          snapshot: [{ dimension: 'count', lower: 3, upper: 3 }],
          qualitative: false,
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      shoppingItemRules: [],
      shoppingQuantityCorrections: [],
    })

    const inspection = await inspectBackup(toArrayBuffer(bytes))
    expect(inspection.shoppingLists).toHaveLength(1)
    expect(inspection.shoppingLists[0]?.id).toBe(standardId())
    expect(inspection.shoppingManualItems[0]?.listId).toBe(standardId())
    // 2026-11-09 is a Monday inside the same Thursday–Wednesday period. The
    // list is deterministic, but the original calendar week is not stored, so
    // the purchase must stay a review conflict.
    expect(inspection.shoppingPurchases[0]?.listId).toBe(standardId())
    expect(inspection.shoppingPurchases[0]?.legacyWeekAmbiguous).toBe(true)
    expect(inspection.shoppingManualItems[0]?.legacyWeekAmbiguous).toBeUndefined()
    expect(inspection.shoppingPurchases[0]?.snapshot[0]?.upper).toBe(3)

    await restoreBackup(inspection, 'merge')
    expect((await db.shoppingManualItems.get('old-manual'))?.shoppingDate).toBe('2026-11-05')
    expect(await db.shoppingLists.count()).toBe(1)
    // A repeated import does not duplicate the generated standard list.
    await restoreBackup(inspection, 'merge')
    expect(await db.shoppingLists.count()).toBe(1)
    expect(await db.shoppingPurchases.count()).toBe(1)
  })

  it('normalises an old Monday-week backup in both merge and replace', async () => {
    const bytes = minimalBackup(10, {
      shoppingManualItems: [
        {
          id: 'monday-manual',
          shoppingDate: '2026-11-06',
          weekStart: '2026-11-02',
          name: 'Milch',
          quantityText: '1',
          unit: 'l',
          purchaseNote: '',
          categoryId: 'dairy',
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      shoppingPurchases: [
        {
          id: 'monday-purchase',
          shoppingDate: '2026-11-06',
          itemKey: shoppingItemKey('Milch'),
          amounts: [{ dimension: 'unit:l', lower: 1, upper: 1 }],
          snapshot: [],
          qualitative: false,
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      shoppingItemRules: [],
      shoppingQuantityCorrections: [],
    })

    const inspection = await inspectBackup(toArrayBuffer(bytes))
    expect(inspection.shoppingManualItems[0]?.legacyWeekAmbiguous).toBe(true)
    expect(inspection.shoppingPurchases[0]?.legacyWeekAmbiguous).toBe(true)

    await restoreBackup(inspection, 'merge')
    expect((await db.shoppingManualItems.get('monday-manual'))?.legacyWeekAmbiguous).toBe(true)
    expect((await db.shoppingPurchases.get('monday-purchase'))?.legacyWeekAmbiguous).toBe(true)

    await restoreBackup(inspection, 'replace')
    expect(await db.shoppingManualItems.count()).toBe(1)
    expect(await db.shoppingPurchases.count()).toBe(1)
    expect((await db.shoppingManualItems.get('monday-manual'))?.legacyWeekAmbiguous).toBe(true)
    expect((await db.shoppingPurchases.get('monday-purchase'))?.legacyWeekAmbiguous).toBe(true)
  })

  it('drops orphaned allocation references and keeps the affected rows safe', async () => {
    const bytes = minimalBackup(10, {
      shoppingLists: [
        {
          id: standardId(),
          kind: 'standard',
          name: 'Donnerstags-Einkauf',
          periodStart: PERIOD,
          periodEnd: '2026-11-11',
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      shoppingManualItems: [
        {
          id: 'manual-orphan',
          shoppingDate: PERIOD,
          weekStart: PERIOD,
          listId: 'missing-free-list',
          name: 'Milch',
          quantityText: '1',
          unit: 'l',
          purchaseNote: '',
          categoryId: 'dairy',
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      shoppingPurchases: [],
      shoppingItemRules: [],
      shoppingQuantityCorrections: [],
      shoppingDemandAllocations: [
        {
          id: 'orphan-allocation',
          periodStart: PERIOD,
          itemKey: 'tomate',
          dimension: 'count',
          listId: 'missing-free-list',
          mode: 'partial',
          quantityMilli: 3000,
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    })

    const inspection = await inspectBackup(toArrayBuffer(bytes))
    expect(inspection.shoppingDemandAllocations).toHaveLength(0)
    expect(inspection.warnings.some((warning) => warning.includes('fehlende Einkaufsliste'))).toBe(
      true,
    )
    expect(inspection.shoppingManualItems[0]?.listId).toBe(standardId())
    expect(inspection.shoppingManualItems[0]?.legacyWeekAmbiguous).toBe(true)

    await restoreBackup(inspection, 'merge')
    expect(await db.shoppingDemandAllocations.count()).toBe(0)
    expect((await db.shoppingManualItems.get('manual-orphan'))?.listId).toBe(standardId())
    expect((await db.shoppingManualItems.get('manual-orphan'))?.legacyWeekAmbiguous).toBe(true)
  })

  it('clears all shopping lists and allocations in replace mode', async () => {
    await ensureStandardShoppingList(PERIOD)
    const market = await createFreeShoppingList({ name: 'Markt' })
    await db.shoppingDemandAllocations.put({
      id: 'local-allocation',
      periodStart: PERIOD,
      itemKey: 'tomate',
      dimension: 'count',
      listId: market.id,
      mode: 'partial',
      quantityMilli: 3000,
      createdAt: 1,
      updatedAt: 1,
    })
    const inspection = await inspectBackup(
      toArrayBuffer((await exportBackup()).bytes),
    )
    await restoreBackup(inspection, 'replace')
    expect(await db.shoppingLists.count()).toBe(2)
    expect(await db.shoppingDemandAllocations.count()).toBe(1)
  })
})
