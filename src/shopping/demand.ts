/*
 * openCook Web
 * Copyright (C) 2026 openCook Web contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Read-only demand and distribution loading shared by the multi-list service
 * and the compatibility path of the legacy shopping page. The automatic
 * demand is always derived by `buildShoppingList`; this module never invents a
 * second calculation.
 */

import { db } from '../db'
import {
  buildShoppingList,
  resolveCanonicalKey,
  shoppingItemKey,
  splitIngredientName,
  type ShoppingAmountPosition,
  type ShoppingCategoryId,
  type ShoppingQuantityCorrectionStatus,
} from '../domain/shopping'
import {
  resolveShoppingDistribution,
  shoppingPeriod,
  standardShoppingListId,
  standardShoppingListRecord,
  type ShoppingDistributionResult,
} from '../domain/shoppingLists'
import type { ShoppingList, ShoppingManualItem } from '../types'
import { ShoppingListError } from './errors'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function cleanText(value: string | null | undefined): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim()
}

export interface ShoppingPeriodDemandItem {
  key: string
  name: string
  categoryId: ShoppingCategoryId
  positions: ShoppingAmountPosition[]
  unparsedAmounts: string[]
  missingQuantity: boolean
  quantityCorrections: Array<{
    id: string
    dimension: string
    status: ShoppingQuantityCorrectionStatus
    quantityText: string
    unit: string | null
  }>
  warnings: string[]
}

export interface ShoppingPeriodDemand {
  period: ReturnType<typeof shoppingPeriod>
  standardListId: string
  items: ShoppingPeriodDemandItem[]
  warnings: string[]
  requiresReview: boolean
}

export interface ShoppingDistributionView extends ShoppingDistributionResult {
  lists: ShoppingList[]
  standardList: ShoppingList
  demand: ShoppingPeriodDemand
}

export function manualItemKey(item: Pick<ShoppingManualItem, 'name'>): string {
  return shoppingItemKey(splitIngredientName(item.name).identityName)
}

export async function loadShoppingPeriodDemand(
  anchor: string,
): Promise<ShoppingPeriodDemand> {
  const period = shoppingPeriod(anchor)
  const [recipes, freeDishes, cookSessions, rules, quantityCorrections] = await Promise.all([
    db.recipes.toArray(),
    db.freeDishes.toArray(),
    db.cookSessions.toArray(),
    db.shoppingItemRules.toArray(),
    db.shoppingQuantityCorrections.toArray(),
  ])
  const built = buildShoppingList({
    anchor: period.start,
    weekStartDay: 3,
    recipes,
    freeDishes,
    cookSessions,
    manualItems: [],
    checks: [],
    purchases: [],
    rules,
    quantityCorrections,
  })
  const items = built.items.map<ShoppingPeriodDemandItem>((item) => ({
    key: item.key,
    name: item.name,
    categoryId: item.categoryId,
    positions: item.requiredPositions.map((position) => ({ ...position })),
    unparsedAmounts: [...item.unparsedAmounts],
    missingQuantity: item.missingQuantity,
    quantityCorrections: item.quantityCorrections.map((correction) => ({
      id: correction.id,
      dimension: correction.dimension,
      status: correction.status,
      quantityText: correction.quantityText,
      unit: correction.unit,
    })),
    warnings: [...item.warnings],
  }))
  return {
    period,
    standardListId: standardShoppingListId(period.start),
    items,
    warnings: built.warnings,
    requiresReview: items.some((item) =>
      item.quantityCorrections.some((correction) => correction.status === 'stale'),
    ),
  }
}

export async function loadShoppingDistribution(
  anchor: string,
): Promise<ShoppingDistributionView> {
  const demand = await loadShoppingPeriodDemand(anchor)
  const [allocations, lists] = await Promise.all([
    db.shoppingDemandAllocations.where('periodStart').equals(demand.period.start).toArray(),
    db.shoppingLists.toArray(),
  ])
  const standardList =
    lists.find((list) => list.id === demand.standardListId) ??
    standardShoppingListRecord(demand.period.start, 0)
  const distribution = resolveShoppingDistribution({
    periodStart: demand.period.start,
    standardListId: demand.standardListId,
    demand: demand.items.map((item) => ({
      key: item.key,
      name: item.name,
      positions: item.positions,
      unparsedAmounts: item.unparsedAmounts,
      missingQuantity: item.missingQuantity,
    })),
    allocations,
    listIds: lists
      .filter(
        (list) =>
          list.kind === 'free' || list.periodStart === demand.period.start,
      )
      .map((list) => list.id),
  })
  return {
    ...distribution,
    lists,
    standardList,
    demand,
  }
}

