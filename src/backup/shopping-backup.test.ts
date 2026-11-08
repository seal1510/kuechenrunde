import { beforeEach, describe, expect, it } from 'vitest'
import { strToU8, zipSync } from 'fflate'
import { db } from '../db'
import { getCategoryOrder, saveCategoryOrder } from '../shopping/service'
import { shoppingItemKey } from '../domain/shopping'
import { BACKUP_FORMAT, exportBackup, inspectBackup, restoreBackup } from './backup'

async function clearAll(): Promise<void> {
  await db.recipes.clear()
  await db.images.clear()
  await db.cookSessions.clear()
  await db.mealPlans.clear()
  await db.mealDays.clear()
  await db.settings.clear()
  await db.dayNotes.clear()
  await db.freeDishes.clear()
  await db.shoppingManualItems.clear()
  await db.shoppingChecks.clear()
  await db.shoppingPurchases.clear()
  await db.shoppingItemRules.clear()
  await db.shoppingQuantityCorrections.clear()
  await db.shoppingLists.clear()
  await db.shoppingDemandAllocations.clear()
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

function emptyShoppingJson(version: number): Record<string, unknown> {
  return {
    version,
    shoppingManualItems: [],
    shoppingChecks: [],
    shoppingPurchases: [],
    shoppingItemRules: [],
    shoppingQuantityCorrections: [],
    pantryItems: [],
  }
}

beforeEach(async () => {
  await clearAll()
})

describe('shopping data in backups', () => {
  it('roundtrips dates, purchase actions, notes, merges and category order', async () => {
    await db.shoppingManualItems.put({
      id: 'manual-1',
      shoppingDate: '2026-11-05',
      weekStart: '2026-11-05',
      name: 'Kaffee',
      quantityText: '2',
      unit: 'Packung',
      purchaseNote: 'ganze Bohne',
      categoryId: 'drinks',
      createdAt: 1,
      updatedAt: 1,
    })
    await db.shoppingPurchases.put({
      id: 'purchase-1',
      shoppingDate: '2026-11-05',
      itemKey: 'zwiebel',
      amounts: [{ dimension: 'count', lower: 2, upper: 2 }],
      snapshot: [{ dimension: 'count', lower: 2, upper: 3 }],
      qualitative: false,
      createdAt: 1,
      updatedAt: 1,
    })
    await db.shoppingItemRules.put({
      key: 'zwiebel',
      canonicalKey: 'zwiebel',
      displayName: 'Gemüsezwiebeln',
      categoryId: 'produce',
      purchaseNote: 'bevorzugt rot',
      purchaseNoteOverride: false,
      hiddenPurchaseNotes: ['aus dem Garten'],
      updatedAt: 1,
    })
    await db.shoppingQuantityCorrections.put({
      id: 'zwiebel::2026-11-05::count',
      shoppingDate: '2026-11-05',
      itemKey: 'zwiebel',
      dimension: 'count',
      quantityText: '3',
      unit: 'Stück',
      sourceSignature: 'count|2|2|',
      createdAt: 1,
      updatedAt: 1,
    })
    await saveCategoryOrder(['canned', 'produce'])

    const { bytes, manifest } = await exportBackup()
    expect(manifest.version).toBe(10)
    expect(manifest.counts.shoppingPurchases).toBe(1)
    expect(manifest.counts.shoppingChecks).toBe(0)
    expect(manifest.counts.shoppingQuantityCorrections).toBe(1)

    const inspection = await inspectBackup(toArrayBuffer(bytes))
    expect(inspection.shoppingPurchases).toHaveLength(1)
    expect(inspection.shoppingPurchases[0]?.snapshot[0]?.upper).toBe(3)
    expect(inspection.shoppingManualItems[0]?.shoppingDate).toBe('2026-11-05')
    expect(inspection.shoppingItemRules[0]?.hiddenPurchaseNotes).toEqual(['aus dem Garten'])
    expect(inspection.shoppingQuantityCorrections[0]?.quantityText).toBe('3')

    await clearAll()
    const restore = await restoreBackup(inspection, 'merge')
    expect(restore.addedShoppingPurchases).toBe(1)
    expect((await db.shoppingPurchases.get('purchase-1'))?.amounts[0]?.lower).toBe(2)
    expect((await db.shoppingItemRules.get('zwiebel'))?.canonicalKey).toBe('zwiebel')
    expect((await db.shoppingQuantityCorrections.get('zwiebel::2026-11-05::count'))?.quantityText).toBe(
      '3',
    )
    expect((await getCategoryOrder())[0]).toBe('canned')

    const repeated = await restoreBackup(inspection, 'merge')
    expect(repeated.addedShoppingPurchases).toBe(0)
    expect(repeated.addedShoppingQuantityCorrections).toBe(0)
    expect(await db.shoppingPurchases.count()).toBe(1)
    expect(await db.shoppingQuantityCorrections.count()).toBe(1)
  })

  it('replaces local shopping rows in replace mode', async () => {
    await db.shoppingManualItems.put({
      id: 'backup-item',
      shoppingDate: '2026-11-05',
      name: 'Backup-Artikel',
      quantityText: null,
      unit: null,
      purchaseNote: '',
      categoryId: null,
      createdAt: 1,
      updatedAt: 1,
    })
    const inspection = await inspectBackup(toArrayBuffer((await exportBackup()).bytes))

    await clearAll()
    await db.shoppingManualItems.put({
      id: 'local-item',
      shoppingDate: '2026-11-05',
      name: 'Lokal',
      quantityText: null,
      unit: null,
      purchaseNote: '',
      categoryId: null,
      createdAt: 1,
      updatedAt: 1,
    })

    const restore = await restoreBackup(inspection, 'replace')
    expect(restore.addedShoppingManualItems).toBe(1)
    expect(await db.shoppingManualItems.get('local-item')).toBeUndefined()
    expect((await db.shoppingManualItems.get('backup-item'))?.name).toBe('Backup-Artikel')
  })

  it('converts a v5 aggregate check into exactly one purchase, also when merged twice', async () => {
    const manifest = {
      format: BACKUP_FORMAT,
      version: 5,
      createdAt: '2026-01-01T00:00:00.000Z',
      appVersion: '0.5.0',
      counts: {
        recipes: 0,
        images: 0,
        mealPlans: 0,
        mealDays: 0,
        settings: 0,
        dayNotes: 0,
        freeDishes: 0,
        shoppingManualItems: 1,
        shoppingChecks: 1,
        shoppingItemRules: 1,
        pantryItems: 0,
      },
      includes: ['shoppingList'],
    }
    const bytes = zipSync({
      'manifest.json': strToU8(JSON.stringify(manifest)),
      'recipes.json': strToU8(JSON.stringify({ version: 5, recipes: [] })),
      'images.json': strToU8(JSON.stringify({ version: 5, images: [] })),
      'mealplan.json': strToU8(
        JSON.stringify({
          version: 5,
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
          version: 5,
          shoppingManualItems: [
            {
              id: 'old-manual',
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
          shoppingChecks: [
            {
              id: '2026-11-05|zwiebel',
              weekStart: '2026-11-05',
              itemKey: 'zwiebel',
              checked: true,
              purchased: [{ dimension: 'count', lower: 2, upper: 2 }],
              updatedAt: 1,
            },
          ],
          shoppingItemRules: [
            {
              key: 'zwiebel',
              displayName: 'Zwiebeln',
              categoryId: 'produce',
              purchaseNote: 'bevorzugt rot',
              updatedAt: 1,
            },
          ],
          pantryItems: [],
        }),
      ),
    })

    const inspection = await inspectBackup(toArrayBuffer(bytes))
    expect(inspection.shoppingManualItems[0]?.shoppingDate).toBe('2026-11-05')
    expect(inspection.shoppingPurchases).toHaveLength(1)
    expect(inspection.shoppingPurchases[0]?.amounts[0]?.upper).toBe(2)
    expect(inspection.shoppingPurchases[0]?.qualitative).toBe(false)
    expect(inspection.shoppingItemRules[0]?.canonicalKey).toBe('zwiebel')

    await restoreBackup(inspection, 'merge')
    await restoreBackup(inspection, 'merge')
    expect(await db.shoppingPurchases.count()).toBe(1)
    expect(await db.shoppingChecks.count()).toBe(0)
  })

  it('imports an old v4 backup without any shopping section', async () => {
    const manifest = {
      format: BACKUP_FORMAT,
      version: 4,
      createdAt: '2026-01-01T00:00:00.000Z',
      appVersion: '0.4.0',
      counts: {
        recipes: 0,
        images: 0,
        mealPlans: 0,
        mealDays: 0,
        settings: 0,
        dayNotes: 0,
        freeDishes: 0,
      },
      includes: ['recipes', 'images', 'mealPlans'],
    }
    const bytes = zipSync({
      'manifest.json': strToU8(JSON.stringify(manifest)),
      'recipes.json': strToU8(JSON.stringify({ version: 4, recipes: [] })),
      'images.json': strToU8(JSON.stringify({ version: 4, images: [] })),
      'mealplan.json': strToU8(
        JSON.stringify({
          version: 4,
          mealPlans: [],
          mealDays: [],
          settings: [],
          cookSessions: [],
          dayNotes: [],
          freeDishes: [],
        }),
      ),
    })

    const inspection = await inspectBackup(toArrayBuffer(bytes))
    expect(inspection.shoppingManualItems).toEqual([])
    expect(inspection.shoppingPurchases).toEqual([])
    expect(inspection.shoppingChecks).toEqual([])
    expect(inspection.shoppingItemRules).toEqual([])

    const restore = await restoreBackup(inspection, 'merge')
    expect(restore.mode).toBe('merge')
    expect(await db.shoppingManualItems.count()).toBe(0)
    expect(await db.shoppingPurchases.count()).toBe(0)
  })

  it('keeps an empty v6 shopping section stable', async () => {
    const manifest = {
      format: BACKUP_FORMAT,
      version: 6,
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
        pantryItems: 0,
      },
      includes: ['shoppingList'],
    }
    const bytes = zipSync({
      'manifest.json': strToU8(JSON.stringify(manifest)),
      'recipes.json': strToU8(JSON.stringify({ version: 6, recipes: [] })),
      'images.json': strToU8(JSON.stringify({ version: 6, images: [] })),
      'mealplan.json': strToU8(
        JSON.stringify({
          version: 6,
          mealPlans: [],
          mealDays: [],
          settings: [],
          cookSessions: [],
          dayNotes: [],
          freeDishes: [],
        }),
      ),
      'shopping.json': strToU8(JSON.stringify(emptyShoppingJson(6))),
    })
    const inspection = await inspectBackup(toArrayBuffer(bytes))
    expect(inspection.shoppingPurchases).toEqual([])
    expect(inspection.shoppingChecks).toEqual([])
  })
})

describe('legacy pantry data', () => {
  it('imports a v6 backup and ignores its pantry section without losing shopping data', async () => {
    const manifest = {
      format: BACKUP_FORMAT,
      version: 6,
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
        shoppingManualItems: 1,
        shoppingChecks: 0,
        shoppingPurchases: 1,
        shoppingItemRules: 1,
        pantryItems: 1,
      },
      includes: ['shoppingList'],
    }
    const bytes = zipSync({
      'manifest.json': strToU8(JSON.stringify(manifest)),
      'recipes.json': strToU8(JSON.stringify({ version: 6, recipes: [] })),
      'images.json': strToU8(JSON.stringify({ version: 6, images: [] })),
      'mealplan.json': strToU8(
        JSON.stringify({
          version: 6,
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
          version: 6,
          shoppingManualItems: [
            {
              id: 'manual-1',
              shoppingDate: '2026-11-05',
              name: 'Milch',
              quantityText: '1',
              unit: 'l',
              purchaseNote: '',
              categoryId: 'dairy',
              createdAt: 1,
              updatedAt: 1,
            },
          ],
          shoppingChecks: [],
          shoppingPurchases: [
            {
              id: 'purchase-1',
              shoppingDate: '2026-11-05',
              itemKey: 'zwiebel',
              amounts: [{ dimension: 'count', lower: 2, upper: 2 }],
              snapshot: [{ dimension: 'count', lower: 2, upper: 2 }],
              pantrySnapshot: [{ dimension: 'count', lower: 2, upper: 2 }],
              qualitative: false,
              createdAt: 1,
              updatedAt: 1,
            },
          ],
          shoppingItemRules: [],
          pantryItems: [
            {
              id: 'pantry-1',
              itemKey: 'reis',
              name: 'Reis',
              quantityText: '200',
              unit: 'g',
              buyAnyway: false,
              createdAt: 1,
              updatedAt: 1,
            },
          ],
        }),
      ),
    })

    const inspection = await inspectBackup(toArrayBuffer(bytes))
    expect('pantryItems' in inspection).toBe(false)
    expect(inspection.shoppingPurchases[0]?.amounts[0]?.upper).toBe(2)
    expect(inspection.shoppingManualItems[0]?.name).toBe('Milch')

    const restore = await restoreBackup(inspection, 'replace')
    expect(restore.addedShoppingManualItems).toBe(1)
    expect(restore.addedShoppingPurchases).toBe(1)
    expect(await db.shoppingManualItems.count()).toBe(1)
    expect(await db.shoppingPurchases.count()).toBe(1)
    expect(await db.shoppingItemRules.count()).toBe(0)
    expect(db.tables.map((table) => table.name)).not.toContain('pantryItems')
  })
})

describe('old quantity corrections', () => {
  it('imports a v7 product-wide correction as legacy and never creates a weekly correction', async () => {
    const manifest = {
      format: BACKUP_FORMAT,
      version: 7,
      createdAt: '2026-01-01T00:00:00.000Z',
      appVersion: '0.7.0',
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
        shoppingItemRules: 2,
      },
      includes: ['shoppingList'],
    }
    const bytes = zipSync({
      'manifest.json': strToU8(JSON.stringify(manifest)),
      'recipes.json': strToU8(
        JSON.stringify({
          version: 7,
          recipes: [
            {
              id: 'r-pesto',
              title: 'Pesto',
              ingredients: [{ name: 'Pesto (grün)' }],
            },
          ],
        }),
      ),
      'images.json': strToU8(JSON.stringify({ version: 7, images: [] })),
      'mealplan.json': strToU8(
        JSON.stringify({
          version: 7,
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
          version: 7,
          shoppingManualItems: [],
          shoppingChecks: [],
          shoppingPurchases: [],
          shoppingItemRules: [
            {
              key: 'mehl',
              canonicalKey: 'mehl',
              displayName: 'Mehl',
              categoryId: 'grains',
              purchaseNote: '',
              quantityOverrideText: '1',
              unitOverride: 'kg',
              updatedAt: 1,
            },
            {
              key: 'pesto',
              canonicalKey: 'pesto',
              displayName: 'Pesto',
              categoryId: 'canned',
              purchaseNote: '',
              updatedAt: 1,
            },
          ],
        }),
      ),
    })

    const inspection = await inspectBackup(toArrayBuffer(bytes))
    expect(inspection.shoppingQuantityCorrections).toEqual([])
    expect(inspection.shoppingItemRules[0]?.legacyQuantityText).toBe('1')
    expect(inspection.shoppingItemRules[0]?.legacyUnit).toBe('kg')
    expect(inspection.shoppingItemRules[1]?.canonicalKey).toBe(
      shoppingItemKey('Pesto grün'),
    )

    await restoreBackup(inspection, 'replace')
    expect(await db.shoppingQuantityCorrections.count()).toBe(0)
    expect((await db.shoppingItemRules.get('mehl'))?.legacyQuantityText).toBe('1')
  })
})
