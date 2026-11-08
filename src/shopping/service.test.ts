import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../db'
import type { ShoppingAmountPosition } from '../domain/shopping'
import { standardShoppingListId } from '../domain/shoppingLists'
import {
  addManualItem,
  addShoppingPurchase,
  clearLegacyQuantity,
  categoryOrderFromRows,
  getCategoryOrder,
  mergeShoppingProducts,
  quantityCorrectionId,
  removeLastShoppingPurchase,
  resolveAmbiguousRule,
  removeManualItem,
  removeQuantityCorrection,
  removeShoppingPurchase,
  restoreManualItem,
  saveCategoryOrder,
  saveItemRule,
  saveQuantityCorrection,
  splitShoppingProduct,
  updateManualItem,
} from './service'

async function clearAll(): Promise<void> {
  await db.shoppingManualItems.clear()
  await db.shoppingChecks.clear()
  await db.shoppingPurchases.clear()
  await db.shoppingItemRules.clear()
  await db.shoppingQuantityCorrections.clear()
  await db.settings.clear()
}

function position(
  dimension: string,
  lower: number,
  upper = lower,
): ShoppingAmountPosition {
  return { dimension, unit: null, lower, upper, qualifier: '' }
}

const LIST_05 = standardShoppingListId('2026-11-05')
const LIST_12 = standardShoppingListId('2026-11-12')

beforeEach(async () => {
  await clearAll()
})

describe('manual shopping articles', () => {
  it('adds, edits and restores a manual article with an actual date', async () => {
    const created = await addManualItem({
      shoppingDate: '2026-11-05',
      name: '  Kaffee  ',
      quantityText: ' 2 ',
      unit: ' Packung ',
      purchaseNote: ' ganze Bohne ',
      categoryId: 'drinks',
    })
    expect(created.name).toBe('Kaffee')
    expect(created.shoppingDate).toBe('2026-11-05')
    expect(created.quantityText).toBe('2')
    expect(created.unit).toBe('Packung')

    const updated = await updateManualItem(created.id, { name: 'Espresso', quantityText: null })
    expect(updated.name).toBe('Espresso')
    expect(updated.quantityText).toBeNull()

    await removeManualItem(created.id)
    expect(await db.shoppingManualItems.get(created.id)).toBeUndefined()
    await restoreManualItem(updated)
    expect((await db.shoppingManualItems.get(created.id))?.name).toBe('Espresso')
  })

  it('keeps the old weekStart input working and rejects empty names/dates', async () => {
    const legacy = await addManualItem({ weekStart: '2026-05-07', name: 'Milch' })
    expect(legacy.shoppingDate).toBe('2026-05-07')
    await expect(addManualItem({ weekStart: '2026-05-07', name: '   ' })).rejects.toThrow()
    await expect(addManualItem({ weekStart: '07.05.2026', name: 'Milch' })).rejects.toThrow()
  })
})

describe('category order', () => {
  it('defaults to the full category list and persists a custom order', async () => {
    expect(categoryOrderFromRows(await db.settings.toArray())).toHaveLength(11)
    await saveCategoryOrder(['canned', 'produce', 'canned', 'unknown' as never])
    const stored = await getCategoryOrder()
    expect(stored[0]).toBe('canned')
    expect(stored[1]).toBe('produce')
    expect(stored.filter((entry) => entry === 'canned')).toHaveLength(1)
    expect(stored).toHaveLength(11)
  })

  it('ignores invalid stored JSON', () => {
    expect(categoryOrderFromRows([{ key: 'shoppingCategoryOrder', value: '{kaputt' }])).toHaveLength(
      11,
    )
  })
})

