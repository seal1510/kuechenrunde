/*
 * openCook Web
 * Copyright (C) 2026 openCook Web contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Shared legacy normalisation for shopping rows. The same rules are used by
 * the Dexie schema migration and by backup inspection/restore, so an old
 * backup cannot bypass the treatment that an old database receives.
 *
 * The current calendar setting is deliberately never used here. For standard
 * list purchases without a stored historical week start the historical
 * grouping is not reconstructable and therefore remains a review conflict.
 */

import { shoppingPeriod } from '../domain/shoppingLists'
import type { ShoppingList, ShoppingManualItem, ShoppingPurchase } from '../types'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export interface LegacyShoppingNormalizationInput {
  manualItems: readonly ShoppingManualItem[]
  purchases: readonly ShoppingPurchase[]
  lists: readonly ShoppingList[]
  /**
   * True for data written before the v17 format: missing flags are treated as
   * unknown history. False trusts the persisted flags (current backups) but
   * still clears conflicts that are impossible on free lists.
   */
  legacySource: boolean
  forceAmbiguousManualItemIds?: ReadonlySet<string>
  forceAmbiguousPurchaseIds?: ReadonlySet<string>
}

export interface LegacyShoppingNormalizationResult {
  manualItems: ShoppingManualItem[]
  purchases: ShoppingPurchase[]
  changedManualItems: number
  changedPurchases: number
}

function periodStartOf(date: string | null | undefined): string | null {
  if (!date || !DATE_RE.test(date)) return null
  try {
    return shoppingPeriod(date).start
  } catch {
    return null
  }
}

function listMap(lists: readonly ShoppingList[]): Map<string, ShoppingList> {
  return new Map(lists.map((list) => [list.id, list]))
}

function withFlag<T extends { legacyWeekAmbiguous?: boolean }>(
  row: T,
  ambiguous: boolean,
): T {
  if (ambiguous) {
    return row.legacyWeekAmbiguous === true ? row : { ...row, legacyWeekAmbiguous: true }
  }
  if (row.legacyWeekAmbiguous === undefined) return row
  return { ...row, legacyWeekAmbiguous: undefined }
}

function normalizeManualItem(
  item: ShoppingManualItem,
  lists: Map<string, ShoppingList>,
  legacySource: boolean,
  forceAmbiguous: boolean,
): { item: ShoppingManualItem; changed: boolean } {
  const list = item.listId ? lists.get(item.listId) : undefined

  // Free lists have no mandatory week. A differing date is never evidence of
  // an ambiguous week, and a previous false positive is cleared.
  if (list?.kind === 'free') {
    const next = withFlag(item, false)
    return { item: next, changed: next !== item }
  }

  if (forceAmbiguous) {
    const next = withFlag(item, true)
    return { item: next, changed: next !== item }
  }

  if (!legacySource) return { item, changed: false }

  // An explicit reference to a list that does not exist is not trustworthy.
  if (item.listId && !list) {
    const next = withFlag(item, true)
    return { item: next, changed: next !== item }
  }

  const date = item.shoppingDate || item.weekStart
  const datePeriod = periodStartOf(date)
  if (!datePeriod) return { item, changed: false }

  if (list?.kind === 'standard' && list.periodStart !== datePeriod) {
    const next = withFlag(item, true)
    return { item: next, changed: next !== item }
  }

  // A stored weekStart is the only positive historical evidence we have.
  const knownWeekStart = item.weekStart && DATE_RE.test(item.weekStart)
    ? item.weekStart
    : null
  const unambiguous = knownWeekStart === datePeriod
  const next = withFlag(item, !unambiguous)
  return { item: next, changed: next !== item }
}

function normalizePurchase(
  purchase: ShoppingPurchase,
  lists: Map<string, ShoppingList>,
  legacySource: boolean,
  forceAmbiguous: boolean,
): { purchase: ShoppingPurchase; changed: boolean } {
  // An explicit link to a manual article explains the week, regardless of the
  // calendar setting. The manual article itself is checked separately.
  if (purchase.manualItemId) {
    const next = withFlag(purchase, false)
    return { purchase: next, changed: next !== purchase }
  }

  const list = purchase.listId ? lists.get(purchase.listId) : undefined
  if (list?.kind === 'free') {
    const next = withFlag(purchase, false)
    return { purchase: next, changed: next !== purchase }
  }

  if (forceAmbiguous) {
    const next = withFlag(purchase, true)
    return { purchase: next, changed: next !== purchase }
  }

  if (!legacySource) return { purchase, changed: false }

  // Standard-list purchases from an old source carry no historical week start.
  // The current weekStartDay setting is not proof of the original grouping.
  const next = withFlag(purchase, true)
  return { purchase: next, changed: next !== purchase }
}

export function normalizeLegacyShoppingRows(
  input: LegacyShoppingNormalizationInput,
): LegacyShoppingNormalizationResult {
  const lists = listMap(input.lists)
  let changedManualItems = 0
  let changedPurchases = 0

  const manualItems = input.manualItems.map((item) => {
    const normalized = normalizeManualItem(
      item,
      lists,
      input.legacySource,
      input.forceAmbiguousManualItemIds?.has(item.id) === true,
    )
    if (normalized.changed) changedManualItems += 1
    return normalized.item
  })
  const purchases = input.purchases.map((purchase) => {
    const normalized = normalizePurchase(
      purchase,
      lists,
      input.legacySource,
      input.forceAmbiguousPurchaseIds?.has(purchase.id) === true,
    )
    if (normalized.changed) changedPurchases += 1
    return normalized.purchase
  })

  return {
    manualItems,
    purchases,
    changedManualItems,
    changedPurchases,
  }
}
