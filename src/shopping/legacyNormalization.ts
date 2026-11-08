/*
 * openCook Web
 * Copyright (C) 2026 openCook Web contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Shared legacy normalisation for shopping rows. The same rules are used by
 * the Dexie schema migration and by backup inspection/restore, so an old
 * backup cannot bypass the treatment that an old database receives.
 *
 * The current shopping or calendar setting is deliberately never used here.
 * Legacy rows without a persisted standard list predate the multi-list model,
 * when the app grouped purchases into a fixed Thursday–Wednesday period. That
 * historical format constant is only used to interpret old data; it never
 * configures new periods. For standard-list rows without a stored historical
 * week start the original grouping is not reconstructable and therefore
 * remains a review conflict.
 */

import { addDays, weekdayIndex } from '../domain/dates'
import { periodContainsDate } from '../domain/shoppingLists'
import type { ShoppingList, ShoppingManualItem, ShoppingPurchase } from '../types'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/**
 * The period model used before shopping lists were configurable. This is a
 * historical data-format interpretation, not a user-facing setting and never a
 * fallback for new periods.
 */
export const LEGACY_STANDARD_PERIOD_START_DAY = 3

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

function legacyPeriodStartOf(date: string): string | null {
  if (!date || !DATE_RE.test(date)) return null
  // 3 = Thursday; see LEGACY_STANDARD_PERIOD_START_DAY above.
  return addDays(
    date,
    -((weekdayIndex(date) - LEGACY_STANDARD_PERIOD_START_DAY + 7) % 7),
  )
}

function standardListFor(
  lists: Map<string, ShoppingList>,
  listId: string | undefined,
): ShoppingList | undefined {
  if (!listId) return undefined
  return lists.get(listId)
}

function listContains(list: ShoppingList | undefined, date: string): boolean {
  return Boolean(
    list?.kind === 'standard' &&
      list.periodStart &&
      list.periodEnd &&
      periodContainsDate({ start: list.periodStart, end: list.periodEnd }, date),
  )
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
  const list = standardListFor(lists, item.listId)

  // Free lists have no mandatory week. A differing date is never evidence of
  // an ambiguous week, and a previous false positive is cleared.
  if (item.listId) {
    const referenced = lists.get(item.listId)
    if (referenced?.kind === 'free') {
      const next = withFlag(item, false)
      return { item: next, changed: next !== item }
    }
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
  if (!date || !DATE_RE.test(date)) return { item, changed: false }

  const storedWeekStart =
    item.weekStart && DATE_RE.test(item.weekStart) ? item.weekStart : null

  if (list?.kind === 'standard') {
    const unambiguous =
      listContains(list, date) && storedWeekStart === list.periodStart
    const next = withFlag(item, !unambiguous)
    return { item: next, changed: next !== item }
  }

  // No persisted list: interpret only against the historical Thursday format.
  const datePeriod = legacyPeriodStartOf(date)
  if (!datePeriod) return { item, changed: false }
  const unambiguous = storedWeekStart === datePeriod
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

  const list = standardListFor(lists, purchase.listId)
  if (purchase.listId) {
    const referenced = lists.get(purchase.listId)
    if (referenced?.kind === 'free') {
      const next = withFlag(purchase, false)
      return { purchase: next, changed: next !== purchase }
    }
  }

  // An explicitly detected conflict (for example a list/date mismatch during
  // backup inspection) wins over every optimistic provenance marker.
  if (forceAmbiguous) {
    const next = withFlag(purchase, true)
    return { purchase: next, changed: next !== purchase }
  }

  // A row written by the current application carries an explicit provenance.
  // It is a certain purchase and must never be downgraded to "unknown history".
  if (purchase.provenance === 'recorded') {
    const next = withFlag(purchase, false)
    return { purchase: next, changed: next !== purchase }
  }

  if (!legacySource) return { purchase, changed: false }

  // Standard-list purchases from an old source carry no historical week start.
  // The current setting is not proof of the original grouping.
  if (list?.kind === 'standard') {
    const next = withFlag(purchase, true)
    return { purchase: next, changed: next !== purchase }
  }

  const next = withFlag(purchase, true)
  return { purchase: next, changed: next !== purchase }
}

export function normalizeLegacyShoppingRows(
  input: LegacyShoppingNormalizationInput,
): LegacyShoppingNormalizationResult {
  const lists = new Map(input.lists.map((list) => [list.id, list]))
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

/**
 * A persisted standard list for the legacy Thursday period containing [date],
 * used only by data readers that must interpret pre-list rows.
 */
export function legacyStandardPeriodStart(date: string): string | null {
  return legacyPeriodStartOf(date)
}
