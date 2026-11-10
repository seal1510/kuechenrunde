/*
 * Küchenrunde – Einkaufsliste im Cloud-Modus
 * Copyright (C) 2026 openCook Web contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Setzt die bestehende Einkaufsliste auf den CloudRecordsStore. Die
 * Bedarfsberechnung, Zutatenidentität und Kaufregeln bleiben vollständig in
 * den vorhandenen Domain-Modulen. Hier wird ausschließlich die Persistenz
 * getauscht; zusammengehörige Zeilen werden in einem apply_ops-Aufruf
 * geschrieben und erst nach der Serverbestätigung sichtbar.
 *
 * Käufe bleiben einzelne, unveränderliche Ereignisse. Zwei parallele Käufe
 * desselben Artikels erzeugen zwei eigene Zeilen mit eigenen IDs; der eine
 * Kauf überschreibt den anderen nie.
 */

import { useCallback, useMemo, useSyncExternalStore } from 'react'
import { CloudConflictError } from '../data/cloudErrors'
import {
  CloudRecordsStore,
  type RecordRow,
  type RecordsTransaction,
} from '../data/cloudRecords'
import { addDays, todayKey } from '../domain/dates'
import { catalogKeyVariants, catalogShoppingKey } from '../domain/ingredientCatalog'
import {
  CATEGORY_ORDER_SETTING_KEY,
  DEFAULT_CATEGORY_ORDER,
  normalizeCategoryOrder,
  parseCategoryOrderSetting,
  parseShoppingQuantityPosition,
  resolveCanonicalKey,
  serializeCategoryOrder,
  shoppingUnitDimension,
  type ShoppingAmountPosition,
  type ShoppingCategoryId,
} from '../domain/shopping'
import {
  fromAmountMilli,
  openAmount,
  periodContainsDate,
  resolveShoppingPeriodFromData,
  resolveShoppingPeriodResolution,
  shoppingAllocationId,
  shoppingPeriodFromList,
  shoppingPeriodFromRange,
  standardShoppingListId,
  standardShoppingListName,
  standardShoppingListRecord,
  toAmountMilli,
  type ShoppingPeriod,
} from '../domain/shoppingLists'
import { randomId } from '../lib/id'
import {
  buildManualPurchaseContext,
  type ManualPurchaseContext,
} from '../shopping/manualPurchases'
import {
  buildShoppingPeriodDemand,
  manualItemKey,
  type ShoppingPeriodDemand,
} from '../shopping/demand'
import { ShoppingListError } from '../shopping/errors'
import {
  normalizeShoppingSettings,
  SHOPPING_PERIOD_START_DAY_KEY,
  STANDARD_SHOPPING_LIST_NAME_KEY,
  shoppingSettingsFromRows,
  type ShoppingSettings,
} from '../settings/shopping'
import type {
  AssignShoppingSubquantityInput,
  AssignShoppingSubquantityResult,
  CreateManualListItemInput,
  CreateShoppingListInput,
  DeleteFreeShoppingListOptions,
  DeleteFreeShoppingListResult,
  MoveShoppingItemInput,
  MoveShoppingItemResult,
  ResetShoppingAllocationsInput,
  UpdateManualListItemPatch,
} from '../shopping/listService'
import type {
  ItemRuleInput,
  PurchaseInput,
  QuantityCorrectionInput,
} from '../shopping/service'
import type {
  ShoppingBackend,
  ShoppingData,
} from '../shopping/shoppingBackend'
import type {
  CookSession,
  FreeDish,
  Recipe,
  SettingRecord,
  ShoppingCheck,
  ShoppingDemandAllocation,
  ShoppingItemRule,
  ShoppingList,
  ShoppingManualItem,
  ShoppingPurchase,
  ShoppingPurchasedAmount,
  ShoppingQuantityCorrection,
} from '../types'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const CATEGORY_SET = new Set<string>(DEFAULT_CATEGORY_ORDER)

/* ------------------------------------------------------------------ */
/* Small helpers                                                       */
/* ------------------------------------------------------------------ */

function cleanText(value: string | null | undefined): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim()
}

function optionalText(value: string | null | undefined): string | undefined {
  const clean = cleanText(value)
  return clean ? clean : undefined
}

function optionalNullable(value: string | null | undefined): string | null {
  const clean = cleanText(value)
  return clean ? clean : null
}

function categoryOrNull(
  value: string | null | undefined,
): ShoppingCategoryId | null {
  const clean = cleanText(value)
  return CATEGORY_SET.has(clean) ? (clean as ShoppingCategoryId) : null
}

function requireDate(value: string, label = 'Der Einkaufstag'): string {
  if (!DATE_RE.test(value)) {
    throw new ShoppingListError('invalid-period', `${label} ist kein gültiges Datum.`)
  }
  return value
}

function rowsData<T>(rows: readonly RecordRow<T>[]): T[] {
  return rows.map((row) => row.data)
}

function writeRow<T>(
  tx: RecordsTransaction,
  collection: string,
  id: string,
  data: T,
  existing: RecordRow<T> | undefined,
): void {
  if (!existing) {
    tx.create(collection, id, data)
  } else if (existing.rev === 0) {
    tx.updateCreated(collection, id, data)
  } else {
    tx.update(collection, id, data, existing.rev)
  }
}

function removeIfExists<T>(
  tx: RecordsTransaction,
  collection: string,
  id: string,
): T | null {
  const row = tx.get<T>(collection, id)
  if (!row) return null
  tx.remove(collection, id, row.rev)
  return row.data
}

function settingsOf(data: ShoppingData): ShoppingSettings {
  return shoppingSettingsFromRows(data.settings)
}

function txShoppingData(tx: RecordsTransaction): ShoppingData {
  return {
    recipes: rowsData(tx.list<Recipe>('recipes')),
    freeDishes: rowsData(tx.list<FreeDish>('freeDishes')),
    cookSessions: rowsData(tx.list<CookSession>('cookSessions')),
    manualItems: rowsData(tx.list<ShoppingManualItem>('shoppingManualItems')),
    purchases: rowsData(tx.list<ShoppingPurchase>('shoppingPurchases')),
    rules: rowsData(tx.list<ShoppingItemRule>('shoppingItemRules')),
    quantityCorrections: rowsData(
      tx.list<ShoppingQuantityCorrection>('shoppingQuantityCorrections'),
    ),
    settings: rowsData(tx.list<SettingRecord>('settings')),
    shoppingLists: rowsData(tx.list<ShoppingList>('shoppingLists')),
    allocations: rowsData(
      tx.list<ShoppingDemandAllocation>('shoppingDemandAllocations'),
    ),
  }
}

function resolvePeriod(
  anchor: string,
  settings: ShoppingSettings,
  lists: readonly ShoppingList[],
): ShoppingPeriod {
  const date = requireDate(cleanText(anchor), 'Der Einkaufszeitraum')
  const resolution = resolveShoppingPeriodResolution(date, settings, lists)
  if (resolution.conflict) {
    throw new ShoppingListError(
      'overlapping-periods',
      `Für ${date} sind mehrere Standard-Einkaufsperioden zugeordnet. Bitte die betroffenen Einkaufszettel prüfen.`,
      { date, listIds: resolution.conflict.listIds },
    )
  }
  return resolution.period
}

function demandForPeriod(
  period: ShoppingPeriod,
  data: ShoppingData,
  settings: ShoppingSettings,
): ShoppingPeriodDemand {
  return buildShoppingPeriodDemand({
    period,
    settings,
    recipes: data.recipes,
    freeDishes: data.freeDishes,
    cookSessions: data.cookSessions,
    rules: data.rules,
    quantityCorrections: data.quantityCorrections,
  })
}

function periodForPersistedStart(
  periodStart: string,
  lists: readonly ShoppingList[],
): ShoppingPeriod {
  const list = lists.find(
    (entry) => entry.kind === 'standard' && entry.periodStart === periodStart,
  )
  if (list) return shoppingPeriodFromList(list)
  return shoppingPeriodFromRange(periodStart, addDays(periodStart, 6))
}

function listContainsDate(list: ShoppingList, date: string): boolean {
  return Boolean(
    list.kind === 'standard' &&
      list.periodStart &&
      list.periodEnd &&
      periodContainsDate({ start: list.periodStart, end: list.periodEnd }, date),
  )
}

function ensureStandardRecordInTx(
  tx: RecordsTransaction,
  period: ShoppingPeriod,
  baseName: string,
  now: number,
): ShoppingList {
  const id = standardShoppingListId(period.start)
  const existing = tx.get<ShoppingList>('shoppingLists', id)
  if (existing) return existing.data
  const record = standardShoppingListRecord(period, baseName, now)
  tx.create('shoppingLists', record.id, record)
  return record
}

function sumPurchased(
  purchases: readonly ShoppingPurchase[],
  dimension: string,
): { lower: number; upper: number } {
  let lower = 0
  let upper = 0
  for (const purchase of purchases) {
    for (const amount of purchase.amounts) {
      if (amount.dimension !== dimension) continue
      lower += Math.max(0, amount.lower)
      upper += Math.max(0, amount.upper)
    }
  }
  return {
    lower: fromAmountMilli(toAmountMilli(lower)),
    upper: fromAmountMilli(toAmountMilli(upper)),
  }
}

function toPurchasedAmounts(
  positions: readonly ShoppingAmountPosition[],
): ShoppingPurchasedAmount[] {
  return positions
    .filter((position) => position.lower > 0 || position.upper > 0)
    .map((position) => ({
      dimension: position.dimension,
      lower: Math.max(0, position.lower),
      upper: Math.max(0, position.upper),
    }))
}