async function ensureStandardListRow(periodStart: string): Promise<string> {
  const id = standardShoppingListId(periodStart)
  const existing = await db.shoppingLists.get(id)
  if (existing) return existing.id
  await db.shoppingLists.put(standardShoppingListRecord(periodStart, Date.now()))
  return id
}

export interface LegacyPurchaseTarget {
  listId: string
  manualItemId?: string
}

/**
 * Resolve the target list for a purchase written by the legacy shopping page.
 *
 * A new legacy write is only accepted when the current distribution names
 * exactly one list for the item. A split across several lists is ambiguous and
 * must be rejected instead of being booked on the standard list. Existing
 * purchases are never re-targeted by this function; it is only used before a
 * new purchase row is written.
 */
export async function resolvePurchaseTargetForLegacyWrite(input: {
  shoppingDate: string
  itemKey: string
}): Promise<LegacyPurchaseTarget> {
  const date = cleanText(input.shoppingDate)
  if (!DATE_RE.test(date)) {
    throw new ShoppingListError('invalid-period', 'Der Einkaufstag ist kein gültiges Datum.')
  }
  let period: ReturnType<typeof shoppingPeriod>
  try {
    period = shoppingPeriod(date)
  } catch {
    throw new ShoppingListError('invalid-period', 'Der Einkaufstag ist kein gültiges Datum.')
  }

  const distribution = await loadShoppingDistribution(period.start)
  const rules = await db.shoppingItemRules.toArray()
  const key = resolveCanonicalKey(cleanText(input.itemKey), rules)
  if (!key) {
    throw new ShoppingListError('purchase-conflict', 'Der Artikel konnte nicht zugeordnet werden.')
  }

  const demandItem = distribution.demand.items.find((item) => item.key === key)
  if (demandItem) {
    const listIds = new Set<string>()
    for (const position of distribution.positions) {
      if (position.itemKey !== key) continue
      for (const amount of position.amounts) {
        if (amount.lower > 0 || amount.upper > 0) listIds.add(amount.listId)
      }
    }
    for (const entry of distribution.unquantified) {
      if (entry.itemKey === key) listIds.add(entry.listId)
    }
    if (listIds.size > 1) {
      throw new ShoppingListError(
        'purchase-conflict',
        'Der Artikel ist auf mehrere Einkaufszettel verteilt; der Kauf ist nicht eindeutig zuzuordnen.',
        { itemKey: key, listIds: Array.from(listIds).sort() },
      )
    }
    const listId = Array.from(listIds)[0] ?? distribution.standardListId
    if (listId.startsWith('standard:')) await ensureStandardListRow(period.start)
    return { listId }
  }

  const manualItems = await db.shoppingManualItems.toArray()
  const matches = manualItems.filter((item) => manualItemKey(item) === key)
  if (matches.length > 1) {
    throw new ShoppingListError(
      'purchase-conflict',
      'Mehrere gleichnamige manuelle Artikel machen den Kauf nicht eindeutig zuordenbar.',
      { itemKey: key, manualItemIds: matches.map((item) => item.id) },
    )
  }
  if (matches.length === 1) {
    const item = matches[0]
    if (!item) throw new ShoppingListError('purchase-conflict', 'Der Artikel fehlt.')
    if (item.legacyWeekAmbiguous) {
      throw new ShoppingListError(
        'purchase-conflict',
        'Der manuelle Artikel hat eine unklare historische Wochenzuordnung.',
        { itemKey: key, manualItemId: item.id },
      )
    }
    if (item.listId) {
      const list = distribution.lists.find((entry) => entry.id === item.listId)
      if (!list) {
        throw new ShoppingListError(
          'purchase-conflict',
          'Der manuelle Artikel gehört zu einer fehlenden Einkaufsliste.',
          { itemKey: key, manualItemId: item.id, listId: item.listId },
        )
      }
      if (list.kind === 'standard' && list.periodStart !== period.start) {
        throw new ShoppingListError(
          'purchase-conflict',
          'Der manuelle Artikel gehört zu einem anderen Einkaufszeitraum.',
          { itemKey: key, manualItemId: item.id, listId: list.id },
        )
      }
      return { listId: list.id, manualItemId: item.id }
    }
    return {
      listId: await ensureStandardListRow(period.start),
      manualItemId: item.id,
    }
  }

  return { listId: await ensureStandardListRow(period.start) }
}

