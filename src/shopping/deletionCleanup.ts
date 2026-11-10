/*
 * openCook Web
 * Copyright (C) 2026 openCook Web contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Shopping cleanup for dishes that are deliberately removed from the plan and
 * for orphaned rows left behind by older deletions.
 *
 * Automatic demand is always derived from the remaining cooking events. When a
 * dish is deleted, purchases and list allocations that belonged only to that
 * dish must disappear with its demand. Rows for ingredients that are still
 * needed by another dish stay untouched, so shared ingredients keep their
 * purchase state and their distribution across shopping lists.
 */

import {
  buildShoppingList,
  resolveCanonicalKey,
} from '../domain/shopping'
import {
  periodContainsDate,
  standardShoppingListId,
  type ShoppingPeriod,
} from '../domain/shoppingLists'
import type {
  CookSession,
  FreeDish,
  Recipe,
  ShoppingDemandAllocation,
  ShoppingItemRule,
  ShoppingPurchase,
  ShoppingQuantityCorrection,
} from '../types'

export interface ShoppingCleanupData {
  period: ShoppingPeriod
  recipes: readonly Recipe[]
  freeDishes: readonly FreeDish[]
  rules: readonly ShoppingItemRule[]
  quantityCorrections: readonly ShoppingQuantityCorrection[]
}

export interface DeletedSessionsShoppingCleanupInput extends ShoppingCleanupData {
  deletedSessions: readonly CookSession[]
  /** All cooking events except `deletedSessions`. */
  remainingSessions: readonly CookSession[]
  purchases: readonly ShoppingPurchase[]
  allocations: readonly ShoppingDemandAllocation[]
}

export interface ShoppingCleanupResult {
  affectedItemKeys: string[]
  removedPurchaseIds: string[]
  removedAllocationIds: string[]
}

interface VisibleDemand {
  keys: Set<string>
  /** Numeric demand dimensions per item. Empty for purely qualitative demand. */
  dimensions: Map<string, Set<string>>
}

function visibleDemand(
  input: ShoppingCleanupData,
  sessions: readonly CookSession[],
): VisibleDemand {
  const result = buildShoppingList({
    anchor: input.period.start,
    periodStart: input.period.start,
    periodEnd: input.period.end,
    recipes: input.recipes,
    freeDishes: input.freeDishes,
    cookSessions: sessions,
    manualItems: [],
    purchases: [],
    rules: input.rules,
    quantityCorrections: input.quantityCorrections,
  })
  const visible = result.items.filter(
    (item) =>
      item.requiredPositions.length > 0 ||
      item.unparsedAmounts.length > 0 ||
      item.missingQuantity,
  )
  return {
    keys: new Set(visible.map((item) => item.key)),
    dimensions: new Map(
      visible.map((item) => [
        item.key,
        new Set(item.requiredPositions.map((position) => position.dimension)),
      ]),
    ),
  }
}

function purchaseBelongsToPeriod(
  purchase: ShoppingPurchase,
  period: ShoppingPeriod,
  standardListId: string,
): boolean {
  if (purchase.listId?.startsWith('standard:')) {
    return purchase.listId === standardListId
  }
  return Boolean(purchase.shoppingDate) && periodContainsDate(period, purchase.shoppingDate)
}

/**
 * A purchase is orphaned only when its item has no demand at all, or when the
 * item still needs a different numeric dimension and none of the purchase's
 * dimensions apply. A purchase is always valid while the item has qualitative
 * demand: a numeric purchase is at least as informative as a qualitative one.
 */
function purchaseIsOrphaned(
  purchase: ShoppingPurchase,
  demand: VisibleDemand,
  itemKey: string,
): boolean {
  if (!demand.keys.has(itemKey)) return true
  if (purchase.amounts.length === 0) return false
  const dimensions = demand.dimensions.get(itemKey)
  if (!dimensions || dimensions.size === 0) return false
  return purchase.amounts.every((amount) => !dimensions.has(amount.dimension))
}

function allocationIsOrphaned(
  allocation: ShoppingDemandAllocation,
  demand: VisibleDemand,
  itemKey: string,
): boolean {
  if (!demand.keys.has(itemKey)) return true
  if (allocation.dimension === '*') {
    // A full-item allocation stays valid as long as the item exists.
    return false
  }
  return !(demand.dimensions.get(itemKey)?.has(allocation.dimension) ?? false)
}

/**
 * Plan the deletions that make the shopping list consistent after one or more
 * cooking events were removed. The function is pure: it only returns ids, the
 * caller applies them in the same transaction as the plan deletion.
 *
 * Deleted events are evaluated with `status: 'planned'` on purpose. Their
 * shopping demand existed exactly when they were planned cooking events.
 */
export function planDeletedSessionsShoppingCleanup(
  input: DeletedSessionsShoppingCleanupInput,
): ShoppingCleanupResult {
  const deletedDemand = visibleDemand(
    input,
    input.deletedSessions.map((session) => ({ ...session, status: 'planned' })),
  )
  if (deletedDemand.keys.size === 0) {
    return { affectedItemKeys: [], removedPurchaseIds: [], removedAllocationIds: [] }
  }

  const remainingDemand = visibleDemand(input, input.remainingSessions)
  const affectedItemKeys = Array.from(deletedDemand.keys).sort()
  const standardListId = standardShoppingListId(input.period.start)

  const removedPurchaseIds: string[] = []
  for (const purchase of input.purchases) {
    // Manual articles own their purchases; deleting a planned dish must never
    // touch them, even when the article name matches a recipe ingredient.
    if (purchase.manualItemId) continue
    if (!purchaseBelongsToPeriod(purchase, input.period, standardListId)) continue
    const itemKey = resolveCanonicalKey(purchase.itemKey, input.rules)
    if (!deletedDemand.keys.has(itemKey)) continue
    if (!purchaseIsOrphaned(purchase, remainingDemand, itemKey)) continue
    removedPurchaseIds.push(purchase.id)
  }

  const removedAllocationIds: string[] = []
  for (const allocation of input.allocations) {
    if (allocation.periodStart !== input.period.start) continue
    const itemKey = resolveCanonicalKey(allocation.itemKey, input.rules)
    if (!deletedDemand.keys.has(itemKey)) continue
    if (!allocationIsOrphaned(allocation, remainingDemand, itemKey)) continue
    removedAllocationIds.push(allocation.id)
  }

  return {
    affectedItemKeys,
    removedPurchaseIds: removedPurchaseIds.sort(),
    removedAllocationIds: removedAllocationIds.sort(),
  }
}