function confirmedTotals(
  previous: readonly ShoppingPurchase[],
  added: readonly ShoppingPurchasedAmount[],
): ShoppingPurchasedAmount[] {
  const byDimension = new Map<string, ShoppingPurchasedAmount>()
  const add = (entry: ShoppingPurchasedAmount) => {
    if (!Number.isFinite(entry.lower) || !Number.isFinite(entry.upper)) return
    const existing = byDimension.get(entry.dimension)
    if (!existing) {
      byDimension.set(entry.dimension, {
        dimension: entry.dimension,
        lower: Math.max(0, entry.lower),
        upper: Math.max(0, entry.upper),
      })
    } else {
      existing.lower =
        Math.round((existing.lower + Math.max(0, entry.lower)) * 1000) / 1000
      existing.upper =
        Math.round((existing.upper + Math.max(0, entry.upper)) * 1000) / 1000
    }
  }
  for (const purchase of previous) {
    for (const entry of purchase.amounts) add(entry)
  }
  for (const entry of added) add(entry)
  return Array.from(byDimension.values())
}

function purchaseBelongsToPeriod(
  purchase: ShoppingPurchase,
  periodStart: string,
): boolean {
  if (purchase.listId?.startsWith('standard:')) {
    return purchase.listId.slice('standard:'.length) === periodStart
  }
  if (purchase.listId) return false
  const end = addDays(periodStart, 6)
  return purchase.shoppingDate >= periodStart && purchase.shoppingDate <= end
}

function addPurchaseRecordInTx(
  tx: RecordsTransaction,
  input: PurchaseInput,
): ShoppingPurchase {
  const shoppingDate = requireDate(cleanText(input.shoppingDate))
  const itemKey = cleanText(input.itemKey)
  if (!itemKey) {
    throw new ShoppingListError('purchase-conflict', 'Der Artikel konnte nicht zugeordnet werden.')
  }
  const previous = tx
    .list<ShoppingPurchase>('shoppingPurchases')
    .map((row) => row.data)
    .filter((purchase) => purchase.itemKey === itemKey)
  const latest = previous.reduce(
    (max, entry) => Math.max(max, entry.createdAt),
    0,
  )
  // Monotonic timestamps keep "last purchase" unambiguous even in the same
  // millisecond across tabs.
  const now = Math.max(Date.now(), latest + 1)
  const listId = optionalText(input.listId)
  const periodStart =
    optionalText(input.periodStart) ??
    (listId?.startsWith('standard:')
      ? listId.slice('standard:'.length)
      : undefined)
  const previousInPeriod = periodStart
    ? previous.filter((entry) => purchaseBelongsToPeriod(entry, periodStart))
    : []
  const purchase: ShoppingPurchase = {
    id: optionalText(input.id) ?? randomId(),
    shoppingDate,
    itemKey,
    listId,
    manualItemId: optionalText(input.manualItemId),
    provenance: 'recorded',
    confirmedTotal: input.confirmedTotal
      ? confirmedTotals([], input.confirmedTotal)
      : confirmedTotals(previousInPeriod, input.amounts),
    amounts: toPurchasedAmounts(
      input.amounts.map((entry) => ({
        dimension: entry.dimension,
        unit: null,
        lower: entry.lower,
        upper: entry.upper,
        qualifier: '',
      })),
    ),
    snapshot: toPurchasedAmounts(input.snapshot),
    qualitative: input.qualitative === true || input.amounts.length === 0,
    createdAt: now,
    updatedAt: now,
  }
  const existing = tx.get<ShoppingPurchase>('shoppingPurchases', purchase.id)
  writeRow(tx, 'shoppingPurchases', purchase.id, purchase, existing)
  return purchase
}

function quantityCorrectionId(
  itemKey: string,
  shoppingDate: string,
  dimension: string,
): string {
  return `${itemKey}::${shoppingDate}::${dimension}`
}

/* ------------------------------------------------------------------ */
/* Data view                                                           */
/* ------------------------------------------------------------------ */

export function readShoppingData(store: CloudRecordsStore): ShoppingData | undefined {
  if (!store.isLoaded()) return undefined
  return {
    recipes: rowsData(store.list<Recipe>('recipes')),
    freeDishes: rowsData(store.list<FreeDish>('freeDishes')),
    cookSessions: rowsData(store.list<CookSession>('cookSessions')),
    manualItems: rowsData(store.list<ShoppingManualItem>('shoppingManualItems')),
    purchases: rowsData(store.list<ShoppingPurchase>('shoppingPurchases')),
    rules: rowsData(store.list<ShoppingItemRule>('shoppingItemRules')),
    quantityCorrections: rowsData(
      store.list<ShoppingQuantityCorrection>('shoppingQuantityCorrections'),
    ),
    settings: rowsData(store.list<SettingRecord>('settings')),
    shoppingLists: rowsData(store.list<ShoppingList>('shoppingLists')),
    allocations: rowsData(
      store.list<ShoppingDemandAllocation>('shoppingDemandAllocations'),
    ),
  }
}

