/*
 * openCook Web
 * Copyright (C) 2026 openCook Web contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Service layer for multiple shopping lists. Automatic recipe demand is still
 * derived exclusively by `buildShoppingList`; this module persists only user
 * decisions (lists, allocations, manual articles, purchase actions) and
 * resolves the visible per-list state. No React and no UI dialog text.
 */

import { db } from '../db'
import { addDays, todayKey } from '../domain/dates'
import {
  parseShoppingQuantityPosition,
  resolveCanonicalKey,
  SHOPPING_CATEGORIES,
  type ShoppingAmountPosition,
  type ShoppingCategoryId,
} from '../domain/shopping'
import {
  fromAmountMilli,
  openAmount,
  periodContainsDate,
  resolveOpenShoppingAmounts,
  resolveShoppingDistribution,
  resolveShoppingPeriodFromData,
  shoppingAllocationId,
  shoppingPeriodFromList,
  shoppingPeriodFromRange,
  standardShoppingListId,
  standardShoppingListRecord,
  toAmountMilli,
  type ShoppingDistributionConflict,
  type ShoppingDistributionResult,
  type ShoppingOpenPosition,
  type ShoppingPeriod,
  type ShoppingPurchaseContribution,
  type ShoppingUnquantifiedPlacement,
} from '../domain/shoppingLists'
import { getShoppingSettings } from '../settings/shopping'
import { randomId } from '../lib/id'
import { requireDateKey, resolveShoppingPeriod } from './cycle'
import {
  loadShoppingDistribution,
  loadShoppingPeriodDemand,
  manualItemKey,
  type ShoppingDistributionView,
  type ShoppingPeriodDemand,
  type ShoppingPeriodDemandItem,
} from './demand'
import { ShoppingListError } from './errors'
import { loadManualPurchaseContext } from './manualPurchases'
import {
  addManualItem,
  addShoppingPurchaseRecord,
  removeManualItem,
} from './service'
import type {
  ShoppingDemandAllocation,
  ShoppingList,
  ShoppingListKind,
  ShoppingManualItem,
  ShoppingPurchase,
  ShoppingPurchasedAmount,
  ShoppingQuantityCorrection,
  ShoppingItemRule,
} from '../types'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const CATEGORY_SET = new Set<string>(SHOPPING_CATEGORIES.map((category) => category.id))

export { ShoppingListError } from './errors'
export type { ShoppingListErrorCode } from './errors'

function cleanText(value: string | null | undefined): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim()
}

function optionalText(value: string | null | undefined): string | undefined {
  const clean = cleanText(value)
  return clean ? clean : undefined
}

async function requirePeriod(anchor: string): Promise<ShoppingPeriod> {
  const clean = cleanText(anchor)
  if (!DATE_RE.test(clean)) {
    throw new ShoppingListError('invalid-period', 'Der Einkaufszeitraum ist kein gültiges Datum.')
  }
  return resolveShoppingPeriod(clean)
}

function listContainsDate(list: ShoppingList, date: string): boolean {
  return Boolean(
    list.kind === 'standard' &&
      list.periodStart &&
      list.periodEnd &&
      periodContainsDate({ start: list.periodStart, end: list.periodEnd }, date),
  )
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

function categoryOrNull(value: string | null | undefined): ShoppingCategoryId | null {
  const clean = cleanText(value)
  return CATEGORY_SET.has(clean) ? (clean as ShoppingCategoryId) : null
}

function sortLists(lists: readonly ShoppingList[]): ShoppingList[] {
  return lists.slice().sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'standard' ? -1 : 1
    if (a.kind === 'standard') {
      return (b.periodStart ?? '').localeCompare(a.periodStart ?? '')
    }
    return a.createdAt - b.createdAt || a.name.localeCompare(b.name, 'de')
  })
}

/* ------------------------------------------------------------------ */
/* Shopping lists                                                      */
/* ------------------------------------------------------------------ */

export async function listShoppingLists(): Promise<ShoppingList[]> {
  return sortLists(await db.shoppingLists.toArray())
}

/** Read-only lookup; returns `null` when the standard list was never needed. */
export async function getStandardShoppingList(anchor: string): Promise<ShoppingList | null> {
  const period = await requirePeriod(anchor)
  return (await db.shoppingLists.get(standardShoppingListId(period.start))) ?? null
}

/** Lazily create the one standard list for a period. Idempotent. */
export async function ensureStandardShoppingList(anchor: string): Promise<ShoppingList> {
  const [period, settings] = await Promise.all([
    requirePeriod(anchor),
    getShoppingSettings(),
  ])
  const id = standardShoppingListId(period.start)
  return db.transaction('rw', db.shoppingLists, async () => {
    const existing = await db.shoppingLists.get(id)
    if (existing) return existing
    const record = standardShoppingListRecord(period, settings.standardListName, Date.now())
    await db.shoppingLists.put(record)
    return record
  })
}

export interface CreateShoppingListInput {
  name: string
}