describe('individual purchase actions', () => {
  it('keeps two purchases separate and removes only the newest one', async () => {
    const first = await addShoppingPurchase({
      shoppingDate: '2026-11-05',
      itemKey: 'zwiebel',
      listId: LIST_05,
      amounts: [{ dimension: 'count', lower: 2, upper: 2 }],
      snapshot: [position('count', 2)],
    })
    const second = await addShoppingPurchase({
      shoppingDate: '2026-11-05',
      itemKey: 'zwiebel',
      listId: LIST_05,
      amounts: [{ dimension: 'count', lower: 3, upper: 3 }],
      snapshot: [position('count', 5)],
    })
    expect(second.createdAt).toBeGreaterThanOrEqual(first.createdAt)
    expect(second.confirmedTotal).toEqual([{ dimension: 'count', lower: 5, upper: 5 }])
    expect(await db.shoppingPurchases.count()).toBe(2)

    await removeLastShoppingPurchase('2026-11-05', 'zwiebel')
    const remaining = await db.shoppingPurchases.toArray()
    expect(remaining).toHaveLength(1)
    expect(remaining[0]?.amounts).toEqual([{ dimension: 'count', lower: 2, upper: 2 }])
  })

  it('removes an explicitly chosen older action without touching the others', async () => {
    const first = await addShoppingPurchase({
      shoppingDate: '2026-11-05',
      itemKey: 'zwiebel',
      listId: LIST_05,
      amounts: [{ dimension: 'count', lower: 2, upper: 2 }],
      snapshot: [position('count', 2)],
    })
    await addShoppingPurchase({
      shoppingDate: '2026-11-05',
      itemKey: 'zwiebel',
      listId: LIST_05,
      amounts: [{ dimension: 'count', lower: 3, upper: 3 }],
      snapshot: [position('count', 5)],
    })
    await removeShoppingPurchase(first.id)
    const remaining = await db.shoppingPurchases.toArray()
    expect(remaining).toHaveLength(1)
    expect(remaining[0]?.amounts[0]?.upper).toBe(3)
  })

  it('keeps purchases of different dates and product identities separate', async () => {
    await addShoppingPurchase({
      shoppingDate: '2026-11-05',
      itemKey: 'zwiebel',
      listId: LIST_05,
      amounts: [{ dimension: 'count', lower: 2, upper: 2 }],
      snapshot: [position('count', 2)],
    })
    await addShoppingPurchase({
      shoppingDate: '2026-11-12',
      itemKey: 'zwiebel',
      listId: LIST_12,
      amounts: [{ dimension: 'count', lower: 3, upper: 3 }],
      snapshot: [position('count', 3)],
    })
    await addShoppingPurchase({
      shoppingDate: '2026-11-05',
      itemKey: 'tomate',
      listId: LIST_05,
      amounts: [{ dimension: 'count', lower: 1, upper: 1 }],
      snapshot: [position('count', 1)],
    })
    expect(await db.shoppingPurchases.count()).toBe(3)
  })
})