function useStoreVersion(store: CloudRecordsStore): number {
  const subscribe = useCallback(
    (onStoreChange: () => void) => store.subscribe(onStoreChange),
    [store],
  )
  const getSnapshot = useCallback(() => store.getVersion(), [store])
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

/* ------------------------------------------------------------------ */
/* Shopping lists                                                      */
/* ------------------------------------------------------------------ */

async function ensureStandardList(
  store: CloudRecordsStore,
  anchor: string,
): Promise<ShoppingList> {
  try {
    return await store.transaction(async (tx) => {
      const data = txShoppingData(tx)
      const settings = settingsOf(data)
      const period = resolvePeriod(anchor, settings, data.shoppingLists)
      return ensureStandardRecordInTx(
        tx,
        period,
        settings.standardListName,
        Date.now(),
      )
    })
  } catch (cause) {
    if (!(cause instanceof CloudConflictError)) throw cause
    // Two family members may create the same standard list at the same time.
    // The conflicting transaction was rolled back; after the reload the row
    // exists and can be returned without a second write.
    const data = readShoppingData(store)
    if (!data) throw cause
    const period = resolvePeriod(
      anchor,
      settingsOf(data),
      data.shoppingLists,
    )
    const existing = store.get<ShoppingList>(
      'shoppingLists',
      standardShoppingListId(period.start),
    )
    if (existing) return existing.data
    throw cause
  }
}

async function createFreeList(
  store: CloudRecordsStore,
  input: CreateShoppingListInput | string,
): Promise<ShoppingList> {
  const name = cleanText(typeof input === 'string' ? input : input.name)
  if (!name) {
    throw new ShoppingListError(
      'invalid-list-name',
      'Bitte einen Namen für die Einkaufsliste angeben.',
    )
  }
  const now = Date.now()
  const list: ShoppingList = {
    id: randomId(),
    kind: 'free',
    name,
    periodStart: null,
    periodEnd: null,
    createdAt: now,
    updatedAt: now,
  }
  await store.create('shoppingLists', list.id, list)
  return list
}

async function renameList(
  store: CloudRecordsStore,
  id: string,
  name: string,
): Promise<ShoppingList> {
  const cleanName = cleanText(name)
  if (!cleanName) {
    throw new ShoppingListError(
      'invalid-list-name',
      'Bitte einen Namen für die Einkaufsliste angeben.',
    )
  }
  return store.transaction(async (tx) => {
    const existing = tx.get<ShoppingList>('shoppingLists', id)
    if (!existing) {
      throw new ShoppingListError(
        'list-not-found',
        'Die Einkaufsliste wurde nicht gefunden.',
      )
    }
    if (existing.data.kind !== 'free') {
      throw new ShoppingListError(
        'standard-list-protected',
        'Der Standard-Einkaufszettel kann nicht wie eine freie Liste umbenannt werden.',
      )
    }
    const next: ShoppingList = {
      ...existing.data,
      name: cleanName,
      updatedAt: Date.now(),
    }
    tx.update('shoppingLists', id, next, existing.rev)
    return next
  })
}

async function deleteFreeList(
  store: CloudRecordsStore,
  id: string,
  options: DeleteFreeShoppingListOptions = {},
): Promise<DeleteFreeShoppingListResult> {
  return store.transaction(async (tx) => {
    const data = txShoppingData(tx)
    const settings = settingsOf(data)
    const list = data.shoppingLists.find((entry) => entry.id === id)
    if (!list) {
      throw new ShoppingListError(
        'list-not-found',
        'Die Einkaufsliste wurde nicht gefunden.',
      )
    }
    if (list.kind !== 'free') {
      throw new ShoppingListError(
        'standard-list-protected',
        'Der Standard-Einkaufszettel kann nicht wie eine freie Liste gelöscht werden.',
      )
    }

    const allocations = data.allocations.filter(
      (allocation) => allocation.listId === id,
    )
    const manualItems = data.manualItems.filter((item) => item.listId === id)
    if (manualItems.length > 0 && options.confirmManualItems !== true) {
      throw new ShoppingListError(
        'confirmation-required',
        'Die Liste enthält manuelle Artikel. Das Löschen muss ausdrücklich bestätigt werden.',
        { manualItems: manualItems.length },
      )
    }
    for (const allocation of allocations) {
      if (!DATE_RE.test(allocation.periodStart)) {
        throw new ShoppingListError(
          'orphaned-allocation',
          'Eine Zuweisung hat keinen gültigen Einkaufszeitraum.',
          { allocationId: allocation.id },
        )
      }
    }

    const manualIds = new Set(manualItems.map((item) => item.id))
    const affectedPurchases = data.purchases.filter(
      (purchase) =>
        purchase.listId === id ||
        (purchase.manualItemId !== undefined &&
          manualIds.has(purchase.manualItemId)),
    )
    for (const purchase of affectedPurchases) {
      if (!purchase.manualItemId && !DATE_RE.test(purchase.shoppingDate)) {
        throw new ShoppingListError(
          'purchase-conflict',
          'Ein Kauf hat kein gültiges Einkaufsdatum.',
          { purchaseId: purchase.id },
        )
      }
    }

    const now = Date.now()
    let movedAllocations = 0
    for (const allocation of allocations) {
      const period = periodForPersistedStart(
        allocation.periodStart,
        data.shoppingLists,
      )
      ensureStandardRecordInTx(tx, period, settings.standardListName, now)
      const targetListId = standardShoppingListId(period.start)
      const nextId = shoppingAllocationId(
        period.start,
        allocation.itemKey,
        allocation.dimension,
        targetListId,
      )
      const existing = tx.get<ShoppingDemandAllocation>(
        'shoppingDemandAllocations',
        nextId,
      )
      if (existing) {
        const merged: ShoppingDemandAllocation =
          existing.data.mode === 'full' || allocation.mode === 'full'
            ? {
                ...existing.data,
                mode: 'full',
                quantityMilli: undefined,
                createdAt: Math.min(existing.data.createdAt, allocation.createdAt),
                updatedAt: now,
              }
            : {
                ...existing.data,
                mode: 'partial',
                quantityMilli:
                  (existing.data.quantityMilli ?? 0) +
                  (allocation.quantityMilli ?? 0),
                createdAt: Math.min(existing.data.createdAt, allocation.createdAt),
                updatedAt: now,
              }
        writeRow(tx, 'shoppingDemandAllocations', nextId, merged, existing)
        removeIfExists(tx, 'shoppingDemandAllocations', allocation.id)
      } else {
        removeIfExists(tx, 'shoppingDemandAllocations', allocation.id)
        tx.create('shoppingDemandAllocations', nextId, {
          ...allocation,
          id: nextId,
          listId: targetListId,
          updatedAt: now,
        })
      }
      movedAllocations += 1
    }

    let removedManualPurchases = 0
    let movedPurchases = 0
    for (const purchase of affectedPurchases) {
      if (purchase.manualItemId && manualIds.has(purchase.manualItemId)) {
        removeIfExists(tx, 'shoppingPurchases', purchase.id)
        removedManualPurchases += 1
        continue
      }
      const period = resolveShoppingPeriodFromData(
        purchase.shoppingDate,
        settings,
        data.shoppingLists,
      )
      ensureStandardRecordInTx(tx, period, settings.standardListName, now)
      const row = tx.get<ShoppingPurchase>('shoppingPurchases', purchase.id)
      if (row) {
        tx.update(
          'shoppingPurchases',
          purchase.id,
          {
            ...purchase,
            listId: standardShoppingListId(period.start),
            updatedAt: now,
          },
          row.rev,
        )
      }
      movedPurchases += 1
    }

    for (const item of manualItems) {
      removeIfExists(tx, 'shoppingManualItems', item.id)
    }
    removeIfExists(tx, 'shoppingLists', id)

    return {
      removedManualItems: manualItems.length,
      removedManualPurchases,
      movedAllocations,
      movedPurchases,
    }
  })
}

/* ------------------------------------------------------------------ */
/* Automatic purchases                                                 */
/* ------------------------------------------------------------------ */

async function addPurchase(
  store: CloudRecordsStore,
  input: PurchaseInput,
): Promise<ShoppingPurchase> {
  const shoppingDate = requireDate(cleanText(input.shoppingDate))
  const itemKey = cleanText(input.itemKey)
  if (!itemKey) {
    throw new ShoppingListError('purchase-conflict', 'Der Artikel konnte nicht zugeordnet werden.')
  }
  const listId = optionalText(input.listId)
  if (!listId && !optionalText(input.manualItemId)) {
    throw new ShoppingListError(
      'purchase-conflict',
      'Der Artikel hat in diesem Einkaufszeitraum keine eindeutige Zettelzuordnung.',
    )
  }

  const purchaseId = optionalText(input.id) ?? randomId()
  const perform = () =>
    store.transaction(async (tx) => {
      const data = txShoppingData(tx)
      const settings = settingsOf(data)
      const period = resolvePeriod(
        listId?.startsWith('standard:')
          ? listId.slice('standard:'.length)
          : shoppingDate,
        settings,
        data.shoppingLists,
      )
      if (listId?.startsWith('standard:')) {
        const existing = tx.get<ShoppingList>('shoppingLists', listId)
        if (!existing) {
          ensureStandardRecordInTx(
            tx,
            shoppingPeriodFromRange(period.start, period.end),
            settings.standardListName,
            Date.now(),
          )
        }
      }
      return addPurchaseRecordInTx(tx, {
        ...input,
        id: purchaseId,
        shoppingDate,
        itemKey,
        listId,
        periodStart: period.start,
      })
    })

  try {
    return await perform()
  } catch (cause) {
    if (!(cause instanceof CloudConflictError)) throw cause
    // A concurrent first purchase may race on creating the standard list.
    // A lost response must never create a second purchase: check the concrete
    // row first, then retry only the still-missing write once.
    const saved = store.get<ShoppingPurchase>('shoppingPurchases', purchaseId)
    if (saved) return saved.data
    return perform()
  }
}

async function removePurchase(
  store: CloudRecordsStore,
  id: string,
): Promise<void> {
  await store.transaction(async (tx) => {
    removeIfExists(tx, 'shoppingPurchases', id)
  })
}

async function removePurchases(
  store: CloudRecordsStore,
  ids: readonly string[],
): Promise<void> {
  if (ids.length === 0) return
  await store.transaction(async (tx) => {
    for (const id of ids) removeIfExists(tx, 'shoppingPurchases', id)
  })
}

/* ------------------------------------------------------------------ */
/* Manual articles                                                     */
/* ------------------------------------------------------------------ */

async function createManualItem(
  store: CloudRecordsStore,
  input: CreateManualListItemInput,
): Promise<ShoppingManualItem> {
  const name = cleanText(input.name)
  if (!name) {
    throw new ShoppingListError('invalid-list-name', 'Bitte einen Artikelnamen angeben.')
  }
  return store.transaction(async (tx) => {
    const list = tx.get<ShoppingList>('shoppingLists', cleanText(input.listId))
    if (!list) {
      throw new ShoppingListError(
        'list-not-found',
        'Die Einkaufsliste wurde nicht gefunden.',
      )
    }
    const shoppingDate = input.shoppingDate
      ? cleanText(input.shoppingDate)
      : (list.data.periodStart ?? todayKey())
    requireDate(shoppingDate)
    if (
      list.data.kind === 'standard' &&
      !listContainsDate(list.data, shoppingDate)
    ) {
      throw new ShoppingListError(
        'list-period-mismatch',
        'Der Einkaufstag gehört nicht zum Zeitraum des Standardzettels.',
        {
          listId: list.data.id,
          periodStart: list.data.periodStart,
          shoppingDate,
        },
      )
    }
    const now = Date.now()
    const item: ShoppingManualItem = {
      id: randomId(),
      shoppingDate,
      weekStart: shoppingDate,
      listId: list.data.id,
      name,
      quantityText: optionalNullable(input.quantityText),
      unit: optionalNullable(input.unit),
      purchaseNote: cleanText(input.purchaseNote),
      categoryId: categoryOrNull(input.categoryId),
      createdAt: now,
      updatedAt: now,
    }
    tx.create('shoppingManualItems', item.id, item)
    return item
  })
}

async function updateManualItem(
  store: CloudRecordsStore,
  id: string,
  patch: UpdateManualListItemPatch,
): Promise<ShoppingManualItem> {
  return store.transaction(async (tx) => {
    const existingRow = tx.get<ShoppingManualItem>('shoppingManualItems', id)
    if (!existingRow) {
      throw new ShoppingListError(
        'list-not-found',
        'Der manuelle Artikel wurde nicht gefunden.',
      )
    }
    const existing = existingRow.data
    const target =
      patch.listId === undefined
        ? existing.listId
          ? tx.get<ShoppingList>('shoppingLists', existing.listId)
          : undefined
        : tx.get<ShoppingList>('shoppingLists', cleanText(patch.listId))
    if (patch.listId !== undefined && !target) {
      throw new ShoppingListError(
        'list-not-found',
        'Die Ziel-Einkaufsliste wurde nicht gefunden.',
      )
    }
    if (existing.listId && !target && patch.listId === undefined) {
      throw new ShoppingListError(
        'list-not-found',
        'Die bisherige Einkaufsliste des Artikels wurde nicht gefunden.',
      )
    }

    let shoppingDate =
      patch.shoppingDate === undefined
        ? existing.shoppingDate ||
          existing.weekStart ||
          target?.data.periodStart ||
          todayKey()
        : cleanText(patch.shoppingDate)
    requireDate(shoppingDate)
    if (
      target?.data.kind === 'standard' &&
      !listContainsDate(target.data, shoppingDate)
    ) {
      if (patch.listId !== undefined && patch.shoppingDate === undefined) {
        shoppingDate = target.data.periodStart ?? shoppingDate
      } else {
        throw new ShoppingListError(
          'list-period-mismatch',
          'Der Einkaufstag gehört nicht zum Zeitraum des Standardzettels.',
          {
            listId: target.data.id,
            periodStart: target.data.periodStart,
            shoppingDate,
          },
        )
      }
    }

    const name = patch.name === undefined ? existing.name : cleanText(patch.name)
    if (!name) {
      throw new ShoppingListError('invalid-list-name', 'Bitte einen Artikelnamen angeben.')
    }
    const previousDate = existing.shoppingDate || existing.weekStart || ''
    const dateChanged = shoppingDate !== previousDate
    const listChanged = target?.data.id !== existing.listId
    const updatedAt = Date.now()
    const next: ShoppingManualItem = {
      ...existing,
      shoppingDate,
      weekStart: dateChanged
        ? shoppingDate
        : (existing.weekStart ?? shoppingDate),
      listId: target?.data.id,
      legacyWeekAmbiguous:
        dateChanged || listChanged ? undefined : existing.legacyWeekAmbiguous,
      name,
      quantityText:
        patch.quantityText === undefined
          ? existing.quantityText
          : (optionalNullable(patch.quantityText) ?? null),
      unit:
        patch.unit === undefined
          ? existing.unit
          : (optionalNullable(patch.unit) ?? null),
      purchaseNote:
        patch.purchaseNote === undefined
          ? existing.purchaseNote
          : cleanText(patch.purchaseNote),
      categoryId:
        patch.categoryId === undefined
          ? existing.categoryId
          : categoryOrNull(patch.categoryId),
      updatedAt,
    }
    tx.update('shoppingManualItems', id, next, existingRow.rev)

    const linked = tx
      .list<ShoppingPurchase>('shoppingPurchases')
      .filter((row) => row.data.manualItemId === id)
    for (const row of linked) {
      tx.update(
        'shoppingPurchases',
        row.data.id,
        {
          ...row.data,
          listId: target?.data.id ?? row.data.listId,
          shoppingDate: dateChanged ? shoppingDate : row.data.shoppingDate,
          legacyWeekAmbiguous:
            dateChanged || listChanged
              ? undefined
              : row.data.legacyWeekAmbiguous,
          updatedAt,
        },
        row.rev,
      )
    }
    return next
  })
}

function manualContextInTx(
  tx: RecordsTransaction,
  data: ShoppingData,
  item: ShoppingManualItem,
): ManualPurchaseContext {
  const date = item.shoppingDate || item.weekStart || ''
  const period = resolvePeriod(date, settingsOf(data), data.shoppingLists)
  const demand = demandForPeriod(period, data, settingsOf(data))
  return buildManualPurchaseContext({
    item,
    periodStart: period.start,
    lists: data.shoppingLists,
    rules: data.rules,
    manualItems: data.manualItems,
    purchases: data.purchases,
    demandItemKeys: demand.items.map((entry) => entry.key),
  })
}

async function removeManualItemWithPurchases(
  store: CloudRecordsStore,
  id: string,
): Promise<ShoppingPurchase[]> {
  return store.transaction(async (tx) => {
    const data = txShoppingData(tx)
    const itemRow = tx.get<ShoppingManualItem>('shoppingManualItems', id)
    if (!itemRow) {
      throw new ShoppingListError(
        'list-not-found',
        'Der manuelle Artikel wurde nicht gefunden.',
      )
    }
    const item = itemRow.data
    const context = manualContextInTx(tx, data, item)
    if (context.ambiguous) {
      throw new ShoppingListError(
        'purchase-conflict',
        'Vorhandene Käufe sind nicht eindeutig diesem manuellen Artikel zuzuordnen.',
        {
          manualItemId: id,
          itemKey: manualItemKey(item),
          purchaseIds: context.candidatePurchases.map((purchase) => purchase.id),
        },
      )
    }

    const removed: ShoppingPurchase[] = []
    const linked = data.purchases.filter((purchase) => purchase.manualItemId === id)
    for (const purchase of linked) {
      if (removeIfExists(tx, 'shoppingPurchases', purchase.id)) {
        removed.push(purchase)
      }
    }
    if (context.adoptablePurchase) {
      const candidate = tx.get<ShoppingPurchase>(
        'shoppingPurchases',
        context.adoptablePurchase.id,
      )
      if (candidate && !candidate.data.manualItemId) {
        tx.remove('shoppingPurchases', candidate.data.id, candidate.rev)
        removed.push(candidate.data)
      }
    }
    tx.remove('shoppingManualItems', id, itemRow.rev)
    return removed
  })
}

async function setManualPurchased(
  store: CloudRecordsStore,
  id: string,
  purchased: boolean,
): Promise<{ item: ShoppingManualItem; purchases: ShoppingPurchase[] }> {
  const perform = () =>
    store.transaction(async (tx) => {
      const data = txShoppingData(tx)
      const itemRow = tx.get<ShoppingManualItem>('shoppingManualItems', id)
      if (!itemRow) {
        throw new ShoppingListError(
          'list-not-found',
          'Der manuelle Artikel wurde nicht gefunden.',
        )
      }
      const item = itemRow.data
      const context = manualContextInTx(tx, data, item)
      if (context.ambiguous) {
        throw new ShoppingListError(
          'purchase-conflict',
          'Vorhandene Käufe sind nicht eindeutig diesem manuellen Artikel zuzuordnen.',
          {
            manualItemId: id,
            itemKey: manualItemKey(item),
            purchaseIds: context.candidatePurchases.map((purchase) => purchase.id),
          },
        )
      }
      const settings = settingsOf(data)
      const purchaseDate = item.shoppingDate || item.weekStart || todayKey()
      const listId = context.listId
      if (listId.startsWith('standard:')) {
        const existingList = tx.get<ShoppingList>('shoppingLists', listId)
        if (!existingList) {
          const periodStart = listId.slice('standard:'.length)
          ensureStandardRecordInTx(
            tx,
            shoppingPeriodFromRange(periodStart, addDays(periodStart, 6)),
            settings.standardListName,
            Date.now(),
          )
        }
      }

      if (purchased) {
        const existing = tx
          .list<ShoppingPurchase>('shoppingPurchases')
          .map((row) => row.data)
          .filter((purchase) => purchase.manualItemId === id)
        const parsed = parseShoppingQuantityPosition(
          item.quantityText ?? '',
          item.unit,
        )
        if (existing.length > 0) {
          if (!parsed) return { item, purchases: existing }
          const open = openAmount(
            { lower: parsed.lower, upper: parsed.upper },
            sumPurchased(existing, parsed.dimension),
          )
          if (open.lower === 0 && open.upper === 0) {
            return { item, purchases: existing }
          }
          const purchase = addPurchaseRecordInTx(tx, {
            shoppingDate: purchaseDate,
            itemKey: manualItemKey(item),
            listId,
            manualItemId: item.id,
            periodStart: context.periodStart,
            amounts: [
              {
                dimension: parsed.dimension,
                lower: open.lower,
                upper: open.upper,
              },
            ],
            snapshot: [parsed],
            qualitative: false,
          })
          return { item, purchases: [...existing, purchase] }
        }
        if (context.adoptablePurchase) {
          const candidate = tx.get<ShoppingPurchase>(
            'shoppingPurchases',
            context.adoptablePurchase.id,
          )
          if (
            candidate?.data.manualItemId &&
            candidate.data.manualItemId !== id
          ) {
            throw new ShoppingListError(
              'purchase-conflict',
              'Der Altkauf wurde inzwischen einem anderen manuellen Artikel zugeordnet.',
              { manualItemId: id, purchaseId: candidate.data.id },
            )
          }
          if (candidate && !candidate.data.manualItemId) {
            const adopted: ShoppingPurchase = {
              ...candidate.data,
              listId,
              manualItemId: item.id,
              legacyWeekAmbiguous: undefined,
              updatedAt: Date.now(),
            }
            tx.update('shoppingPurchases', candidate.data.id, adopted, candidate.rev)
            return { item, purchases: [adopted] }
          }
        }
        const amounts: ShoppingPurchasedAmount[] =
          parsed && (parsed.lower > 0 || parsed.upper > 0)
            ? [
                {
                  dimension: parsed.dimension,
                  lower: Math.max(0, parsed.lower),
                  upper: Math.max(0, parsed.upper),
                },
              ]
            : []
        const purchase = addPurchaseRecordInTx(tx, {
          id: `manual-purchase:${id}`,
          shoppingDate: purchaseDate,
          itemKey: manualItemKey(item),
          listId,
          manualItemId: item.id,
          periodStart: context.periodStart,
          amounts,
          snapshot: parsed ? [parsed] : [],
          qualitative: amounts.length === 0,
        })
        return { item, purchases: [purchase] }
      }

      const linked = tx
        .list<ShoppingPurchase>('shoppingPurchases')
        .filter((row) => row.data.manualItemId === id)
      const ids = new Set(linked.map((row) => row.data.id))
      if (context.adoptablePurchase) {
        const candidate = tx.get<ShoppingPurchase>(
          'shoppingPurchases',
          context.adoptablePurchase.id,
        )
        if (candidate && !candidate.data.manualItemId) {
          ids.add(candidate.data.id)
        }
      }
      for (const purchaseId of ids) {
        removeIfExists(tx, 'shoppingPurchases', purchaseId)
      }
      return { item, purchases: [] }
    })

  try {
    return await perform()
  } catch (cause) {
    if (cause instanceof CloudConflictError) return perform()
    throw cause
  }
}

async function restoreManual(
  store: CloudRecordsStore,
  item: ShoppingManualItem,
  purchases: readonly ShoppingPurchase[],
): Promise<void> {
  await store.transaction(async (tx) => {
    const existingItem = tx.get<ShoppingManualItem>('shoppingManualItems', item.id)
    writeRow(tx, 'shoppingManualItems', item.id, { ...item }, existingItem)
    for (const purchase of purchases) {
      const existing = tx.get<ShoppingPurchase>('shoppingPurchases', purchase.id)
      writeRow(
        tx,
        'shoppingPurchases',
        purchase.id,
        { ...purchase },
        existing,
      )
    }
  })
}

/* ------------------------------------------------------------------ */
/* Distribution                                                        */
/* ------------------------------------------------------------------ */

function demandItem(
  demand: ShoppingPeriodDemand,
  itemKey: string,
): ShoppingPeriodDemand['items'][number] {
  const key = cleanText(itemKey)
  const item = demand.items.find((entry) => entry.key === key)
  if (!item) {
    throw new ShoppingListError(
      'position-not-found',
      'Die Einkaufsposition wurde nicht gefunden.',
      { itemKey: key },
    )
  }
  return item
}

function requireTargetList(
  tx: RecordsTransaction,
  listId: string,
  period: ShoppingPeriod,
): ShoppingList {
  const id = cleanText(listId)
  if (!id) {
    throw new ShoppingListError(
      'invalid-target-list',
      'Die Ziel-Einkaufsliste fehlt.',
    )
  }
  const row = tx.get<ShoppingList>('shoppingLists', id)
  if (!row) {
    throw new ShoppingListError(
      'list-not-found',
      'Die Ziel-Einkaufsliste wurde nicht gefunden.',
    )
  }
  if (row.data.kind === 'standard' && row.data.periodStart !== period.start) {
    throw new ShoppingListError(
      'invalid-target-list',
      'Der Standardzettel gehört zu einem anderen Einkaufszeitraum.',
      {
        listId: id,
        listPeriodStart: row.data.periodStart,
        periodStart: period.start,
      },
    )
  }
  return row.data
}

function movePurchasesToStandardInTx(
  tx: RecordsTransaction,
  itemKey: string,
  period: ShoppingPeriod,
  fromListIds: ReadonlySet<string>,
  now: number,
): number {
  if (fromListIds.size === 0) return 0
  const data = txShoppingData(tx)
  const standardId = standardShoppingListId(period.start)
  let moved = 0
  for (const row of tx.list<ShoppingPurchase>('shoppingPurchases')) {
    const purchase = row.data
    if (purchase.manualItemId) continue
    if (!DATE_RE.test(purchase.shoppingDate)) continue
    if (!periodContainsDate(period, purchase.shoppingDate)) continue
    if (resolveCanonicalKey(purchase.itemKey, data.rules) !== itemKey) continue
    const currentListId = purchase.listId ?? standardId
    if (currentListId === standardId || !fromListIds.has(currentListId)) continue
    tx.update(
      'shoppingPurchases',
      purchase.id,
      {
        ...purchase,
        listId: standardId,
        legacyWeekAmbiguous: undefined,
        updatedAt: now,
      },
      row.rev,
    )
    moved += 1
  }
  return moved
}

function removeAllocationInTx(tx: RecordsTransaction, id: string): void {
  const data = txShoppingData(tx)
  const existing = data.allocations.find((allocation) => allocation.id === id)
  if (!existing) {
    throw new ShoppingListError(
      'allocation-not-found',
      'Die Zuweisung wurde nicht gefunden.',
    )
  }
  const settings = settingsOf(data)
  let demandedKeys = new Set<string>()
  try {
    const period = resolvePeriod(
      existing.periodStart,
      settings,
      data.shoppingLists,
    )
    demandedKeys = new Set(
      demandForPeriod(period, data, settings).items.map((item) => item.key),
    )
  } catch {
    demandedKeys = new Set()
  }
  const itemKey = catalogShoppingKey(existing.itemKey)
  if (!demandedKeys.has(itemKey)) {
    removeIfExists(tx, 'shoppingDemandAllocations', id)
    return
  }

  const period = periodForPersistedStart(existing.periodStart, data.shoppingLists)
  const variants = new Set(catalogKeyVariants(itemKey))
  const remaining = data.allocations.filter(
    (allocation) =>
      allocation.periodStart === existing.periodStart &&
      variants.has(allocation.itemKey),
  )
  removeIfExists(tx, 'shoppingDemandAllocations', id)
  const stillAssigned = remaining.some(
    (allocation) =>
      allocation.id !== id && allocation.listId === existing.listId,
  )
  if (stillAssigned) return
  movePurchasesToStandardInTx(
    tx,
    itemKey,
    period,
    new Set([existing.listId]),
    Date.now(),
  )
}

async function removeAllocations(
  store: CloudRecordsStore,
  ids: readonly string[],
): Promise<void> {
  if (ids.length === 0) return
  await store.transaction(async (tx) => {
    for (const id of ids) removeAllocationInTx(tx, id)
  })
}

async function removeAllocation(
  store: CloudRecordsStore,
  id: string,
): Promise<void> {
  await store.transaction(async (tx) => removeAllocationInTx(tx, id))
}

async function resetAllocations(
  store: CloudRecordsStore,
  input: ResetShoppingAllocationsInput,
): Promise<number> {
  return store.transaction(async (tx) => {
    const data = txShoppingData(tx)
    const settings = settingsOf(data)
    const period = resolvePeriod(input.periodStart, settings, data.shoppingLists)
    const itemKey = optionalText(input.itemKey)
    const dimension = optionalText(input.dimension)
    let demandedKeys = new Set<string>()
    try {
      demandedKeys = new Set(
        demandForPeriod(period, data, settings).items.map((entry) => entry.key),
      )
    } catch {
      demandedKeys = new Set()
    }

    const variants = itemKey ? new Set(catalogKeyVariants(itemKey)) : null
    const rows = data.allocations.filter(
      (allocation) =>
        allocation.periodStart === period.start &&
        (!variants || variants.has(allocation.itemKey)),
    )
    if (dimension && rows.some((allocation) => allocation.dimension === '*')) {
      throw new ShoppingListError(
        'full-allocation-conflict',
        'Die ganze Position ist vollständig verschoben. Ein dimensionsbezogener Reset ist nicht eindeutig.',
        { itemKey, dimension },
      )
    }
    const removed = rows.filter(
      (allocation) => !dimension || allocation.dimension === dimension,
    )
    const affected = new Map<string, Set<string>>()
    for (const allocation of removed) {
      const key = catalogShoppingKey(allocation.itemKey)
      if (!demandedKeys.has(key)) continue
      const listIds = affected.get(key) ?? new Set<string>()
      listIds.add(allocation.listId)
      affected.set(key, listIds)
    }
    for (const allocation of removed) {
      removeIfExists(tx, 'shoppingDemandAllocations', allocation.id)
    }

    const now = Date.now()
    for (const [key, listIds] of affected) {
      const keyVariants = new Set(catalogKeyVariants(key))
      const remaining = tx
        .list<ShoppingDemandAllocation>('shoppingDemandAllocations')
        .map((row) => row.data)
        .filter(
          (allocation) =>
            allocation.periodStart === period.start &&
            keyVariants.has(allocation.itemKey),
        )
      const stillAssigned = new Set(remaining.map((allocation) => allocation.listId))
      const unassigned = new Set(
        Array.from(listIds).filter((listId) => !stillAssigned.has(listId)),
      )
      if (unassigned.size > 0) {
        movePurchasesToStandardInTx(tx, key, period, unassigned, now)
      }
    }
    return removed.length
  })
}

async function moveItem(
  store: CloudRecordsStore,
  input: MoveShoppingItemInput,
): Promise<MoveShoppingItemResult> {
  return store.transaction(async (tx) => {
    const data = txShoppingData(tx)
    const settings = settingsOf(data)
    const period = resolvePeriod(input.periodStart, settings, data.shoppingLists)
    const demand = demandForPeriod(period, data, settings)
    const item = demandItem(demand, input.itemKey)
    const target = requireTargetList(tx, input.targetListId, demand.period)
    const targetIsStandard = target.id === demand.standardListId
    const now = Date.now()
    const rules = data.rules
    const variants = new Set(catalogKeyVariants(item.key))
    for (const allocation of data.allocations) {
      if (
        allocation.periodStart === demand.period.start &&
        variants.has(allocation.itemKey)
      ) {
        removeIfExists(tx, 'shoppingDemandAllocations', allocation.id)
      }
    }
    if (!targetIsStandard) {
      tx.create(
        'shoppingDemandAllocations',
        shoppingAllocationId(demand.period.start, item.key, '*', target.id),
        {
          id: shoppingAllocationId(demand.period.start, item.key, '*', target.id),
          periodStart: demand.period.start,
          itemKey: item.key,
          dimension: '*',
          listId: target.id,
          mode: 'full',
          createdAt: now,
          updatedAt: now,
        },
      )
    }

    let movedPurchases = 0
    for (const row of tx.list<ShoppingPurchase>('shoppingPurchases')) {
      const purchase = row.data
      if (purchase.manualItemId) continue
      if (!DATE_RE.test(purchase.shoppingDate)) continue
      if (!periodContainsDate(demand.period, purchase.shoppingDate)) continue
      if (resolveCanonicalKey(purchase.itemKey, rules) !== item.key) continue
      tx.update(
        'shoppingPurchases',
        purchase.id,
        {
          ...purchase,
          listId: target.id,
          legacyWeekAmbiguous: undefined,
          updatedAt: now,
        },
        row.rev,
      )
      movedPurchases += 1
    }

    return {
      mode: targetIsStandard ? 'reset' : 'full',
      targetListId: target.id,
      movedPurchases,
    }
  })
}

async function assignSubquantity(
  store: CloudRecordsStore,
  input: AssignShoppingSubquantityInput,
): Promise<AssignShoppingSubquantityResult> {
  return store.transaction(async (tx) => {
    const data = txShoppingData(tx)
    const settings = settingsOf(data)
    const period = resolvePeriod(input.periodStart, settings, data.shoppingLists)
    const demand = demandForPeriod(period, data, settings)
    const item = demandItem(demand, input.itemKey)
    if (
      item.positions.length === 0 &&
      (item.unparsedAmounts.length > 0 || item.missingQuantity)
    ) {
      throw new ShoppingListError(
        'ambiguous-quantity',
        'Diese Angabe ist nicht eindeutig quantifiziert und kann nicht als Teilmenge aufgeteilt werden.',
        { itemKey: item.key },
      )
    }
    const dimension = cleanText(input.dimension)
    const position = item.positions.find((entry) => entry.dimension === dimension)
    if (!position) {
      throw new ShoppingListError(
        'position-not-found',
        'Die Einkaufsposition wurde nicht gefunden.',
        { itemKey: item.key, dimension },
      )
    }
    if (position.lower !== position.upper) {
      throw new ShoppingListError(
        'ambiguous-quantity',
        'Ein Mengenbereich kann nicht als feste Teilmenge aufgeteilt werden.',
        {
          itemKey: item.key,
          dimension,
          lower: position.lower,
          upper: position.upper,
        },
      )
    }
    const target = requireTargetList(tx, input.targetListId, demand.period)

    let requestedMilli: number
    const unit = optionalText(input.unit)
    if (unit) {
      const parsed = parseShoppingQuantityPosition(String(input.quantity), unit)
      if (!parsed || parsed.lower !== parsed.upper || parsed.lower <= 0) {
        throw new ShoppingListError('invalid-quantity', 'Die Menge ist ungültig.', {
          quantity: input.quantity,
          unit,
        })
      }
      if (parsed.dimension !== dimension) {
        throw new ShoppingListError(
          'incompatible-unit',
          'Die Einheit passt nicht zur Einkaufsposition.',
          { unit, dimension, parsedDimension: parsed.dimension },
        )
      }
      requestedMilli = toAmountMilli(parsed.lower)
    } else {
      if (!Number.isFinite(input.quantity) || input.quantity <= 0) {
        throw new ShoppingListError('invalid-quantity', 'Die Menge ist ungültig.', {
          quantity: input.quantity,
        })
      }
      requestedMilli = toAmountMilli(input.quantity)
    }
    const availableMilli = toAmountMilli(position.lower)
    if (requestedMilli <= 0) {
      throw new ShoppingListError(
        'invalid-quantity',
        'Die Menge muss größer als null sein.',
      )
    }
    if (requestedMilli > availableMilli) {
      throw new ShoppingListError(
        'over-allocation',
        'Die Teilmenge übersteigt den Gesamtbedarf.',
        { requestedMilli, availableMilli },
      )
    }

    const variants = new Set(catalogKeyVariants(item.key))
    const allocations = data.allocations.filter(
      (allocation) =>
        allocation.periodStart === demand.period.start &&
        variants.has(allocation.itemKey),
    )
    if (
      allocations.some(
        (allocation) => allocation.dimension === '*' && allocation.mode === 'full',
      )
    ) {
      throw new ShoppingListError(
        'full-allocation-conflict',
        'Die ganze Position ist bereits vollständig verschoben. Bitte zuerst zurücksetzen.',
        { itemKey: item.key },
      )
    }
    const sameDimension = allocations.filter(
      (allocation) => allocation.dimension === dimension,
    )
    const fullRows = sameDimension.filter(
      (allocation) => allocation.mode === 'full',
    )
    for (const allocation of fullRows) {
      removeIfExists(tx, 'shoppingDemandAllocations', allocation.id)
    }
    const otherMilli = sameDimension
      .filter(
        (allocation) =>
          allocation.mode === 'partial' && allocation.listId !== target.id,
      )
      .reduce(
        (sum, allocation) => sum + Math.max(0, allocation.quantityMilli ?? 0),
        0,
      )
    if (otherMilli + requestedMilli > availableMilli) {
      throw new ShoppingListError(
        'over-allocation',
        'Die Teilmengen überschreiten zusammen den Gesamtbedarf.',
        { otherMilli, requestedMilli, availableMilli },
      )
    }
    const id = shoppingAllocationId(
      demand.period.start,
      item.key,
      dimension,
      target.id,
    )
    const existing = tx.get<ShoppingDemandAllocation>(
      'shoppingDemandAllocations',
      id,
    )
    const now = Date.now()
    const allocation: ShoppingDemandAllocation = {
      id,
      periodStart: demand.period.start,
      itemKey: item.key,
      dimension,
      listId: target.id,
      mode: 'partial',
      quantityMilli: requestedMilli,
      createdAt: existing?.data.createdAt ?? now,
      updatedAt: now,
    }
    writeRow(tx, 'shoppingDemandAllocations', id, allocation, existing)
    return {
      allocation,
      requestedLower: fromAmountMilli(requestedMilli),
      convertedFromFull: fullRows.length > 0,
    }
  })
}

/* ------------------------------------------------------------------ */
/* Rules and corrections                                               */
/* ------------------------------------------------------------------ */

async function saveRule(
  store: CloudRecordsStore,
  key: string,
  patch: ItemRuleInput,
): Promise<ShoppingItemRule | null> {
  const cleanKey = cleanText(key)
  if (!cleanKey) {
    throw new ShoppingListError(
      'invalid-list-name',
      'Der Artikel konnte nicht zugeordnet werden.',
    )
  }
  return store.transaction(async (tx) => {
    const existingRow = tx.get<ShoppingItemRule>('shoppingItemRules', cleanKey)
    const existing = existingRow?.data
    const displayName = cleanText(
      patch.displayName ?? existing?.displayName ?? '',
    )
    const purchaseNote = cleanText(
      patch.purchaseNote ?? existing?.purchaseNote ?? '',
    )
    const categoryId =
      patch.categoryId === undefined
        ? (existing?.categoryId ?? null)
        : categoryOrNull(patch.categoryId)
    const purchaseNoteOverride =
      patch.purchaseNoteOverride === undefined
        ? existing?.purchaseNoteOverride === true
        : patch.purchaseNoteOverride === true
    const hiddenPurchaseNotes = Array.from(
      new Set(
        (
          patch.hiddenPurchaseNotes ??
          existing?.hiddenPurchaseNotes ??
          []
        )
          .map((note) => cleanText(note))
          .filter(Boolean),
      ),
    )
    const canonicalKey = cleanText(existing?.canonicalKey ?? cleanKey) || cleanKey

    if (
      !displayName &&
      !purchaseNote &&
      !categoryId &&
      !purchaseNoteOverride &&
      hiddenPurchaseNotes.length === 0 &&
      !existing?.legacyQuantityText &&
      !existing?.legacyUnit &&
      !existing?.legacyAmbiguous &&
      canonicalKey === cleanKey
    ) {
      if (existingRow) tx.remove('shoppingItemRules', cleanKey, existingRow.rev)
      return null
    }
    const rule: ShoppingItemRule = {
      key: cleanKey,
      canonicalKey,
      displayName,
      categoryId,
      purchaseNote,
      purchaseNoteOverride,
      hiddenPurchaseNotes,
      legacyQuantityText: existing?.legacyQuantityText ?? '',
      legacyUnit: existing?.legacyUnit ?? '',
      legacyAmbiguous: existing?.legacyAmbiguous,
      updatedAt: Date.now(),
    }
    writeRow(tx, 'shoppingItemRules', cleanKey, rule, existingRow)
    return rule
  })
}

async function saveCorrection(
  store: CloudRecordsStore,
  input: QuantityCorrectionInput,
): Promise<ShoppingQuantityCorrection> {
  const shoppingDate = requireDate(cleanText(input.shoppingDate))
  const itemKey = cleanText(input.itemKey)
  if (!itemKey) {
    throw new ShoppingListError(
      'purchase-conflict',
      'Der Artikel konnte nicht zugeordnet werden.',
    )
  }
  const dimension = cleanText(input.dimension)
  if (!dimension) {
    throw new ShoppingListError(
      'invalid-quantity',
      'Die Mengenposition konnte nicht zugeordnet werden.',
    )
  }
  const quantityText = cleanText(input.quantityText)
  if (!quantityText) {
    throw new ShoppingListError(
      'invalid-quantity',
      'Bitte eine korrigierte Menge angeben.',
    )
  }
  const unit = optionalText(input.unit)
  const parsed = parseShoppingQuantityPosition(quantityText, unit)
  if (!parsed) {
    throw new ShoppingListError(
      'invalid-quantity',
      'Die korrigierte Menge konnte nicht gelesen werden.',
    )
  }
  if (parsed.dimension !== dimension) {
    throw new ShoppingListError(
      'incompatible-unit',
      'Die Einheit passt nicht zur gewählten Mengenposition.',
    )
  }
  if (!shoppingUnitDimension(unit) && unit) {
    throw new ShoppingListError(
      'incompatible-unit',
      'Die Einheit konnte nicht zugeordnet werden.',
    )
  }

  const id = quantityCorrectionId(itemKey, shoppingDate, dimension)
  return store.transaction(async (tx) => {
    const existing = tx.get<ShoppingQuantityCorrection>(
      'shoppingQuantityCorrections',
      id,
    )
    const now = Date.now()
    const correction: ShoppingQuantityCorrection = {
      id,
      shoppingDate,
      itemKey,
      dimension,
      quantityText,
      unit: optionalNullable(input.unit),
      sourceSignature: cleanText(input.sourceSignature),
      createdAt: existing?.data.createdAt ?? now,
      updatedAt: now,
    }
    writeRow(tx, 'shoppingQuantityCorrections', id, correction, existing)
    return correction
  })
}

async function clearLegacy(
  store: CloudRecordsStore,
  key: string,
): Promise<void> {
  const cleanKey = cleanText(key)
  if (!cleanKey) return
  await store.transaction(async (tx) => {
    const existing = tx.get<ShoppingItemRule>('shoppingItemRules', cleanKey)
    if (!existing) return
    const next: ShoppingItemRule = {
      ...existing.data,
      legacyQuantityText: '',
      legacyUnit: '',
      updatedAt: Date.now(),
    }
    if (
      !next.displayName &&
      !next.categoryId &&
      !next.purchaseNote &&
      !next.purchaseNoteOverride &&
      (next.hiddenPurchaseNotes?.length ?? 0) === 0 &&
      next.legacyAmbiguous !== true &&
      (next.canonicalKey ?? cleanKey) === cleanKey
    ) {
      tx.remove('shoppingItemRules', cleanKey, existing.rev)
    } else {
      tx.update('shoppingItemRules', cleanKey, next, existing.rev)
    }
  })
}

async function splitProduct(
  store: CloudRecordsStore,
  aliasKey: string,
): Promise<void> {
  const key = cleanText(aliasKey)
  if (!key) return
  await store.transaction(async (tx) => {
    const existing = tx.get<ShoppingItemRule>('shoppingItemRules', key)
    if (!existing) return
    const canonical = cleanText(existing.data.canonicalKey ?? key)
    if (canonical && canonical !== key) {
      const allocationCount = tx
        .list<ShoppingDemandAllocation>('shoppingDemandAllocations')
        .filter((row) => row.data.itemKey === canonical).length
      if (allocationCount > 0) {
        throw new ShoppingListError(
          'allocation-merge-conflict',
          'Die Produktzusammenführung kann nicht getrennt werden, solange Einkaufsverteilungen bestehen.',
          { aliasKey: key, canonicalKey: canonical, allocationCount },
        )
      }
    }
    const next: ShoppingItemRule = {
      ...existing.data,
      canonicalKey: key,
      updatedAt: Date.now(),
    }
    if (
      !next.displayName &&
      !next.categoryId &&
      !next.purchaseNote &&
      !next.purchaseNoteOverride &&
      (next.hiddenPurchaseNotes?.length ?? 0) === 0
    ) {
      tx.remove('shoppingItemRules', key, existing.rev)
    } else {
      tx.update('shoppingItemRules', key, next, existing.rev)
    }
  })
}

/* ------------------------------------------------------------------ */
/* Product merge                                                       */
/* ------------------------------------------------------------------ */

function purchasePeriodStartOf(
  purchase: ShoppingPurchase,
  lists: readonly ShoppingList[],
): string | null {
  if (purchase.listId?.startsWith('standard:')) {
    return purchase.listId.slice('standard:'.length)
  }
  const containing = lists.find(
    (list) =>
      list.kind === 'standard' &&
      typeof list.periodStart === 'string' &&
      typeof list.periodEnd === 'string' &&
      periodContainsDate(
        { start: list.periodStart, end: list.periodEnd },
        purchase.shoppingDate,
      ),
  )
  return containing?.periodStart ?? null
}

function refreshConfirmedTotalsInTx(
  tx: RecordsTransaction,
  itemKey: string,
): void {
  const rows = tx
    .list<ShoppingPurchase>('shoppingPurchases')
    .filter((row) => row.data.itemKey === itemKey)
  const lists = rowsData(tx.list<ShoppingList>('shoppingLists'))
  const byPeriod = new Map<string, RecordRow<ShoppingPurchase>[]>()
  for (const row of rows) {
    const periodStart = purchasePeriodStartOf(row.data, lists)
    if (!periodStart) continue
    const list = byPeriod.get(periodStart) ?? []
    list.push(row)
    byPeriod.set(periodStart, list)
  }
  for (const periodRows of byPeriod.values()) {
    periodRows.sort(
      (a, b) =>
        a.data.createdAt - b.data.createdAt ||
        a.data.id.localeCompare(b.data.id),
    )
    const latest = periodRows[periodRows.length - 1]
    if (!latest) continue
    const previous = periodRows.slice(0, -1).map((row) => row.data)
    tx.update(
      'shoppingPurchases',
      latest.data.id,
      {
        ...latest.data,
        confirmedTotal: confirmedTotals(previous, latest.data.amounts),
        updatedAt: Date.now(),
      },
      latest.rev,
    )
  }
}

function assertMergeAllocationsCompatible(
  data: ShoppingData,
  sourceKey: string,
  targetKey: string,
): void {
  const sourceVariants = new Set(catalogKeyVariants(sourceKey))
  const targetVariants = new Set(catalogKeyVariants(targetKey))
  const sourceAllocations = data.allocations.filter((allocation) =>
    sourceVariants.has(allocation.itemKey),
  )
  const targetAllocations = data.allocations.filter((allocation) =>
    targetVariants.has(allocation.itemKey),
  )
  if (sourceAllocations.length === 0 || targetAllocations.length === 0) return

  const targetByPeriod = new Map<string, ShoppingDemandAllocation[]>()
  for (const allocation of targetAllocations) {
    const rows = targetByPeriod.get(allocation.periodStart) ?? []
    rows.push(allocation)
    targetByPeriod.set(allocation.periodStart, rows)
  }
  const sourceByPeriod = new Map<string, ShoppingDemandAllocation[]>()
  for (const allocation of sourceAllocations) {
    const rows = sourceByPeriod.get(allocation.periodStart) ?? []
    rows.push(allocation)
    sourceByPeriod.set(allocation.periodStart, rows)
  }

  const conflict = (
    periodStart: string,
    dimension: string,
    listId: string | null,
  ): never => {
    throw new ShoppingListError(
      'allocation-merge-conflict',
      'Zwei Einkaufsverteilungen lassen sich nach der Produktzusammenführung nicht eindeutig vereinigen.',
      { sourceKey, targetKey, periodStart, dimension, listId },
    )
  }

  for (const [periodStart, sourceRows] of sourceByPeriod) {
    const targetRows = targetByPeriod.get(periodStart)
    if (!targetRows || targetRows.length === 0) continue
    const sourceFull = sourceRows.find((allocation) => allocation.dimension === '*')
    const targetFull = targetRows.find((allocation) => allocation.dimension === '*')
    if (sourceFull) conflict(periodStart, '*', sourceFull.listId)
    if (targetFull) conflict(periodStart, '*', targetFull.listId)

    const dimensions = new Set(
      [...sourceRows, ...targetRows]
        .map((allocation) => allocation.dimension)
        .filter((dimension) => dimension !== '*'),
    )
    for (const dimension of dimensions) {
      const sourceDimension = sourceRows.filter(
        (allocation) => allocation.dimension === dimension,
      )
      const targetDimension = targetRows.filter(
        (allocation) => allocation.dimension === dimension,
      )
      if (sourceDimension.length === 0 || targetDimension.length === 0) continue
      if (
        sourceDimension.some((allocation) => allocation.mode === 'full') ||
        targetDimension.some((allocation) => allocation.mode === 'full')
      ) {
        conflict(
          periodStart,
          dimension,
          sourceDimension[0]?.listId ?? targetDimension[0]?.listId ?? null,
        )
      }
    }
  }
}

function mergeRulesInTx(
  tx: RecordsTransaction,
  sourceKey: string,
  targetKey: string,
  rules: readonly ShoppingItemRule[],
): string {
  const finalTarget = resolveCanonicalKey(targetKey, rules)
  if (finalTarget === sourceKey) {
    throw new ShoppingListError(
      'allocation-merge-conflict',
      'Diese beiden Artikel können nicht so zusammengeführt werden.',
    )
  }
  const source = rules.find((rule) => rule.key === sourceKey)
  const target = rules.find((rule) => rule.key === finalTarget)
  const now = Date.now()
  const sourceRow = tx.get<ShoppingItemRule>('shoppingItemRules', sourceKey)
  writeRow(
    tx,
    'shoppingItemRules',
    sourceKey,
    {
      key: sourceKey,
      canonicalKey: finalTarget,
      displayName: source?.displayName ?? '',
      categoryId: source?.categoryId ?? null,
      purchaseNote: source?.purchaseNote ?? '',
      purchaseNoteOverride: source?.purchaseNoteOverride === true,
      hiddenPurchaseNotes: source?.hiddenPurchaseNotes ?? [],
      legacyQuantityText: source?.legacyQuantityText ?? '',
      legacyUnit: source?.legacyUnit ?? '',
      legacyAmbiguous: source?.legacyAmbiguous,
      updatedAt: now,
    },
    sourceRow,
  )
  if (!target || !target.categoryId || !target.purchaseNote) {
    const targetRow = tx.get<ShoppingItemRule>('shoppingItemRules', finalTarget)
    writeRow(
      tx,
      'shoppingItemRules',
      finalTarget,
      {
        key: finalTarget,
        canonicalKey: finalTarget,
        displayName: target?.displayName ?? '',
        categoryId: target?.categoryId ?? source?.categoryId ?? null,
        purchaseNote: target?.purchaseNote || source?.purchaseNote || '',
        purchaseNoteOverride:
          target?.purchaseNoteOverride === true ||
          source?.purchaseNoteOverride === true,
        hiddenPurchaseNotes:
          target?.hiddenPurchaseNotes ?? source?.hiddenPurchaseNotes ?? [],
        legacyQuantityText:
          target?.legacyQuantityText || source?.legacyQuantityText || '',
        legacyUnit: target?.legacyUnit || source?.legacyUnit || '',
        legacyAmbiguous:
          target?.legacyAmbiguous ?? source?.legacyAmbiguous,
        updatedAt: now,
      },
      targetRow,
    )
  }
  return finalTarget
}

function mergeProductsInTx(
  tx: RecordsTransaction,
  sourceKey: string,
  targetKey: string,
): string {
  const source = cleanText(sourceKey)
  const target = cleanText(targetKey)
  if (!source || !target || source === target) return source
  const data = txShoppingData(tx)
  const resolvedTarget = resolveCanonicalKey(target, data.rules)
  if (resolvedTarget === source) {
    throw new ShoppingListError(
      'allocation-merge-conflict',
      'Diese beiden Artikel können nicht so zusammengeführt werden.',
    )
  }
  assertMergeAllocationsCompatible(data, source, resolvedTarget)
  const finalTarget = mergeRulesInTx(tx, source, target, data.rules)
  const now = Date.now()

  const sourceVariants = new Set(catalogKeyVariants(source))
  const sourceAllocations = data.allocations.filter((allocation) =>
    sourceVariants.has(allocation.itemKey),
  )
  const remapped = sourceAllocations.map((allocation) => ({
    source: allocation,
    targetId: shoppingAllocationId(
      allocation.periodStart,
      finalTarget,
      allocation.dimension,
      allocation.listId,
    ),
  }))
  for (const entry of remapped) {
    const conflict = tx.get<ShoppingDemandAllocation>(
      'shoppingDemandAllocations',
      entry.targetId,
    )
    if (conflict) {
      throw new ShoppingListError(
        'allocation-merge-conflict',
        'Zwei Einkaufsverteilungen lassen sich nach der Produktzusammenführung nicht eindeutig vereinigen.',
        {
          sourceKey: source,
          targetKey: finalTarget,
          periodStart: entry.source.periodStart,
          dimension: entry.source.dimension,
          listId: entry.source.listId,
          sourceAllocationId: entry.source.id,
          targetAllocationId: entry.targetId,
        },
      )
    }
  }
  for (const entry of remapped) {
    removeIfExists(tx, 'shoppingDemandAllocations', entry.source.id)
    tx.create('shoppingDemandAllocations', entry.targetId, {
      ...entry.source,
      id: entry.targetId,
      itemKey: finalTarget,
      updatedAt: now,
    })
  }

  for (const row of tx.list<ShoppingPurchase>('shoppingPurchases')) {
    if (!sourceVariants.has(row.data.itemKey)) continue
    tx.update(
      'shoppingPurchases',
      row.data.id,
      { ...row.data, itemKey: finalTarget, updatedAt: now },
      row.rev,
    )
  }

  const corrections = tx
    .list<ShoppingQuantityCorrection>('shoppingQuantityCorrections')
    .filter((row) => sourceVariants.has(row.data.itemKey))
  for (const row of corrections) {
    const correction = row.data
    const nextId = quantityCorrectionId(
      finalTarget,
      correction.shoppingDate,
      correction.dimension,
    )
    if (tx.get('shoppingQuantityCorrections', nextId)) {
      tx.remove('shoppingQuantityCorrections', correction.id, row.rev)
    } else {
      tx.remove('shoppingQuantityCorrections', correction.id, row.rev)
      tx.create('shoppingQuantityCorrections', nextId, {
        ...correction,
        id: nextId,
        itemKey: finalTarget,
        updatedAt: now,
      })
    }
  }

  for (const row of tx.list<ShoppingCheck>('shoppingChecks')) {
    if (!sourceVariants.has(row.data.itemKey)) continue
    tx.update(
      'shoppingChecks',
      row.data.id,
      { ...row.data, itemKey: finalTarget, updatedAt: now },
      row.rev,
    )
  }
  refreshConfirmedTotalsInTx(tx, finalTarget)
  return finalTarget
}

async function mergeProducts(
  store: CloudRecordsStore,
  sourceKey: string,
  targetKey: string,
): Promise<string> {
  const source = cleanText(sourceKey)
  const target = cleanText(targetKey)
  if (!source || !target || source === target) return source
  return store.transaction(async (tx) => mergeProductsInTx(tx, source, target))
}

async function resolveAmbiguous(
  store: CloudRecordsStore,
  ruleKey: string,
  targetKey: string,
): Promise<void> {
  const source = cleanText(ruleKey)
  const target = cleanText(targetKey)
  if (!source || !target) return
  await store.transaction(async (tx) => {
    await mergeProductsInTx(tx, source, target)
    const rule = tx.get<ShoppingItemRule>('shoppingItemRules', source)
    if (!rule) return
    // A rule created by the merge already carries the canonical target.
    // Updating a pending create would need a revision that does not exist yet.
    if (rule.rev === 0) return
    tx.update(
      'shoppingItemRules',
      source,
      {
        ...rule.data,
        canonicalKey: target,
        legacyAmbiguous: false,
        updatedAt: Date.now(),
      },
      rule.rev,
    )
  })
}

/* ------------------------------------------------------------------ */
/* Other settings                                                      */
/* ------------------------------------------------------------------ */

async function saveCategoryOrderSettings(
  store: CloudRecordsStore,
  order: readonly ShoppingCategoryId[],
): Promise<ShoppingCategoryId[]> {
  const normalized = normalizeCategoryOrder(order)
  await store.transaction(async (tx) => {
    const existing = tx.get<SettingRecord>(
      'settings',
      CATEGORY_ORDER_SETTING_KEY,
    )
    const row: SettingRecord = {
      key: CATEGORY_ORDER_SETTING_KEY,
      value: serializeCategoryOrder(normalized),
    }
    writeRow(tx, 'settings', row.key, row, existing)
  })
  return normalized
}

function dateInList(list: ShoppingList, date: string | undefined): boolean {
  return Boolean(
    list.kind === 'standard' &&
      list.periodStart &&
      list.periodEnd &&
      date &&
      DATE_RE.test(date) &&
      periodContainsDate({ start: list.periodStart, end: list.periodEnd }, date),
  )
}

function listHasShoppingData(
  list: ShoppingList,
  data: ShoppingData,
  checks: readonly ShoppingCheck[],
): boolean {
  if (list.kind !== 'standard' || !list.periodStart || !list.periodEnd) {
    return false
  }
  return (
    data.manualItems.some(
      (item) =>
        item.listId === list.id ||
        (!item.listId && dateInList(list, item.shoppingDate || item.weekStart)),
    ) ||
    data.purchases.some(
      (purchase) =>
        purchase.listId === list.id ||
        (!purchase.listId && dateInList(list, purchase.shoppingDate)),
    ) ||
    data.allocations.some(
      (allocation) =>
        allocation.listId === list.id ||
        allocation.periodStart === list.periodStart,
    ) ||
    checks.some((check) =>
      dateInList(list, check.shoppingDate || check.weekStart),
    )
  )
}

async function applySettings(
  store: CloudRecordsStore,
  patch: Partial<ShoppingSettings>,
  today = todayKey(),
): Promise<ShoppingSettings> {
  return store.transaction(async (tx) => {
    const data = txShoppingData(tx)
    const checks = rowsData(tx.list<ShoppingCheck>('shoppingChecks'))
    const current = settingsOf(data)
    const normalized = normalizeShoppingSettings({ ...current, ...patch })
    const now = Date.now()
    const dayChanged =
      normalized.periodStartDay !== current.periodStartDay

    const removable = dayChanged
      ? data.shoppingLists.filter(
          (list) =>
            list.kind === 'standard' &&
            list.periodStart !== null &&
            list.periodEnd !== null &&
            list.periodEnd >= today &&
            !listHasShoppingData(list, data, checks),
        )
      : []
    const removableIds = new Set(removable.map((list) => list.id))

    for (const value of [
      {
        key: SHOPPING_PERIOD_START_DAY_KEY,
        value: normalized.periodStartDay,
      },
      {
        key: STANDARD_SHOPPING_LIST_NAME_KEY,
        value: normalized.standardListName,
      },
    ]) {
      const existing = tx.get<SettingRecord>('settings', value.key)
      writeRow(tx, 'settings', value.key, value, existing)
    }

    for (const list of removable) {
      removeIfExists(tx, 'shoppingLists', list.id)
    }

    for (const list of data.shoppingLists) {
      if (list.kind !== 'standard' || removableIds.has(list.id)) continue
      if (!list.periodStart || !list.periodEnd) continue
      const period = shoppingPeriodFromRange(list.periodStart, list.periodEnd)
      const name = standardShoppingListName(
        normalized.standardListName,
        period,
      )
      if (name === list.name) continue
      const row = tx.get<ShoppingList>('shoppingLists', list.id)
      if (row) tx.update('shoppingLists', list.id, { ...list, name, updatedAt: now }, row.rev)
    }
    return normalized
  })
}

/* ------------------------------------------------------------------ */
/* Backend factory                                                     */
/* ------------------------------------------------------------------ */

export function createCloudShoppingBackend(
  store: CloudRecordsStore,
): ShoppingBackend {
  return {
    useShoppingData() {
      const version = useStoreVersion(store)
      return useMemo(() => readShoppingData(store), [store, version])
    },

    ensureStandardShoppingList: (anchor) => ensureStandardList(store, anchor),
    createFreeShoppingList: (input) => createFreeList(store, input),
    renameShoppingList: (id, name) => renameList(store, id, name),
    deleteFreeShoppingList: (id, options) =>
      deleteFreeList(store, id, options),
    createManualListItem: (input) => createManualItem(store, input),
    updateManualListItem: (id, patch) => updateManualItem(store, id, patch),
    removeManualListItemWithPurchases: (id) =>
      removeManualItemWithPurchases(store, id),
    setManualItemPurchased: (id, purchased) =>
      setManualPurchased(store, id, purchased),
    restoreManualItem: (item, purchases) =>
      restoreManual(store, item, purchases),
    addShoppingPurchase: (input) => addPurchase(store, input),
    removeShoppingPurchase: (id) => removePurchase(store, id),
    removeShoppingPurchases: (ids) => removePurchases(store, ids),
    moveShoppingItem: (input) => moveItem(store, input),
    assignShoppingSubquantity: (input) => assignSubquantity(store, input),
    removeShoppingAllocation: (id) => removeAllocation(store, id),
    removeShoppingAllocations: (ids) => removeAllocations(store, ids),
    resetShoppingAllocations: (input) => resetAllocations(store, input),
    saveCategoryOrder: (order) => saveCategoryOrderSettings(store, order),
    saveItemRule: (key, patch) => saveRule(store, key, patch),
    saveQuantityCorrection: (input) => saveCorrection(store, input),
    removeQuantityCorrection: async (id) => {
      await store.transaction(async (tx) => {
        removeIfExists(tx, 'shoppingQuantityCorrections', id)
      })
    },
    clearLegacyQuantity: (key) => clearLegacy(store, key),
    resolveAmbiguousRule: (ruleKey, targetKey) =>
      resolveAmbiguous(store, ruleKey, targetKey),
    mergeShoppingProducts: (sourceKey, targetKey) =>
      mergeProducts(store, sourceKey, targetKey),
    splitShoppingProduct: (aliasKey) => splitProduct(store, aliasKey),
    applyShoppingSettings: (patch, today) =>
      applySettings(store, patch, today),
  }
}