export async function createFreeShoppingList(
  input: CreateShoppingListInput | string,
): Promise<ShoppingList> {
  const name = cleanText(typeof input === 'string' ? input : input.name)
  if (!name) {
    throw new ShoppingListError('invalid-list-name', 'Bitte einen Namen für die Einkaufsliste angeben.')
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
  await db.shoppingLists.put(list)
  return list
}

export async function renameShoppingList(id: string, name: string): Promise<ShoppingList> {
  const cleanName = cleanText(name)
  if (!cleanName) {
    throw new ShoppingListError('invalid-list-name', 'Bitte einen Namen für die Einkaufsliste angeben.')
  }
  return db.transaction('rw', db.shoppingLists, async () => {
    const existing = await db.shoppingLists.get(id)
    if (!existing) throw new ShoppingListError('list-not-found', 'Die Einkaufsliste wurde nicht gefunden.')
    if (existing.kind !== 'free') {
      throw new ShoppingListError(
        'standard-list-protected',
        'Der Standard-Einkaufszettel kann nicht wie eine freie Liste umbenannt werden.',
      )
    }
    const next: ShoppingList = { ...existing, name: cleanName, updatedAt: Date.now() }
    await db.shoppingLists.put(next)
    return next
  })
}

export interface DeleteFreeShoppingListOptions {
  /**
   * Deleting a free list may delete its manual articles. This must be an
   * explicit confirmation; without it the service refuses and writes nothing.
   */
  confirmManualItems?: boolean
}

export interface DeleteFreeShoppingListResult {
  removedManualItems: number
  removedManualPurchases: number
  movedAllocations: number
  movedPurchases: number
}

async function ensureStandardRecordInTransaction(
  period: ShoppingPeriod,
  baseName: string,
  now: number,
): Promise<ShoppingList> {
  const id = standardShoppingListId(period.start)
  const existing = await db.shoppingLists.get(id)
  if (existing) return existing
  const record = standardShoppingListRecord(period, baseName, now)
  await db.shoppingLists.put(record)
  return record
}

/**
 * Delete a free list in one transaction.
 *
 * - Automatic allocations move back to the standard list of their stored period.
 * - Purchases stay with the moved item; they are never guessed across items.
 * - Manual articles are only deleted with the explicit confirmation flag.
 * - An allocation or purchase whose period cannot be reconstructed aborts the
 *   whole operation instead of orphaning data.
 */
export async function deleteFreeShoppingList(
  id: string,
  options: DeleteFreeShoppingListOptions = {},
): Promise<DeleteFreeShoppingListResult> {
  const [settings, listsBefore] = await Promise.all([
    getShoppingSettings(),
    db.shoppingLists.toArray(),
  ])
  return db.transaction(
    'rw',
    [
      db.shoppingLists,
      db.shoppingDemandAllocations,
      db.shoppingPurchases,
      db.shoppingManualItems,
    ],
    async () => {
      const list = await db.shoppingLists.get(id)
      if (!list) {
        throw new ShoppingListError('list-not-found', 'Die Einkaufsliste wurde nicht gefunden.')
      }
      if (list.kind !== 'free') {
        throw new ShoppingListError(
          'standard-list-protected',
          'Der Standard-Einkaufszettel kann nicht wie eine freie Liste gelöscht werden.',
        )
      }

      const allocations = await db.shoppingDemandAllocations.where('listId').equals(id).toArray()
      const manualItems = await db.shoppingManualItems.where('listId').equals(id).toArray()
      if (manualItems.length > 0 && options.confirmManualItems !== true) {
        throw new ShoppingListError(
          'confirmation-required',
          'Die Liste enthält manuelle Artikel. Das Löschen muss ausdrücklich bestätigt werden.',
          { manualItems: manualItems.length },
        )
      }
      // Validate everything before the first write so the transaction cannot
      // leave a half-moved list behind.
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
      const allPurchases = await db.shoppingPurchases.toArray()
      const affectedPurchases = allPurchases.filter(
        (purchase) =>
          purchase.listId === id ||
          (purchase.manualItemId !== undefined && manualIds.has(purchase.manualItemId)),
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
        const period = periodForPersistedStart(allocation.periodStart, listsBefore)
        await ensureStandardRecordInTransaction(period, settings.standardListName, now)
        const targetListId = standardShoppingListId(period.start)
        const nextId = shoppingAllocationId(
          period.start,
          allocation.itemKey,
          allocation.dimension,
          targetListId,
        )
        const existing = await db.shoppingDemandAllocations.get(nextId)
        if (existing) {
          const merged: ShoppingDemandAllocation =
            existing.mode === 'full' || allocation.mode === 'full'
              ? {
                  ...existing,
                  mode: 'full',
                  quantityMilli: undefined,
                  createdAt: Math.min(existing.createdAt, allocation.createdAt),
                  updatedAt: now,
                }
              : {
                  ...existing,
                  mode: 'partial',
                  quantityMilli:
                    (existing.quantityMilli ?? 0) + (allocation.quantityMilli ?? 0),
                  createdAt: Math.min(existing.createdAt, allocation.createdAt),
                  updatedAt: now,
                }
          await db.shoppingDemandAllocations.put(merged)
          await db.shoppingDemandAllocations.delete(allocation.id)
        } else {
          await db.shoppingDemandAllocations.delete(allocation.id)
          await db.shoppingDemandAllocations.put({
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
          await db.shoppingPurchases.delete(purchase.id)
          removedManualPurchases += 1
          continue
        }
        const period = resolveShoppingPeriodFromData(
          purchase.shoppingDate,
          settings,
          listsBefore,
        )
        await ensureStandardRecordInTransaction(period, settings.standardListName, now)
        await db.shoppingPurchases.put({
          ...purchase,
          listId: standardShoppingListId(period.start),
          updatedAt: now,
        })
        movedPurchases += 1
      }

      for (const item of manualItems) {
        await db.shoppingManualItems.delete(item.id)
      }
      await db.shoppingLists.delete(id)

      return {
        removedManualItems: manualItems.length,
        removedManualPurchases,
        movedAllocations,
        movedPurchases,
      }
    },
  )
}

/* ------------------------------------------------------------------ */
/* Automatic demand                                                    */
/* ------------------------------------------------------------------ */

/**
 * The complete automatic demand for one persisted shopping period, derived by
 * the existing aggregation exactly once. No purchase or manual article is
 * included here.
 */
export async function getShoppingPeriodDemand(
  anchor: string,
): Promise<ShoppingPeriodDemand> {
  return loadShoppingPeriodDemand(anchor)
}

export async function getShoppingDistribution(
  anchor: string,
): Promise<ShoppingDistributionView> {
  return loadShoppingDistribution(anchor)
}

async function requireTargetList(
  listId: string,
  period: ShoppingPeriod,
): Promise<ShoppingList> {
  const id = cleanText(listId)
  if (!id) {
    throw new ShoppingListError('invalid-target-list', 'Die Ziel-Einkaufsliste fehlt.')
  }
  const list = await db.shoppingLists.get(id)
  if (!list) {
    throw new ShoppingListError('list-not-found', 'Die Ziel-Einkaufsliste wurde nicht gefunden.')
  }
  if (list.kind === 'standard' && list.periodStart !== period.start) {
    throw new ShoppingListError(
      'invalid-target-list',
      'Der Standardzettel gehört zu einem anderen Einkaufszeitraum.',
      { listId: id, listPeriodStart: list.periodStart, periodStart: period.start },
    )
  }
  return list
}

function requireDemandItem(
  demand: ShoppingPeriodDemand,
  itemKey: string,
): ShoppingPeriodDemandItem {
  const key = cleanText(itemKey)
  const item = demand.items.find((entry) => entry.key === key)
  if (!item) {
    throw new ShoppingListError('position-not-found', 'Die Einkaufsposition wurde nicht gefunden.', {
      itemKey: key,
    })
  }
  return item
}

export interface MoveShoppingItemInput {
  periodStart: string
  itemKey: string
  targetListId: string
}

export interface MoveShoppingItemResult {
  mode: 'full' | 'reset'
  targetListId: string
  movedPurchases: number
}

/**
 * Move the complete item (all dimensions, including non-numeric parts) to one
 * list. A later demand increase stays on the target list.
 */
export async function moveShoppingItem(
  input: MoveShoppingItemInput,
): Promise<MoveShoppingItemResult> {
  const period = await requirePeriod(input.periodStart)
  const demand = await getShoppingPeriodDemand(period.start)
  const item = requireDemandItem(demand, input.itemKey)
  const target = await requireTargetList(input.targetListId, demand.period)
  const targetIsStandard = target.id === demand.standardListId
  const now = Date.now()

  return db.transaction(
    'rw',
    [db.shoppingDemandAllocations, db.shoppingPurchases, db.shoppingItemRules],
    async () => {
      const rules = await db.shoppingItemRules.toArray()
      await db.shoppingDemandAllocations
        .where('[periodStart+itemKey]')
        .equals([demand.period.start, item.key])
        .delete()
      if (!targetIsStandard) {
        await db.shoppingDemandAllocations.put({
          id: shoppingAllocationId(demand.period.start, item.key, '*', target.id),
          periodStart: demand.period.start,
          itemKey: item.key,
          dimension: '*',
          listId: target.id,
          mode: 'full',
          createdAt: now,
          updatedAt: now,
        })
      }

      let movedPurchases = 0
      const purchases = await db.shoppingPurchases.toArray()
      for (const purchase of purchases) {
        if (purchase.manualItemId) continue
        if (!DATE_RE.test(purchase.shoppingDate)) continue
        if (!periodContainsDate(demand.period, purchase.shoppingDate)) continue
        if (resolveCanonicalKey(purchase.itemKey, rules) !== item.key) continue
        await db.shoppingPurchases.put({
          ...purchase,
          listId: target.id,
          legacyWeekAmbiguous: undefined,
          updatedAt: now,
        })
        movedPurchases += 1
      }
      return {
        mode: targetIsStandard ? 'reset' : 'full',
        targetListId: target.id,
        movedPurchases,
      }
    },
  )
}

export interface MoveShoppingPositionInput {
  periodStart: string
  itemKey: string
  dimension: string
  targetListId: string
}

export interface MoveShoppingPositionResult {
  mode: 'full' | 'reset'
  targetListId: string
  movedPurchases: number
  /** Purchases that contain several dimensions and therefore stayed untouched. */
  untouchedPurchaseIds: string[]
}

/**
 * Move exactly one numeric dimension of an item. Purchases are moved only when
 * their amounts belong entirely to that dimension; otherwise they stay where
 * they are and are reported instead of being split by guesswork.
 */
export async function moveShoppingPosition(
  input: MoveShoppingPositionInput,
): Promise<MoveShoppingPositionResult> {
  const period = await requirePeriod(input.periodStart)
  const demand = await getShoppingPeriodDemand(period.start)
  const item = requireDemandItem(demand, input.itemKey)
  const dimension = cleanText(input.dimension)
  if (!item.positions.some((position) => position.dimension === dimension)) {
    throw new ShoppingListError('position-not-found', 'Die Einkaufsposition wurde nicht gefunden.', {
      itemKey: item.key,
      dimension,
    })
  }
  const target = await requireTargetList(input.targetListId, demand.period)
  const targetIsStandard = target.id === demand.standardListId
  const now = Date.now()

  return db.transaction(
    'rw',
    [db.shoppingDemandAllocations, db.shoppingPurchases, db.shoppingItemRules],
    async () => {
      const rules = await db.shoppingItemRules.toArray()
      const purchases = await db.shoppingPurchases.toArray()
      const affectedPurchases = purchases.filter((purchase) => {
        if (purchase.manualItemId) return false
        if (!DATE_RE.test(purchase.shoppingDate)) return false
        if (!periodContainsDate(demand.period, purchase.shoppingDate)) return false
        return resolveCanonicalKey(purchase.itemKey, rules) === item.key
      })
      // Validate every affected purchase before the first write. A row with
      // several dimensions cannot be split by guesswork; the whole operation
      // must fail without leaving a half-moved allocation behind.
      for (const purchase of affectedPurchases) {
        const onlyDimension =
          purchase.amounts.length > 0 &&
          purchase.amounts.every((amount) => amount.dimension === dimension)
        if (!onlyDimension) {
          throw new ShoppingListError(
            'purchase-conflict',
            'Ein vorhandener Kauf enthält mehrere Mengendimensionen und kann nicht eindeutig verschoben werden.',
            {
              purchaseId: purchase.id,
              itemKey: item.key,
              dimension,
              dimensions: purchase.amounts.map((amount) => amount.dimension),
            },
          )
        }
      }

      const allocations = await db.shoppingDemandAllocations
        .where('[periodStart+itemKey]')
        .equals([demand.period.start, item.key])
        .toArray()
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
      for (const allocation of allocations) {
        if (allocation.dimension !== dimension) continue
        await db.shoppingDemandAllocations.delete(allocation.id)
      }
      if (!targetIsStandard) {
        await db.shoppingDemandAllocations.put({
          id: shoppingAllocationId(demand.period.start, item.key, dimension, target.id),
          periodStart: demand.period.start,
          itemKey: item.key,
          dimension,
          listId: target.id,
          mode: 'full',
          createdAt: now,
          updatedAt: now,
        })
      }

      for (const purchase of affectedPurchases) {
        await db.shoppingPurchases.put({
          ...purchase,
          listId: target.id,
          legacyWeekAmbiguous: undefined,
          updatedAt: now,
        })
      }
      return {
        mode: targetIsStandard ? 'reset' : 'full',
        targetListId: target.id,
        movedPurchases: affectedPurchases.length,
        untouchedPurchaseIds: [],
      }
    },
  )
}

export interface AssignShoppingSubquantityInput {
  periodStart: string
  itemKey: string
  dimension: string
  targetListId: string
  /** Amount in the dimension's base unit unless `unit` is supplied. */
  quantity: number
  /** Optional unit for the input amount, e.g. "kg" for 1.5 kg. */
  unit?: string | null
}

export interface AssignShoppingSubquantityResult {
  allocation: ShoppingDemandAllocation
  requestedLower: number
  convertedFromFull: boolean
}

/**
 * Assign a fixed subset to one list. The rest stays on the standard list and follows
 * future demand changes. The amount must be exactly representable; ranges and
 * non-numeric lines are rejected instead of approximated.
 */
export async function assignShoppingSubquantity(
  input: AssignShoppingSubquantityInput,
): Promise<AssignShoppingSubquantityResult> {
  const period = await requirePeriod(input.periodStart)
  const demand = await getShoppingPeriodDemand(period.start)
  const item = requireDemandItem(demand, input.itemKey)
  if (item.positions.length === 0 && (item.unparsedAmounts.length > 0 || item.missingQuantity)) {
    throw new ShoppingListError(
      'ambiguous-quantity',
      'Diese Angabe ist nicht eindeutig quantifiziert und kann nicht als Teilmenge aufgeteilt werden.',
      { itemKey: item.key },
    )
  }
  const dimension = cleanText(input.dimension)
  const position = item.positions.find((entry) => entry.dimension === dimension)
  if (!position) {
    throw new ShoppingListError('position-not-found', 'Die Einkaufsposition wurde nicht gefunden.', {
      itemKey: item.key,
      dimension,
    })
  }
  if (position.lower !== position.upper) {
    throw new ShoppingListError(
      'ambiguous-quantity',
      'Ein Mengenbereich kann nicht als feste Teilmenge aufgeteilt werden.',
      { itemKey: item.key, dimension, lower: position.lower, upper: position.upper },
    )
  }
  const target = await requireTargetList(input.targetListId, demand.period)

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
    throw new ShoppingListError('invalid-quantity', 'Die Menge muss größer als null sein.')
  }
  if (requestedMilli > availableMilli) {
    throw new ShoppingListError('over-allocation', 'Die Teilmenge übersteigt den Gesamtbedarf.', {
      requestedMilli,
      availableMilli,
    })
  }

  return db.transaction('rw', db.shoppingDemandAllocations, async () => {
    const allocations = await db.shoppingDemandAllocations
      .where('[periodStart+itemKey]')
      .equals([demand.period.start, item.key])
      .toArray()
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
    const fullRows = sameDimension.filter((allocation) => allocation.mode === 'full')
    for (const allocation of fullRows) {
      await db.shoppingDemandAllocations.delete(allocation.id)
    }
    const otherMilli = sameDimension
      .filter((allocation) => allocation.mode === 'partial' && allocation.listId !== target.id)
      .reduce((sum, allocation) => sum + Math.max(0, allocation.quantityMilli ?? 0), 0)
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
    const existing = await db.shoppingDemandAllocations.get(id)
    const now = Date.now()
    const allocation: ShoppingDemandAllocation = {
      id,
      periodStart: demand.period.start,
      itemKey: item.key,
      dimension,
      listId: target.id,
      mode: 'partial',
      quantityMilli: requestedMilli,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    }
    await db.shoppingDemandAllocations.put(allocation)
    return {
      allocation,
      requestedLower: fromAmountMilli(requestedMilli),
      convertedFromFull: fullRows.length > 0,
    }
  })
}

export async function removeShoppingAllocation(id: string): Promise<void> {
  const existing = await db.shoppingDemandAllocations.get(id)
  if (!existing) {
    throw new ShoppingListError('allocation-not-found', 'Die Zuweisung wurde nicht gefunden.')
  }
  await db.shoppingDemandAllocations.delete(id)
}

export interface ResetShoppingAllocationsInput {
  periodStart: string
  itemKey?: string
  dimension?: string
}

export async function resetShoppingAllocations(
  input: ResetShoppingAllocationsInput,
): Promise<number> {
  const period = await requirePeriod(input.periodStart)
  const itemKey = optionalText(input.itemKey)
  const dimension = optionalText(input.dimension)
  return db.transaction('rw', db.shoppingDemandAllocations, async () => {
    const rows = itemKey
      ? await db.shoppingDemandAllocations
          .where('[periodStart+itemKey]')
          .equals([period.start, itemKey])
          .toArray()
      : await db.shoppingDemandAllocations
          .where('periodStart')
          .equals(period.start)
          .toArray()
    if (dimension && rows.some((allocation) => allocation.dimension === '*')) {
      throw new ShoppingListError(
        'full-allocation-conflict',
        'Die ganze Position ist vollständig verschoben. Ein dimensionsbezogener Reset ist nicht eindeutig.',
        { itemKey, dimension },
      )
    }
    let removed = 0
    for (const allocation of rows) {
      if (dimension && allocation.dimension !== dimension) continue
      await db.shoppingDemandAllocations.delete(allocation.id)
      removed += 1
    }
    return removed
  })
}

/* ------------------------------------------------------------------ */
/* Open demand per list                                                */
/* ------------------------------------------------------------------ */

export type ShoppingListServiceConflictCode =
  | 'purchase-list-mismatch'
  | 'unknown-purchase-list'
  | 'manual-purchase-ambiguous'
  | 'orphaned-manual-list'
  | 'orphaned-manual-purchase'
  | 'unmatched-purchase'
  | 'legacy-week-ambiguous'
  | 'manual-list-period-mismatch'

export interface ShoppingListServiceConflict {
  code: ShoppingListServiceConflictCode
  itemKey?: string
  listId?: string | null
  purchaseId?: string
  manualItemId?: string
}

export interface ShoppingManualOpenItem {
  manualItem: ShoppingManualItem
  listId: string
  position: ShoppingAmountPosition | null
  assignedLower: number
  assignedUpper: number
  purchasedLower: number
  purchasedUpper: number
  openLower: number
  openUpper: number
  done: boolean
  qualitative: boolean
  /** True when a legacy purchase was matched by product identity only. */
  legacyPurchaseFallback: boolean
}

export interface ShoppingListSummary {
  listId: string
  kind: ShoppingListKind
  name: string
  openPositions: number
  donePositions: number
  manualItems: number
  requiresReview: boolean
}

export interface ShoppingOpenDemandResult {
  period: ShoppingPeriod
  standardListId: string
  positions: ShoppingOpenPosition[]
  manualItems: ShoppingManualOpenItem[]
  unquantified: ShoppingUnquantifiedPlacement[]
  /** Only recipe demand; manual unquantified rows stay in `manualItems`. */
  automaticUnquantified: ShoppingUnquantifiedPlacement[]
  lists: ShoppingListSummary[]
  conflicts: ShoppingDistributionConflict[]
  serviceConflicts: ShoppingListServiceConflict[]
  requiresReview: boolean
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

export interface ShoppingOpenDemandSource {
  period: ShoppingPeriod
  standardListId: string
  standardList: ShoppingList
  /** Every persisted list; free lists are always part of the view. */
  lists: readonly ShoppingList[]
  distribution: ShoppingDistributionResult
  purchases: readonly ShoppingPurchase[]
  rules: readonly ShoppingItemRule[]
  manualItems: readonly ShoppingManualItem[]
}

/**
 * Pure core of the per-list view. It applies the already resolved distribution
 * and the persisted purchase/manual rows; it never derives recipe demand on its
 * own. The UI and the async service therefore share exactly one implementation.
 */
export function buildShoppingOpenDemand(
  input: ShoppingOpenDemandSource,
): ShoppingOpenDemandResult {
  const {
    period,
    standardListId: standardId,
    standardList,
    lists,
    distribution,
    purchases: allPurchases,
    rules,
    manualItems: allManualItems,
  } = input
  const listById = new Map(lists.map((list) => [list.id, list]))
  listById.set(standardList.id, standardList)
  const serviceConflicts: ShoppingListServiceConflict[] = []

  // An explicit reference to this standard list with a date outside its stored
  // period is an inconsistency; report it instead of silently hiding the row.
  for (const purchase of allPurchases) {
    if (purchase.manualItemId || !purchase.listId) continue
    const list = listById.get(purchase.listId)
    if (
      list?.kind === 'standard' &&
      list.periodStart === period.start &&
      !periodContainsDate(period, purchase.shoppingDate)
    ) {
      serviceConflicts.push({
        code: 'purchase-list-mismatch',
        itemKey: purchase.itemKey,
        listId: list.id,
        purchaseId: purchase.id,
      })
    }
  }

  const resolvePurchaseList = (purchase: ShoppingPurchase): string | null => {
    if (!purchase.listId) return standardId
    const list = listById.get(purchase.listId)
    if (!list) {
      serviceConflicts.push({
        code: 'unknown-purchase-list',
        itemKey: purchase.itemKey,
        listId: purchase.listId,
        purchaseId: purchase.id,
      })
      return null
    }
    if (list.kind === 'standard' && list.periodStart !== period.start) {
      serviceConflicts.push({
        code: 'purchase-list-mismatch',
        itemKey: purchase.itemKey,
        listId: purchase.listId,
        purchaseId: purchase.id,
      })
      return null
    }
    return list.id
  }

  const automaticContributions: ShoppingPurchaseContribution[] = []
  const manualPurchases = new Map<string, ShoppingPurchase[]>()
  for (const purchase of allPurchases) {
    if (!DATE_RE.test(purchase.shoppingDate)) continue
    if (purchase.manualItemId) {
      // A manual purchase is only valid while its manual article exists. An
      // orphaned reference stays persisted but is never counted as recipe
      // demand and is surfaced as a structured conflict.
      const manual = allManualItems.find((item) => item.id === purchase.manualItemId)
      if (!manual) {
        serviceConflicts.push({
          code: 'orphaned-manual-purchase',
          itemKey: purchase.itemKey,
          listId: purchase.listId ?? null,
          purchaseId: purchase.id,
          manualItemId: purchase.manualItemId,
        })
        continue
      }
      // Manual articles on a free list are independent from a calendar period;
      // their purchases travel with the article, not with a week.
      const list = manualPurchases.get(purchase.manualItemId) ?? []
      list.push(purchase)
      manualPurchases.set(purchase.manualItemId, list)
      continue
    }
    if (!periodContainsDate(period, purchase.shoppingDate)) continue
    const listId = resolvePurchaseList(purchase)
    if (!listId) continue
    const resolvedList = listById.get(listId)
    if (purchase.legacyWeekAmbiguous && resolvedList?.kind !== 'free') {
      serviceConflicts.push({
        code: 'legacy-week-ambiguous',
        itemKey: purchase.itemKey,
        listId: purchase.listId ?? null,
        purchaseId: purchase.id,
      })
      continue
    }
    const itemKey = resolveCanonicalKey(purchase.itemKey, rules)
    if (purchase.amounts.length === 0) {
      automaticContributions.push({
        id: purchase.id,
        listId,
        itemKey,
        dimension: null,
        lower: 0,
        upper: 0,
        qualitative: purchase.qualitative,
      })
      continue
    }
    for (const amount of purchase.amounts) {
      automaticContributions.push({
        id: purchase.id,
        listId,
        itemKey,
        dimension: amount.dimension,
        lower: Math.max(0, amount.lower),
        upper: Math.max(0, amount.upper),
        qualitative: purchase.qualitative,
      })
    }
  }

  const openResult = resolveOpenShoppingAmounts(distribution, automaticContributions)
  for (const unmatched of openResult.unmatchedPurchases) {
    serviceConflicts.push({
      code: 'unmatched-purchase',
      itemKey: unmatched.itemKey,
      listId: unmatched.listId,
      purchaseId: unmatched.purchaseId,
    })
  }

  const automaticKeys = new Set([
    ...distribution.positions.map((position) => position.itemKey),
    ...distribution.unquantified.map((entry) => entry.itemKey),
  ])
  const manualItems: ShoppingManualOpenItem[] = []
  const manualUnquantified: ShoppingUnquantifiedPlacement[] = []
  for (const item of allManualItems) {
    const date = item.shoppingDate || item.weekStart || ''
    if (!date || !DATE_RE.test(date)) continue
    let listId = standardId
    let listIsFree = false
    if (item.listId) {
      const list = listById.get(item.listId)
      if (!list) {
        serviceConflicts.push({
          code: 'orphaned-manual-list',
          manualItemId: item.id,
          listId: item.listId,
        })
        continue
      }
      listId = list.id
      listIsFree = list.kind === 'free'
    }
    if (!listIsFree && !periodContainsDate(period, date)) continue
    // Free lists are period independent. A week conflict only applies when the
    // article actually belongs to a standard shopping period.
    if (item.legacyWeekAmbiguous && !listIsFree) {
      serviceConflicts.push({
        code: 'legacy-week-ambiguous',
        listId: item.listId ?? null,
        manualItemId: item.id,
      })
      continue
    }
    if (listIsFree === false && item.listId) {
      const list = listById.get(item.listId)
      if (
        list?.kind === 'standard' &&
        !(
          list.periodStart &&
          list.periodEnd &&
          periodContainsDate({ start: list.periodStart, end: list.periodEnd }, date)
        )
      ) {
        serviceConflicts.push({
          code: 'manual-list-period-mismatch',
          listId: list.id,
          manualItemId: item.id,
        })
        continue
      }
    }

    const parsed = parseShoppingQuantityPosition(item.quantityText ?? '', item.unit)
    const explicitPurchases = (manualPurchases.get(item.id) ?? []).filter(
      (purchase) => resolvePurchaseList(purchase) === listId,
    )
    let effectivePurchases = explicitPurchases
    let legacyPurchaseFallback = false
    if (explicitPurchases.length === 0) {
      const key = manualItemKey(item)
      const sameKeyManualItems = allManualItems.filter(
        (other) => manualItemKey(other) === key,
      )
      const identityPurchase = allPurchases.some(
        (purchase) =>
          !purchase.manualItemId &&
          !purchase.listId &&
          DATE_RE.test(purchase.shoppingDate) &&
          periodContainsDate(period, purchase.shoppingDate) &&
          resolveCanonicalKey(purchase.itemKey, rules) === key,
      )
      if (!automaticKeys.has(key) && sameKeyManualItems.length === 1) {
        // The old ShoppingPage only knows weekly identity purchases. Keep those
        // statuses visible for the one unambiguous manual article, without
        // ever merging them into automatic recipe demand.
        const fallback = allPurchases.filter(
          (purchase) =>
            !purchase.manualItemId &&
            !purchase.listId &&
            DATE_RE.test(purchase.shoppingDate) &&
            periodContainsDate(period, purchase.shoppingDate) &&
            resolveCanonicalKey(purchase.itemKey, rules) === key,
        )
        if (fallback.length > 0) {
          effectivePurchases = fallback
          legacyPurchaseFallback = true
        }
      } else if (automaticKeys.has(key) && identityPurchase) {
        serviceConflicts.push({
          code: 'manual-purchase-ambiguous',
          itemKey: key,
          listId,
          manualItemId: item.id,
        })
      }
    }

    if (parsed) {
      const purchased = sumPurchased(effectivePurchases, parsed.dimension)
      const assigned = { lower: parsed.lower, upper: parsed.upper }
      const open = openAmount(assigned, purchased)
      manualItems.push({
        manualItem: item,
        listId,
        position: parsed,
        assignedLower: assigned.lower,
        assignedUpper: assigned.upper,
        purchasedLower: purchased.lower,
        purchasedUpper: purchased.upper,
        openLower: open.lower,
        openUpper: open.upper,
        done: open.lower === 0 && open.upper === 0 && effectivePurchases.length > 0,
        qualitative: false,
        legacyPurchaseFallback,
      })
    } else {
      const done =
        effectivePurchases.length > 0 &&
        effectivePurchases.some((purchase) => purchase.qualitative)
      manualItems.push({
        manualItem: item,
        listId,
        position: null,
        assignedLower: 0,
        assignedUpper: 0,
        purchasedLower: 0,
        purchasedUpper: 0,
        openLower: 0,
        openUpper: 0,
        done,
        qualitative: true,
        legacyPurchaseFallback,
      })
      manualUnquantified.push({
        itemKey: manualItemKey(item),
        name: item.name,
        listId,
        standard: listId === standardId,
        explicit: item.listId !== undefined,
        unparsedAmounts: item.quantityText ? [item.quantityText] : [],
        missingQuantity: !item.quantityText,
      })
    }
  }

  const reviewListIds = new Set<string>()
  for (const conflict of distribution.conflicts) {
    if (conflict.listId) reviewListIds.add(conflict.listId)
  }
  for (const conflict of serviceConflicts) {
    if (conflict.listId) reviewListIds.add(conflict.listId)
  }

  const summaries = new Map<string, ShoppingListSummary>()
  for (const list of [standardList, ...lists]) {
    if (summaries.has(list.id)) continue
    summaries.set(list.id, {
      listId: list.id,
      kind: list.kind,
      name: list.name,
      openPositions: 0,
      donePositions: 0,
      manualItems: 0,
      requiresReview: reviewListIds.has(list.id),
    })
  }
  for (const position of openResult.positions) {
    const summary = summaries.get(position.listId)
    if (!summary) continue
    if (position.openLower > 0 || position.openUpper > 0) summary.openPositions += 1
    else summary.donePositions += 1
  }
  for (const item of manualItems) {
    const summary = summaries.get(item.listId)
    if (!summary) continue
    summary.manualItems += 1
    if (item.done) summary.donePositions += 1
    else summary.openPositions += 1
  }

  return {
    period,
    standardListId: standardId,
    positions: openResult.positions,
    manualItems,
    unquantified: [...distribution.unquantified, ...manualUnquantified],
    automaticUnquantified: [...distribution.unquantified],
    lists: Array.from(summaries.values()),
    conflicts: distribution.conflicts,
    serviceConflicts,
    requiresReview:
      distribution.requiresReview || serviceConflicts.length > 0,
  }
}

/**
 * Complete per-list view: distribution, purchases, manual articles and the
 * current open amounts. Read-only. All rule logic lives in the pure function
 * above so the UI can build the same view from its own live query.
 */
export async function getOpenDemandByList(
  anchor: string,
): Promise<ShoppingOpenDemandResult> {
  const distribution = await getShoppingDistribution(anchor)
  const [allPurchases, rules, allManualItems] = await Promise.all([
    db.shoppingPurchases.toArray(),
    db.shoppingItemRules.toArray(),
    db.shoppingManualItems.toArray(),
  ])
  return buildShoppingOpenDemand({
    period: distribution.period,
    standardListId: distribution.standardListId,
    standardList: distribution.standardList,
    lists: distribution.lists,
    distribution,
    purchases: allPurchases,
    rules,
    manualItems: allManualItems,
  })
}

/* ------------------------------------------------------------------ */
/* Manual articles                                                     */
/* ------------------------------------------------------------------ */

export interface CreateManualListItemInput {
  listId: string
  name: string
  quantityText?: string | null
  unit?: string | null
  purchaseNote?: string | null
  categoryId?: string | null
  shoppingDate?: string
}

export async function createManualListItem(
  input: CreateManualListItemInput,
): Promise<ShoppingManualItem> {
  const name = cleanText(input.name)
  if (!name) {
    throw new ShoppingListError('invalid-list-name', 'Bitte einen Artikelnamen angeben.')
  }
  const list = await db.shoppingLists.get(cleanText(input.listId))
  if (!list) {
    throw new ShoppingListError('list-not-found', 'Die Einkaufsliste wurde nicht gefunden.')
  }
  const shoppingDate = input.shoppingDate
    ? cleanText(input.shoppingDate)
    : (list.periodStart ?? todayKey())
  requireDateKey(shoppingDate, 'Der Einkaufstag')
  if (list.kind === 'standard' && !listContainsDate(list, shoppingDate)) {
    throw new ShoppingListError(
      'list-period-mismatch',
      'Der Einkaufstag gehört nicht zum Zeitraum des Standardzettels.',
      { listId: list.id, periodStart: list.periodStart, shoppingDate },
    )
  }
  return addManualItem({
    listId: list.id,
    shoppingDate,
    name,
    quantityText: input.quantityText,
    unit: input.unit,
    purchaseNote: input.purchaseNote,
    categoryId: input.categoryId,
  })
}

export type UpdateManualListItemPatch = {
  name?: string
  quantityText?: string | null
  unit?: string | null
  purchaseNote?: string | null
  categoryId?: string | null
  shoppingDate?: string
  listId?: string
}

export async function updateManualListItem(
  id: string,
  patch: UpdateManualListItemPatch,
): Promise<ShoppingManualItem> {
  return db.transaction(
    'rw',
    [db.shoppingLists, db.shoppingManualItems, db.shoppingPurchases],
    async () => {
      const existing = await db.shoppingManualItems.get(id)
      if (!existing) {
        throw new ShoppingListError('list-not-found', 'Der manuelle Artikel wurde nicht gefunden.')
      }
      const target =
        patch.listId === undefined
          ? existing.listId
            ? await db.shoppingLists.get(existing.listId)
            : undefined
          : await db.shoppingLists.get(cleanText(patch.listId))
      if (patch.listId !== undefined && !target) {
        throw new ShoppingListError('list-not-found', 'Die Ziel-Einkaufsliste wurde nicht gefunden.')
      }
      if (existing.listId && !target && patch.listId === undefined) {
        throw new ShoppingListError(
          'list-not-found',
          'Die bisherige Einkaufsliste des Artikels wurde nicht gefunden.',
        )
      }

      let shoppingDate =
        patch.shoppingDate === undefined
          ? (existing.shoppingDate || existing.weekStart || target?.periodStart || todayKey())
          : cleanText(patch.shoppingDate)
      requireDateKey(shoppingDate, 'Der Einkaufstag')
      if (target?.kind === 'standard' && !listContainsDate(target, shoppingDate)) {
        // Moving to a standard list of another period implies moving the
        // article into that period. This is only allowed atomically; an
        // explicitly supplied conflicting date is rejected.
        if (patch.listId !== undefined && patch.shoppingDate === undefined) {
          shoppingDate = target.periodStart ?? shoppingDate
        } else {
          throw new ShoppingListError(
            'list-period-mismatch',
            'Der Einkaufstag gehört nicht zum Zeitraum des Standardzettels.',
            { listId: target.id, periodStart: target.periodStart, shoppingDate },
          )
        }
      }

      const name = patch.name === undefined ? existing.name : cleanText(patch.name)
      if (!name) throw new ShoppingListError('invalid-list-name', 'Bitte einen Artikelnamen angeben.')
      const previousDate = existing.shoppingDate || existing.weekStart || ''
      const dateChanged = shoppingDate !== previousDate
      const listChanged = target?.id !== existing.listId
      const next: ShoppingManualItem = {
        ...existing,
        shoppingDate,
        weekStart: dateChanged ? shoppingDate : (existing.weekStart ?? shoppingDate),
        listId: target?.id,
        legacyWeekAmbiguous:
          dateChanged || listChanged ? undefined : existing.legacyWeekAmbiguous,
        name,
        quantityText:
          patch.quantityText === undefined
            ? existing.quantityText
            : optionalText(patch.quantityText) ?? null,
        unit: patch.unit === undefined ? existing.unit : optionalText(patch.unit) ?? null,
        purchaseNote:
          patch.purchaseNote === undefined
            ? existing.purchaseNote
            : cleanText(patch.purchaseNote),
        categoryId:
          patch.categoryId === undefined
            ? existing.categoryId
            : categoryOrNull(patch.categoryId),
        updatedAt: Date.now(),
      }
      await db.shoppingManualItems.put(next)
      const linked = await db.shoppingPurchases.where('manualItemId').equals(id).toArray()
      for (const purchase of linked) {
        await db.shoppingPurchases.put({
          ...purchase,
          listId: target?.id ?? purchase.listId,
          shoppingDate: dateChanged ? shoppingDate : purchase.shoppingDate,
          legacyWeekAmbiguous:
            dateChanged || listChanged ? undefined : purchase.legacyWeekAmbiguous,
          updatedAt: next.updatedAt,
        })
      }
      return next
    },
  )
}

/** Move a manual article and its explicitly linked purchases together. */
export async function moveManualItem(
  id: string,
  targetListId: string,
): Promise<ShoppingManualItem> {
  return db.transaction(
    'rw',
    [db.shoppingLists, db.shoppingManualItems, db.shoppingPurchases],
    async () => {
      const existing = await db.shoppingManualItems.get(id)
      if (!existing) {
        throw new ShoppingListError('list-not-found', 'Der manuelle Artikel wurde nicht gefunden.')
      }
      const target = await db.shoppingLists.get(cleanText(targetListId))
      if (!target) {
        throw new ShoppingListError('list-not-found', 'Die Ziel-Einkaufsliste wurde nicht gefunden.')
      }
      const currentDate = existing.shoppingDate || existing.weekStart || todayKey()
      let shoppingDate = currentDate
      if (target.kind === 'standard' && !listContainsDate(target, currentDate)) {
        shoppingDate = target.periodStart ?? currentDate
      }
      const now = Date.now()
      const next: ShoppingManualItem = {
        ...existing,
        shoppingDate,
        weekStart: shoppingDate,
        listId: target.id,
        legacyWeekAmbiguous: undefined,
        updatedAt: now,
      }
      await db.shoppingManualItems.put(next)
      const linked = await db.shoppingPurchases.where('manualItemId').equals(id).toArray()
      for (const purchase of linked) {
        await db.shoppingPurchases.put({
          ...purchase,
          listId: target.id,
          shoppingDate,
          legacyWeekAmbiguous: undefined,
          updatedAt: now,
        })
      }
      return next
    },
  )
}

export async function removeManualListItem(id: string): Promise<void> {
  const existing = await db.shoppingManualItems.get(id)
  if (!existing) {
    throw new ShoppingListError('list-not-found', 'Der manuelle Artikel wurde nicht gefunden.')
  }
  await removeManualItem(id)
}

/**
 * Mark one manual article as bought/open. The purchase is explicitly linked to
 * the article and its list; toggling it open removes only those linked rows.
 */
export async function setManualItemPurchased(
  id: string,
  purchased: boolean,
): Promise<{ item: ShoppingManualItem; purchases: ShoppingPurchase[] }> {
  const initial = await db.shoppingManualItems.get(id)
  if (!initial) {
    throw new ShoppingListError('list-not-found', 'Der manuelle Artikel wurde nicht gefunden.')
  }
  const context = await loadManualPurchaseContext(initial)
  if (context.ambiguous) {
    throw new ShoppingListError(
      'purchase-conflict',
      'Vorhandene Käufe sind nicht eindeutig diesem manuellen Artikel zuzuordnen.',
      {
        manualItemId: id,
        itemKey: manualItemKey(initial),
        purchaseIds: context.candidatePurchases.map((purchase) => purchase.id),
      },
    )
  }
  const adoptable = context.adoptablePurchase
  const settings = await getShoppingSettings()

  return db.transaction(
    'rw',
    [db.shoppingLists, db.shoppingManualItems, db.shoppingPurchases],
    async () => {
      const item = await db.shoppingManualItems.get(id)
      if (!item) {
        throw new ShoppingListError('list-not-found', 'Der manuelle Artikel wurde nicht gefunden.')
      }
      const purchaseDate = item.shoppingDate || item.weekStart || todayKey()
      const listId = context.listId
      if (listId.startsWith('standard:')) {
        const existingList = await db.shoppingLists.get(listId)
        if (!existingList) {
          const periodStart = listId.slice('standard:'.length)
          await db.shoppingLists.put(
            standardShoppingListRecord(
              shoppingPeriodFromRange(periodStart, addDays(periodStart, 6)),
              settings.standardListName,
              Date.now(),
            ),
          )
        }
      }
      if (purchased) {
        const existing = await db.shoppingPurchases.where('manualItemId').equals(id).toArray()
        if (existing.length > 0) {
          return { item, purchases: existing }
        }
        if (adoptable) {
          const candidate = await db.shoppingPurchases.get(adoptable.id)
          if (candidate && candidate.manualItemId && candidate.manualItemId !== id) {
            throw new ShoppingListError(
              'purchase-conflict',
              'Der Altkauf wurde inzwischen einem anderen manuellen Artikel zugeordnet.',
              { manualItemId: id, purchaseId: candidate.id },
            )
          }
          if (candidate && !candidate.manualItemId) {
            const adopted: ShoppingPurchase = {
              ...candidate,
              listId,
              manualItemId: item.id,
              legacyWeekAmbiguous: undefined,
              updatedAt: Date.now(),
            }
            await db.shoppingPurchases.put(adopted)
            return { item, purchases: [adopted] }
          }
        }
        const parsed = parseShoppingQuantityPosition(item.quantityText ?? '', item.unit)
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
        const purchase = await addShoppingPurchaseRecord({
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
      const linked = await db.shoppingPurchases.where('manualItemId').equals(id).toArray()
      const ids = new Set(linked.map((purchase) => purchase.id))
      if (adoptable) {
        const candidate = await db.shoppingPurchases.get(adoptable.id)
        if (candidate && !candidate.manualItemId) ids.add(candidate.id)
      }
      if (ids.size > 0) {
        await db.shoppingPurchases.bulkDelete(Array.from(ids))
      }
      return { item, purchases: [] }
    },
  )
}

/* ------------------------------------------------------------------ */
/* Helpers reused by tests and later UI work                            */
/* ------------------------------------------------------------------ */

export function allocationRemaining(
  position: { lower: number; upper: number },
  purchased: { lower: number; upper: number },
): { lower: number; upper: number } {
  return openAmount(position, purchased)
}

export function canonicalPurchaseItemKey(
  itemKey: string,
  rules: readonly ShoppingItemRule[],
): string {
  return resolveCanonicalKey(itemKey, rules)
}

export type { ShoppingQuantityCorrection }