describe('product identity merging', () => {
  it('merges identities, moves purchases and can split again', async () => {
    await saveItemRule('tomate mutti', { categoryId: 'produce' })
    await addShoppingPurchase({
      shoppingDate: '2026-11-05',
      itemKey: 'tomate mutti',
      listId: LIST_05,
      amounts: [{ dimension: 'volume', lower: 200, upper: 200 }],
      snapshot: [position('volume', 350)],
    })

    const target = await mergeShoppingProducts('tomate mutti', 'passierte tomate')
    expect(target).toBe('passierte tomate')
    expect((await db.shoppingItemRules.get('tomate mutti'))?.canonicalKey).toBe(
      'passierte tomate',
    )
    expect((await db.shoppingPurchases.toArray())[0]?.itemKey).toBe('passierte tomate')

    await splitShoppingProduct('tomate mutti')
    expect((await db.shoppingItemRules.get('tomate mutti'))?.canonicalKey).toBe('tomate mutti')
    // Existing purchases stay on the old target; no amount is invented.
    expect((await db.shoppingPurchases.toArray())[0]?.itemKey).toBe('passierte tomate')
  })

  it('keeps a merge and its purchase rows across a database close/open', async () => {
    await addShoppingPurchase({
      shoppingDate: '2026-11-05',
      itemKey: 'tomate mutti',
      listId: LIST_05,
      amounts: [{ dimension: 'volume', lower: 200, upper: 200 }],
      snapshot: [position('volume', 200)],
    })
    await mergeShoppingProducts('tomate mutti', 'tomate')
    db.close()
    await db.open()
    expect((await db.shoppingItemRules.get('tomate mutti'))?.canonicalKey).toBe('tomate')
    expect((await db.shoppingPurchases.toArray())[0]?.itemKey).toBe('tomate')
  })

  it('keeps named display/category corrections when merging into a plain identity', async () => {
    await saveItemRule('tomate mutti', {
      displayName: 'Tomaten',
      categoryId: 'canned',
      purchaseNote: 'bevorzugt Mutti',
    })
    await mergeShoppingProducts('tomate mutti', 'tomate')
    const target = await db.shoppingItemRules.get('tomate')
    expect(target?.canonicalKey).toBe('tomate')
    expect(target?.categoryId).toBe('canned')
    expect(target?.purchaseNote).toBe('bevorzugt Mutti')
  })

  it('resolves an ambiguous legacy rule to one explicit variant', async () => {
    await db.shoppingItemRules.put({
      key: 'pesto',
      canonicalKey: 'pesto',
      displayName: 'Pesto',
      categoryId: 'canned',
      purchaseNote: '',
      legacyAmbiguous: true,
      updatedAt: 1,
    })
    await resolveAmbiguousRule('pesto', 'pesto grun')
    const rule = await db.shoppingItemRules.get('pesto')
    expect(rule?.canonicalKey).toBe('pesto grun')
    expect(rule?.legacyAmbiguous).toBe(false)
    expect(rule?.displayName).toBe('Pesto')
  })

  it('moves week corrections on merge and keeps one row per week/dimension', async () => {
    await saveQuantityCorrection({
      shoppingDate: '2026-11-05',
      itemKey: 'tomate mutti',
      dimension: 'mass',
      quantityText: '1',
      unit: 'kg',
      sourceSignature: 'mass|500|500|',
    })
    await saveQuantityCorrection({
      shoppingDate: '2026-11-05',
      itemKey: 'tomate',
      dimension: 'mass',
      quantityText: '2',
      unit: 'kg',
      sourceSignature: 'mass|500|500|',
    })
    await mergeShoppingProducts('tomate mutti', 'tomate')
    await mergeShoppingProducts('tomate mutti', 'tomate')
    const rows = await db.shoppingQuantityCorrections.toArray()
    expect(rows).toHaveLength(1)
    expect(rows[0]?.itemKey).toBe('tomate')
    expect(rows[0]?.quantityText).toBe('2')
  })
})

describe('purchase note corrections', () => {
  it('stores hidden recipe hints and an override, and can reset them', async () => {
    await saveItemRule('zwiebel', {
      hiddenPurchaseNotes: ['bevorzugt rot'],
      purchaseNote: 'nur Bio',
      purchaseNoteOverride: true,
    })
    const rule = await db.shoppingItemRules.get('zwiebel')
    expect(rule?.hiddenPurchaseNotes).toEqual(['bevorzugt rot'])
    expect(rule?.purchaseNote).toBe('nur Bio')
    expect(rule?.purchaseNoteOverride).toBe(true)

    await saveItemRule('zwiebel', {
      hiddenPurchaseNotes: [],
      purchaseNote: '',
      purchaseNoteOverride: false,
    })
    expect(await db.shoppingItemRules.get('zwiebel')).toBeUndefined()
  })
})

