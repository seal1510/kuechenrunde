/*
 * Küchenrunde – Tests der Cloud-Einkaufsliste
 * Copyright (C) 2026 openCook Web contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { CloudConflictError } from '../data/cloudErrors'
import { CloudRecordsStore } from '../data/cloudRecords'
import { todayKey } from '../domain/dates'
import { shoppingItemKey, shoppingPositionSignature } from '../domain/shopping'
import {
  buildShoppingPageView,
  type ShoppingPageView,
} from '../shopping/pageView'
import { ShoppingBackendProvider, type ShoppingData } from '../shopping/shoppingBackend'
import { ShoppingPage } from '../pages/ShoppingPage'
import { createCloudPlanBackend } from './cloudPlanBackend'
import {
  createCloudShoppingBackend,
  readShoppingData,
} from './cloudShoppingBackend'
import { createTestStore, TestRecordsBackend } from './recordsTestBackend'
import type {
  CookSession,
  Ingredient,
  Recipe,
  ShoppingManualItem,
  ShoppingPurchase,
} from '../types'

const TODAY = '2026-05-25'

const SETTINGS_ROWS: Array<[string, string, unknown]> = [
  [
    'settings',
    'shoppingPeriodStartDay',
    { key: 'shoppingPeriodStartDay', value: 0 },
  ],
  [
    'settings',
    'standardShoppingListName',
    { key: 'standardShoppingListName', value: 'Wocheneinkauf' },
  ],
]

function ingredient(
  name: string,
  quantity: number | null,
  unit: string | null,
  position = 0,
): Ingredient {
  return {
    id: `i-${name}-${position}`,
    groupId: null,
    position,
    raw: quantity !== null ? `${quantity} ${unit ?? ''} ${name}`.trim() : name,
    name,
    quantity,
    quantityText: quantity !== null ? String(quantity) : null,
    unit,
    purchaseNote: '',
    preparationNote: '',
    parseStatus: quantity !== null ? 'parsed' : 'plain',
    links: [],
  }
}

function recipe(
  id: string,
  title: string,
  ingredients: Ingredient[],
  servingsNumber = 2,
): Recipe {
  return {
    id,
    importId: `manual-${id}`,
    importSource: 'manual',
    title,
    description: '',
    ingredientGroups: [],
    ingredients,
    instructions: [],
    servingsText: String(servingsNumber),
    servingsNumber,
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

function session(
  id: string,
  recipeId: string,
  date: string,
  servings = 2,
): CookSession {
  return {
    id,
    recipeId,
    date,
    servings,
    status: 'planned',
    auto: false,
    createdAt: 1,
    updatedAt: 1,
  }
}

async function setup(
  extra: Array<[string, string, unknown]> = [],
): Promise<{
  backend: TestRecordsBackend
  store: CloudRecordsStore
  shopping: ReturnType<typeof createCloudShoppingBackend>
}> {
  const backend = new TestRecordsBackend()
  const store = await createTestStore(backend, [...SETTINGS_ROWS, ...extra])
  return {
    backend,
    store,
    shopping: createCloudShoppingBackend(store),
  }
}

function dataOf(store: CloudRecordsStore): ShoppingData {
  const data = readShoppingData(store)
  if (!data) throw new Error('Store nicht geladen')
  return data
}

function viewOf(store: CloudRecordsStore): ShoppingPageView {
  const data = dataOf(store)
  return buildShoppingPageView({
    anchor: TODAY,
    today: TODAY,
    settingsRows: data.settings,
    lists: data.shoppingLists,
    recipes: data.recipes,
    freeDishes: data.freeDishes,
    cookSessions: data.cookSessions,
    manualItems: data.manualItems,
    purchases: data.purchases,
    rules: data.rules,
    quantityCorrections: data.quantityCorrections,
    allocations: data.allocations,
  })
}

function allRows(view: ShoppingPageView) {
  return Object.values(view.rowsByList).flat()
}

function automaticRow(
  view: ShoppingPageView,
  itemKey: string,
): ReturnType<typeof allRows>[number] | undefined {
  return allRows(view).find(
    (row) => row.kind === 'automatic' && row.itemKey === itemKey,
  )
}

function amountOf(
  row: { requiredPositions: { dimension: string; lower: number }[] },
  dimension: string,
): number | undefined {
  return row.requiredPositions.find((position) => position.dimension === dimension)
    ?.lower
}

describe('Cloud-Einkaufsliste – Bedarf aus dem gemeinsamen Wochenplan', () => {
  it('leitet den Bedarf aus Cloud-Wochenplan und Rezepten ab und aggregiert gleiche Zutaten', async () => {
    const tomato = shoppingItemKey('Tomaten')
    const { store } = await setup([
      [
        'recipes',
        'r1',
        recipe('r1', 'Tomaten-Pasta', [ingredient('Tomaten', 4, 'Stück')]),
      ],
      [
        'recipes',
        'r2',
        recipe('r2', 'Tomatensuppe', [ingredient('Tomaten', 2, 'Stück')]),
      ],
      ['cookSessions', 's1', session('s1', 'r1', '2026-05-26', 2)],
      ['cookSessions', 's2', session('s2', 'r2', '2026-05-27', 2)],
    ])

    const view = viewOf(store)
    const row = automaticRow(view, tomato)
    expect(row).toBeDefined()
    expect(amountOf(row!, 'count')).toBe(6)
    expect(allRows(view).filter((entry) => entry.itemKey === tomato)).toHaveLength(1)
  })

  it('führt Kreuzkümmel und Kreuzkümmelpulver (Cumin) über die bestehende Identität zusammen', async () => {
    const cumin = shoppingItemKey('Kreuzkümmel')
    const { store } = await setup([
      [
        'recipes',
        'r1',
        recipe('r1', 'Kreuzkümmel', [ingredient('Kreuzkümmel', 1, 'TL')], 1),
      ],
      [
        'recipes',
        'r2',
        recipe(
          'r2',
          'Cumin',
          [ingredient('Kreuzkümmelpulver (Cumin)', 1, 'TL')],
          1,
        ),
      ],
      ['cookSessions', 's1', session('s1', 'r1', '2026-05-26', 1)],
      ['cookSessions', 's2', session('s2', 'r2', '2026-05-27', 1)],
    ])

    const view = viewOf(store)
    const row = automaticRow(view, cumin)
    expect(row).toBeDefined()
    expect(amountOf(row!, 'unit:tl')).toBe(2)
    expect(
      allRows(view).filter((entry) => entry.itemKey.startsWith('kreuzk')),
    ).toHaveLength(1)
  })

  it('behält Zutaten ohne Mengenangabe als qualitative Position und hakt sie ab', async () => {
    const salt = shoppingItemKey('Petersilie')
    const { store, shopping } = await setup([
      [
        'recipes',
        'r1',
        recipe('r1', 'Petersiliengericht', [ingredient('Petersilie', null, null)]),
      ],
      ['cookSessions', 's1', session('s1', 'r1', '2026-05-26', 2)],
    ])
    let view = viewOf(store)
    let row = automaticRow(view, salt)
    expect(row?.missingQuantity).toBe(true)

    await shopping.addShoppingPurchase({
      shoppingDate: view.period.start,
      itemKey: row!.itemKey,
      listId: row!.listId,
      periodStart: view.period.start,
      amounts: [],
      snapshot: row!.requiredPositions,
      qualitative: true,
    })

    view = viewOf(store)
    row = automaticRow(view, salt)
    expect(row?.status).toBe('done')
  })
})

describe('Cloud-Einkaufsliste – manuelle Artikel und Käufe', () => {
  it('legt manuelle Artikel an, hakt sie ab und nimmt den Kauf zurück', async () => {
    const { store, shopping } = await setup()
    const periodStart = viewOf(store).period.start
    const list = await shopping.ensureStandardShoppingList(periodStart)
    const item = await shopping.createManualListItem({
      listId: list.id,
      name: 'Milch',
      quantityText: '1',
      unit: 'l',
      shoppingDate: periodStart,
    })

    let view = viewOf(store)
    let row = allRows(view).find((entry) => entry.manualItem?.id === item.id)
    expect(row?.status).toBe('open')

    await shopping.setManualItemPurchased(item.id, true)
    view = viewOf(store)
    row = allRows(view).find((entry) => entry.manualItem?.id === item.id)
    expect(row?.status).toBe('done')
    expect(dataOf(store).purchases).toHaveLength(1)

    await shopping.setManualItemPurchased(item.id, false)
    view = viewOf(store)
    row = allRows(view).find((entry) => entry.manualItem?.id === item.id)
    expect(row?.status).toBe('open')
    expect(dataOf(store).purchases).toHaveLength(0)
  })

  it('stellt einen gelöschten manuellen Artikel samt Käufen wieder her', async () => {
    const { store, shopping } = await setup()
    const periodStart = viewOf(store).period.start
    const list = await shopping.ensureStandardShoppingList(periodStart)
    const item = await shopping.createManualListItem({
      listId: list.id,
      name: 'Brot',
      quantityText: '1',
      unit: 'Stück',
      shoppingDate: periodStart,
    })
    await shopping.setManualItemPurchased(item.id, true)

    const removed = await shopping.removeManualListItemWithPurchases(item.id)
    expect(removed).toHaveLength(1)
    expect(dataOf(store).manualItems).toHaveLength(0)
    expect(viewOf(store).lists.some((entry) => entry.id === list.id)).toBe(true)

    await shopping.restoreManualItem(item, removed)
    const view = viewOf(store)
    const row = allRows(view).find((entry) => entry.manualItem?.id === item.id)
    expect(row?.status).toBe('done')
  })

  it('bucht vollständige, teilweise und qualitative Käufe korrekt', async () => {
    const tomato = shoppingItemKey('Tomaten')
    const { store, shopping } = await setup([
      [
        'recipes',
        'r1',
        recipe('r1', 'Tomaten', [ingredient('Tomaten', 6, 'Stück')]),
      ],
      ['cookSessions', 's1', session('s1', 'r1', '2026-05-26', 2)],
    ])
    let view = viewOf(store)
    let row = automaticRow(view, tomato)!
    expect(amountOf(row, 'count')).toBe(6)

    await shopping.addShoppingPurchase({
      shoppingDate: view.period.start,
      itemKey: row.itemKey,
      listId: row.listId,
      periodStart: view.period.start,
      amounts: [{ dimension: 'count', lower: 2, upper: 2 }],
      snapshot: row.requiredPositions,
    })
    view = viewOf(store)
    row = automaticRow(view, tomato)!
    expect(row.status).toBe('open')
    expect(row.openPositions.find((position) => position.dimension === 'count')?.lower).toBe(4)

    await shopping.addShoppingPurchase({
      shoppingDate: view.period.start,
      itemKey: row.itemKey,
      listId: row.listId,
      periodStart: view.period.start,
      amounts: [{ dimension: 'count', lower: 4, upper: 4 }],
      snapshot: row.requiredPositions,
    })
    view = viewOf(store)
    row = automaticRow(view, tomato)!
    expect(row.status).toBe('done')
    expect(dataOf(store).purchases).toHaveLength(2)

    const latest = dataOf(store).purchases
      .slice()
      .sort((a, b) => b.createdAt - a.createdAt)[0]!
    await shopping.removeShoppingPurchase(latest.id)
    view = viewOf(store)
    row = automaticRow(view, tomato)!
    expect(row.status).toBe('open')
    expect(row.openPositions.find((position) => position.dimension === 'count')?.lower).toBe(4)
  })

  it('schreibt Mengenkorrekturen und entfernt sie wieder', async () => {
    const tomato = shoppingItemKey('Tomaten')
    const { store, shopping } = await setup([
      [
        'recipes',
        'r1',
        recipe('r1', 'Tomaten', [ingredient('Tomaten', 6, 'Stück')]),
      ],
      ['cookSessions', 's1', session('s1', 'r1', '2026-05-26', 2)],
    ])
    let view = viewOf(store)
    const row = automaticRow(view, tomato)!
    const derived = row.richItem!.derivedPositions.find(
      (position) => position.dimension === 'count',
    )!

    const correction = await shopping.saveQuantityCorrection({
      shoppingDate: view.period.start,
      itemKey: row.itemKey,
      dimension: 'count',
      quantityText: '3',
      unit: 'Stück',
      sourceSignature: shoppingPositionSignature(derived),
    })
    view = viewOf(store)
    expect(amountOf(automaticRow(view, tomato)!, 'count')).toBe(3)

    await shopping.removeQuantityCorrection(correction.id)
    view = viewOf(store)
    expect(amountOf(automaticRow(view, tomato)!, 'count')).toBe(6)
  })
})

describe('Cloud-Einkaufsliste – Listen, Verteilungen und Einstellungen', () => {
  it('verschiebt Artikel auf eine freie Liste und wieder zurück', async () => {
    const tomato = shoppingItemKey('Tomaten')
    const { store, shopping } = await setup([
      [
        'recipes',
        'r1',
        recipe('r1', 'Tomaten', [ingredient('Tomaten', 6, 'Stück')]),
      ],
      ['cookSessions', 's1', session('s1', 'r1', '2026-05-26', 2)],
    ])
    let view = viewOf(store)
    const free = await shopping.createFreeShoppingList({ name: 'Markt' })
    const row = automaticRow(view, tomato)!

    await shopping.addShoppingPurchase({
      shoppingDate: view.period.start,
      itemKey: row.itemKey,
      listId: row.listId,
      periodStart: view.period.start,
      amounts: [{ dimension: 'count', lower: 2, upper: 2 }],
      snapshot: row.requiredPositions,
    })

    const moved = await shopping.moveShoppingItem({
      periodStart: view.period.start,
      itemKey: tomato,
      targetListId: free.id,
    })
    expect(moved.mode).toBe('full')
    expect(moved.movedPurchases).toBe(1)
    view = viewOf(store)
    expect(automaticRow(view, tomato)?.listId).toBe(free.id)
    expect(dataOf(store).purchases[0]?.listId).toBe(free.id)

    await shopping.resetShoppingAllocations({
      periodStart: view.period.start,
      itemKey: tomato,
    })
    view = viewOf(store)
    expect(automaticRow(view, tomato)?.listId).toBe(view.standardListId)
    expect(dataOf(store).purchases[0]?.listId).toBe(view.standardListId)
  })

  it('führt Käufe beim Entfernen einer Zuweisung zum Standardzettel zurück', async () => {
    const tomato = shoppingItemKey('Tomaten')
    const { store, shopping } = await setup([
      [
        'recipes',
        'r1',
        recipe('r1', 'Tomaten', [ingredient('Tomaten', 6, 'Stück')]),
      ],
      ['cookSessions', 's1', session('s1', 'r1', '2026-05-26', 2)],
    ])
    const view = viewOf(store)
    const free = await shopping.createFreeShoppingList({ name: 'Markt' })
    const row = automaticRow(view, tomato)!
    await shopping.moveShoppingItem({
      periodStart: view.period.start,
      itemKey: tomato,
      targetListId: free.id,
    })
    await shopping.addShoppingPurchase({
      shoppingDate: view.period.start,
      itemKey: tomato,
      listId: free.id,
      periodStart: view.period.start,
      amounts: [{ dimension: 'count', lower: 2, upper: 2 }],
      snapshot: row.requiredPositions,
    })
    const allocation = dataOf(store).allocations.find(
      (entry) => entry.itemKey === tomato && entry.listId === free.id,
    )!

    await shopping.removeShoppingAllocation(allocation.id)

    expect(dataOf(store).allocations.find((entry) => entry.id === allocation.id)).toBeUndefined()
    expect(dataOf(store).purchases[0]?.listId).toBe(view.standardListId)
  })

  it('verteilt eine feste Teilmenge und entfernt die Zuordnung wieder', async () => {
    const tomato = shoppingItemKey('Tomaten')
    const { store, shopping } = await setup([
      [
        'recipes',
        'r1',
        recipe('r1', 'Tomaten', [ingredient('Tomaten', 6, 'Stück')]),
      ],
      ['cookSessions', 's1', session('s1', 'r1', '2026-05-26', 2)],
    ])
    const view = viewOf(store)
    const free = await shopping.createFreeShoppingList({ name: 'Markt' })
    const result = await shopping.assignShoppingSubquantity({
      periodStart: view.period.start,
      itemKey: tomato,
      dimension: 'count',
      targetListId: free.id,
      quantity: 2,
    })
    expect(result.requestedLower).toBe(2)
    expect(result.allocation.listId).toBe(free.id)

    await shopping.removeShoppingAllocation(result.allocation.id)
    expect(dataOf(store).allocations).toHaveLength(0)
  })

  it('löscht eine freie Liste und verschiebt ihre Zuweisungen zurück', async () => {
    const tomato = shoppingItemKey('Tomaten')
    const { store, shopping } = await setup([
      [
        'recipes',
        'r1',
        recipe('r1', 'Tomaten', [ingredient('Tomaten', 6, 'Stück')]),
      ],
      ['cookSessions', 's1', session('s1', 'r1', '2026-05-26', 2)],
    ])
    const periodStart = viewOf(store).period.start
    const free = await shopping.createFreeShoppingList({ name: 'Markt' })
    await shopping.createManualListItem({
      listId: free.id,
      name: 'Blumen',
      shoppingDate: periodStart,
    })
    await shopping.moveShoppingItem({
      periodStart,
      itemKey: tomato,
      targetListId: free.id,
    })
    const beforeDelete = viewOf(store)
    await shopping.addShoppingPurchase({
      shoppingDate: periodStart,
      itemKey: tomato,
      listId: free.id,
      periodStart,
      amounts: [{ dimension: 'count', lower: 2, upper: 2 }],
      snapshot: automaticRow(beforeDelete, tomato)!.requiredPositions,
    })

    const result = await shopping.deleteFreeShoppingList(free.id, {
      confirmManualItems: true,
    })
    expect(result.removedManualItems).toBe(1)
    expect(dataOf(store).shoppingLists.some((list) => list.id === free.id)).toBe(false)
    const view = viewOf(store)
    expect(automaticRow(view, tomato)?.listId).toBe(view.standardListId)
    expect(dataOf(store).allocations[0]?.listId).toBe(view.standardListId)
    expect(dataOf(store).purchases[0]?.listId).toBe(view.standardListId)
  })

  it('speichert Produktregeln und führt Produkte zusammen bzw. trennt sie wieder', async () => {
    const tomato = shoppingItemKey('Tomaten')
    const target = shoppingItemKey('Tomatenmark')
    const { store, shopping } = await setup([
      [
        'recipes',
        'r1',
        recipe('r1', 'Tomaten', [ingredient('Tomaten', 6, 'Stück')]),
      ],
      ['cookSessions', 's1', session('s1', 'r1', '2026-05-26', 2)],
    ])
    const view = viewOf(store)
    const row = automaticRow(view, tomato)!
    await shopping.addShoppingPurchase({
      shoppingDate: view.period.start,
      itemKey: tomato,
      listId: row.listId,
      periodStart: view.period.start,
      amounts: [{ dimension: 'count', lower: 2, upper: 2 }],
      snapshot: row.requiredPositions,
    })

    await shopping.saveItemRule(tomato, { displayName: 'Rote Tomaten' })
    expect(automaticRow(viewOf(store), tomato)?.name).toBe('Rote Tomaten')

    await shopping.mergeShoppingProducts(tomato, target)
    expect(
      dataOf(store).rules.find((rule) => rule.key === tomato)?.canonicalKey,
    ).toBe(target)
    expect(dataOf(store).purchases[0]?.itemKey).toBe(target)

    await shopping.splitShoppingProduct(tomato)
    expect(
      dataOf(store).rules.find((rule) => rule.key === tomato)?.canonicalKey,
    ).toBe(tomato)
    expect(dataOf(store).purchases[0]?.itemKey).toBe(target)
  })

  it('löst eine mehrdeutige Altregel atomar auf', async () => {
    const tomato = shoppingItemKey('Tomaten')
    const target = shoppingItemKey('Tomatenmark')
    const { store, shopping } = await setup([
      [
        'shoppingItemRules',
        tomato,
        {
          key: tomato,
          canonicalKey: tomato,
          displayName: 'Tomaten',
          categoryId: null,
          purchaseNote: '',
          purchaseNoteOverride: false,
          hiddenPurchaseNotes: [],
          legacyQuantityText: '2',
          legacyUnit: 'Stück',
          legacyAmbiguous: true,
          updatedAt: 1,
        },
      ],
    ])

    await shopping.resolveAmbiguousRule(tomato, target)

    const rule = dataOf(store).rules.find((entry) => entry.key === tomato)
    expect(rule?.canonicalKey).toBe(target)
    expect(rule?.legacyAmbiguous).toBe(false)
  })

  it('entfernt einen leeren automatisch angelegten Zettel beim Einkaufstagwechsel', async () => {
    const { store, shopping } = await setup()
    const list = await shopping.ensureStandardShoppingList('2026-05-25')

    const settings = await shopping.applyShoppingSettings(
      { periodStartDay: 1 },
      '2026-05-25',
    )

    expect(settings.periodStartDay).toBe(1)
    expect(dataOf(store).shoppingLists.some((entry) => entry.id === list.id)).toBe(
      false,
    )
  })

  it('speichert Einkaufstag, Listennamen und Kategorienreihenfolge', async () => {
    const { store, shopping } = await setup()
    const normalized = await shopping.saveCategoryOrder(['dairy', 'produce'])
    expect(normalized.slice(0, 2)).toEqual(['dairy', 'produce'])
    expect(viewOf(store).categoryOrder.slice(0, 2)).toEqual(['dairy', 'produce'])

    const periodStart = viewOf(store).period.start
    const standard = await shopping.ensureStandardShoppingList(periodStart)
    const settings = await shopping.applyShoppingSettings({
      periodStartDay: 1,
      standardListName: 'Familieneinkauf',
    })
    expect(settings.periodStartDay).toBe(1)
    expect(settings.standardListName).toBe('Familieneinkauf')
    expect(viewOf(store).settings.standardListName).toBe('Familieneinkauf')
    expect(
      dataOf(store).shoppingLists.find((list) => list.id === standard.id)?.name,
    ).toContain('Familieneinkauf')
  })
})

describe('Cloud-Einkaufsliste – parallele Käufe und Konflikte', () => {
  it('behält parallele Käufe verschiedener Artikel beider Sitzungen', async () => {
    const tomato = shoppingItemKey('Tomaten')
    const milk = shoppingItemKey('Milch')
    const backend = new TestRecordsBackend()
    const seed: Array<[string, string, unknown]> = [
      ...SETTINGS_ROWS,
      [
        'recipes',
        'r1',
        recipe('r1', 'Tomaten', [ingredient('Tomaten', 6, 'Stück')]),
      ],
      [
        'recipes',
        'r2',
        recipe('r2', 'Milch', [ingredient('Milch', 2, 'l')]),
      ],
      ['cookSessions', 's1', session('s1', 'r1', '2026-05-26', 2)],
      ['cookSessions', 's2', session('s2', 'r2', '2026-05-26', 1)],
    ]
    for (const [collection, id, data] of seed) backend.seed(collection, id, data)
    const storeA = new CloudRecordsStore(backend)
    const storeB = new CloudRecordsStore(backend)
    await storeA.load()
    await storeB.load()
    const shoppingA = createCloudShoppingBackend(storeA)
    const shoppingB = createCloudShoppingBackend(storeB)
    const viewA = viewOf(storeA)
    const viewB = viewOf(storeB)
    const rowA = automaticRow(viewA, tomato)!
    const rowB = automaticRow(viewB, milk)!

    await Promise.all([
      shoppingA.addShoppingPurchase({
        shoppingDate: viewA.period.start,
        itemKey: rowA.itemKey,
        listId: rowA.listId,
        periodStart: viewA.period.start,
        amounts: [{ dimension: 'count', lower: 1, upper: 1 }],
        snapshot: rowA.requiredPositions,
      }),
      shoppingB.addShoppingPurchase({
        shoppingDate: viewB.period.start,
        itemKey: rowB.itemKey,
        listId: rowB.listId,
        periodStart: viewB.period.start,
        amounts: [{ dimension: 'volume', lower: 1, upper: 1 }],
        snapshot: rowB.requiredPositions,
      }),
    ])

    await storeA.load()
    expect(
      dataOf(storeA).purchases.map((purchase) => purchase.itemKey).sort(),
    ).toEqual([milk, tomato].sort())
  })

  it('behält zwei nahezu gleichzeitige Käufe desselben Artikels als eigene Ereignisse', async () => {
    const tomato = shoppingItemKey('Tomaten')
    const backend = new TestRecordsBackend()
    for (const [collection, id, data] of [
      ...SETTINGS_ROWS,
      [
        'recipes',
        'r1',
        recipe('r1', 'Tomaten', [ingredient('Tomaten', 6, 'Stück')]),
      ],
      ['cookSessions', 's1', session('s1', 'r1', '2026-05-26', 2)],
    ] as Array<[string, string, unknown]>) {
      backend.seed(collection, id, data)
    }
    const storeA = new CloudRecordsStore(backend)
    const storeB = new CloudRecordsStore(backend)
    await storeA.load()
    await storeB.load()
    const shoppingA = createCloudShoppingBackend(storeA)
    const shoppingB = createCloudShoppingBackend(storeB)
    const viewA = viewOf(storeA)
    const viewB = viewOf(storeB)
    const rowA = automaticRow(viewA, tomato)!
    const rowB = automaticRow(viewB, tomato)!

    await Promise.all([
      shoppingA.addShoppingPurchase({
        shoppingDate: viewA.period.start,
        itemKey: rowA.itemKey,
        listId: rowA.listId,
        periodStart: viewA.period.start,
        amounts: [{ dimension: 'count', lower: 2, upper: 2 }],
        snapshot: rowA.requiredPositions,
      }),
      shoppingB.addShoppingPurchase({
        shoppingDate: viewB.period.start,
        itemKey: rowB.itemKey,
        listId: rowB.listId,
        periodStart: viewB.period.start,
        amounts: [{ dimension: 'count', lower: 2, upper: 2 }],
        snapshot: rowB.requiredPositions,
      }),
    ])

    await storeA.load()
    const purchases = dataOf(storeA).purchases
    expect(purchases).toHaveLength(2)
    expect(new Set(purchases.map((purchase) => purchase.id)).size).toBe(2)
    expect(purchases.reduce((sum, purchase) => sum + (purchase.amounts[0]?.lower ?? 0), 0)).toBe(4)
  })

  it('entfernt mehrere Käufe in genau einem atomaren Aufruf', async () => {
    const tomato = shoppingItemKey('Tomaten')
    const { backend, store, shopping } = await setup([
      [
        'recipes',
        'r1',
        recipe('r1', 'Tomaten', [ingredient('Tomaten', 6, 'Stück')]),
      ],
      ['cookSessions', 's1', session('s1', 'r1', '2026-05-26', 2)],
    ])
    const view = viewOf(store)
    const row = automaticRow(view, tomato)!
    for (const amount of [2, 2]) {
      await shopping.addShoppingPurchase({
        shoppingDate: view.period.start,
        itemKey: tomato,
        listId: row.listId,
        periodStart: view.period.start,
        amounts: [{ dimension: 'count', lower: amount, upper: amount }],
        snapshot: row.requiredPositions,
      })
    }
    const ids = dataOf(store).purchases.map((purchase) => purchase.id)
    const callsBefore = backend.calls.length

    await shopping.removeShoppingPurchases(ids)

    expect(backend.calls.length).toBe(callsBefore + 1)
    expect(dataOf(store).purchases).toHaveLength(0)
  })

  it('erkennt eine konkurrierende Bearbeitung und hinterlässt keinen Teilstand', async () => {
    const { backend, store, shopping } = await setup()
    const periodStart = viewOf(store).period.start
    const list = await shopping.ensureStandardShoppingList(periodStart)
    const item = await shopping.createManualListItem({
      listId: list.id,
      name: 'Käse',
      quantityText: '200',
      unit: 'g',
      shoppingDate: periodStart,
    })

    const secondStore = new CloudRecordsStore(backend)
    await secondStore.load()
    const secondShopping = createCloudShoppingBackend(secondStore)

    await shopping.updateManualListItem(item.id, { name: 'Käse frisch' })
    await expect(
      secondShopping.updateManualListItem(item.id, { name: 'Käse alt' }),
    ).rejects.toBeInstanceOf(CloudConflictError)
    expect(
      backend.row<ShoppingManualItem>('shoppingManualItems', item.id)?.data.name,
    ).toBe('Käse frisch')
    expect(
      dataOf(secondStore).manualItems.find((entry) => entry.id === item.id)?.name,
    ).toBe('Käse frisch')
  })

  it('rollt einen fehlgeschlagenen Kauf vollständig zurück', async () => {
    const { backend, store, shopping } = await setup()
    const periodStart = viewOf(store).period.start
    const list = await shopping.ensureStandardShoppingList(periodStart)
    const item = await shopping.createManualListItem({
      listId: list.id,
      name: 'Joghurt',
      quantityText: '1',
      unit: 'Stück',
      shoppingDate: periodStart,
    })
    const before = structuredClone([...backend.rows.values()])

    backend.failNext = new Error('Netzwerkfehler')
    await expect(shopping.setManualItemPurchased(item.id, true)).rejects.toThrow(
      'Netzwerkfehler',
    )
    expect([...backend.rows.values()]).toEqual(before)
    expect(dataOf(store).purchases).toHaveLength(0)
  })

  it('aktualisiert den Bedarf, wenn der Wochenplan per Realtime ein Gericht erhält', async () => {
    const tomato = shoppingItemKey('Tomaten')
    const { backend, store } = await setup([
      [
        'recipes',
        'r1',
        recipe('r1', 'Tomaten', [ingredient('Tomaten', 6, 'Stück')]),
      ],
    ])
    expect(automaticRow(viewOf(store), tomato)).toBeUndefined()

    backend.emit({
      type: 'upsert',
      row: {
        collection: 'cookSessions',
        id: 's-new',
        rev: 1,
        data: session('s-new', 'r1', '2026-05-26', 2),
      },
    })

    expect(amountOf(automaticRow(viewOf(store), tomato)!, 'count')).toBe(6)
  })

  it('übernimmt Realtime-Käufe in die Einkaufsansicht', async () => {
    const tomato = shoppingItemKey('Tomaten')
    const { backend, store } = await setup([
      [
        'recipes',
        'r1',
        recipe('r1', 'Tomaten', [ingredient('Tomaten', 6, 'Stück')]),
      ],
      ['cookSessions', 's1', session('s1', 'r1', '2026-05-26', 2)],
    ])
    const view = viewOf(store)
    const row = automaticRow(view, tomato)!

    backend.emit({
      type: 'upsert',
      row: {
        collection: 'shoppingPurchases',
        id: 'remote-purchase',
        rev: 1,
        data: {
          id: 'remote-purchase',
          shoppingDate: view.period.start,
          itemKey: row.itemKey,
          listId: row.listId,
          amounts: [{ dimension: 'count', lower: 2, upper: 2 }],
          snapshot: row.requiredPositions,
          qualitative: false,
          createdAt: 20,
          updatedAt: 20,
        } satisfies ShoppingPurchase,
      },
    })

    const updated = viewOf(store)
    expect(dataOf(store).purchases).toHaveLength(1)
    expect(automaticRow(updated, tomato)?.status).toBe('open')
    expect(
      automaticRow(updated, tomato)?.openPositions.find(
        (position) => position.dimension === 'count',
      )?.lower,
    ).toBe(4)
  })
})

describe('Cloud-Einkaufsliste – Zusammenwirken mit dem Wochenplan', () => {
  it('entfernt beim Löschen des letzten Gerichts auch den zugehörigen Kauf', async () => {
    const tomato = shoppingItemKey('Tomaten')
    const { backend, store, shopping } = await setup([
      [
        'recipes',
        'r1',
        recipe('r1', 'Tomaten', [ingredient('Tomaten', 6, 'Stück')]),
      ],
      ['cookSessions', 's1', session('s1', 'r1', '2026-05-26', 2)],
    ])
    const view = viewOf(store)
    const row = automaticRow(view, tomato)!
    await shopping.addShoppingPurchase({
      shoppingDate: view.period.start,
      itemKey: row.itemKey,
      listId: row.listId,
      periodStart: view.period.start,
      amounts: [{ dimension: 'count', lower: 6, upper: 6 }],
      snapshot: row.requiredPositions,
    })
    expect(automaticRow(viewOf(store), tomato)?.status).toBe('done')

    const plan = createCloudPlanBackend(store)
    await plan.deleteDishPlan('s1')

    expect(backend.row('shoppingPurchases', dataOf(store).purchases[0]?.id ?? '')).toBeUndefined()
    expect(dataOf(store).purchases).toHaveLength(0)
    expect(automaticRow(viewOf(store), tomato)).toBeUndefined()
  })
})

describe('Cloud-Einkaufsliste – Oberfläche', () => {
  it('rendert die bestehende Einkaufsliste mit Cloud-Daten', async () => {
    const today = todayKey()
    const { store, shopping } = await setup([
      [
        'recipes',
        'r1',
        recipe('r1', 'Tomaten', [ingredient('Tomaten', 6, 'Stück')]),
      ],
      ['cookSessions', 's1', session('s1', 'r1', today, 2)],
    ])

    const html = renderToStaticMarkup(
      <ShoppingBackendProvider value={shopping}>
        <ShoppingPage />
      </ShoppingBackendProvider>,
    )

    expect(html).toContain('Einkaufsliste')
    expect(html).toContain('Tomaten')
    expect(html).not.toContain('Einkaufsliste wird geladen')
    expect(html).not.toMatch(/automatisch/i)
    expect(store.isLoaded()).toBe(true)
  })
})