describe('persistence', () => {
  it('keeps all new shopping data across a database close/open', async () => {
    await addManualItem({ shoppingDate: '2026-11-05', name: 'Milch' })
    await saveItemRule('milch', {
      categoryId: 'drinks',
      hiddenPurchaseNotes: ['bio'],
      purchaseNote: 'laktosefrei',
    })
    await addShoppingPurchase({
      shoppingDate: '2026-11-05',
      itemKey: 'milch',
      amounts: [{ dimension: 'volume', lower: 1000, upper: 1000 }],
      snapshot: [position('volume', 1000)],
    })
    await saveQuantityCorrection({
      shoppingDate: '2026-11-05',
      itemKey: 'milch',
      dimension: 'volume',
      quantityText: '1,5',
      unit: 'l',
      sourceSignature: 'volume|1000|1000|',
    })

    db.close()
    await db.open()

    expect(await db.shoppingManualItems.count()).toBe(1)
    expect((await db.shoppingItemRules.get('milch'))?.purchaseNote).toBe('laktosefrei')
    expect(await db.shoppingPurchases.count()).toBe(1)
    expect(await db.shoppingQuantityCorrections.count()).toBe(1)
  })
})

describe('article corrections', () => {
  it('saves a corrected name, category and hint as one product rule', async () => {
    await saveItemRule('zwiebel', {
      displayName: 'Gemüsezwiebeln',
      categoryId: 'produce',
      purchaseNote: 'bevorzugt rot',
      hiddenPurchaseNotes: ['aus dem Garten'],
    })
    const rule = await db.shoppingItemRules.get('zwiebel')
    expect(rule).toMatchObject({
      key: 'zwiebel',
      canonicalKey: 'zwiebel',
      displayName: 'Gemüsezwiebeln',
      categoryId: 'produce',
      purchaseNote: 'bevorzugt rot',
      hiddenPurchaseNotes: ['aus dem Garten'],
    })
  })
})

describe('week-scoped quantity corrections', () => {
  it('stores one correction per week and dimension and can remove it', async () => {
    const correction = await saveQuantityCorrection({
      shoppingDate: '2026-11-05',
      itemKey: 'mehl',
      dimension: 'mass',
      quantityText: '1',
      unit: 'kg',
      sourceSignature: 'mass|500|500|',
    })
    expect(correction.id).toBe(quantityCorrectionId('mehl', '2026-11-05', 'mass'))
    expect(await db.shoppingQuantityCorrections.count()).toBe(1)

    await saveQuantityCorrection({
      shoppingDate: '2026-11-05',
      itemKey: 'mehl',
      dimension: 'mass',
      quantityText: '2',
      unit: 'kg',
      sourceSignature: 'mass|500|500|',
    })
    expect(await db.shoppingQuantityCorrections.count()).toBe(1)
    expect(
      (await db.shoppingQuantityCorrections.get(correction.id))?.quantityText,
    ).toBe('2')

    await removeQuantityCorrection(correction.id)
    expect(await db.shoppingQuantityCorrections.count()).toBe(0)
  })

  it('rejects a unit that belongs to another dimension', async () => {
    await expect(
      saveQuantityCorrection({
        shoppingDate: '2026-11-05',
        itemKey: 'mehl',
        dimension: 'mass',
        quantityText: '2',
        unit: 'Stück',
        sourceSignature: 'mass|500|500|',
      }),
    ).rejects.toThrow()
  })

  it('clears a legacy product-wide correction explicitly', async () => {
    await db.shoppingItemRules.put({
      key: 'mehl',
      canonicalKey: 'mehl',
      displayName: 'Mehl',
      categoryId: 'grains',
      purchaseNote: '',
      legacyQuantityText: '1',
      legacyUnit: 'kg',
      updatedAt: 1,
    })
    await clearLegacyQuantity('mehl')
    const rule = await db.shoppingItemRules.get('mehl')
    expect(rule?.legacyQuantityText).toBe('')
    expect(rule?.displayName).toBe('Mehl')
  })

  it('keeps the retired pantry table out of the active database', async () => {
    expect(db.tables.map((table) => table.name)).not.toContain('pantryItems')
  })
})
