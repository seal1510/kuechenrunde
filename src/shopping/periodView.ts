/*
 * openCook Web
 * Copyright (C) 2026 openCook Web contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The shopping page always works on one complete Thursday–Wednesday shopping
 * period. This helper is the single place that turns the persisted rows into
 * that view, so the displayed demand, the conflict notice and the dates used
 * for writes cannot drift apart.
 */

import {
  buildShoppingList,
  type ShoppingListResult,
} from '../domain/shopping'
import {
  isDateInShoppingPeriod,
  shoppingPeriod,
  SHOPPING_PERIOD_START_DAY,
  type ShoppingPeriod,
} from '../domain/shoppingLists'
import type {
  CookSession,
  FreeDish,
  Recipe,
  ShoppingItemRule,
  ShoppingManualItem,
  ShoppingPurchase,
  ShoppingQuantityCorrection,
} from '../types'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export interface ShoppingPeriodViewInput {
  periodStart: string
  recipes: readonly Recipe[]
  freeDishes: readonly FreeDish[]
  cookSessions: readonly CookSession[]
  manualItems: readonly ShoppingManualItem[]
  purchases: readonly ShoppingPurchase[]
  rules: readonly ShoppingItemRule[]
  quantityCorrections: readonly ShoppingQuantityCorrection[]
  today?: string
}

export interface ShoppingPeriodView {
  period: ShoppingPeriod
  list: ShoppingListResult
  conflicts: {
    manualItems: ShoppingManualItem[]
    purchases: ShoppingPurchase[]
    total: number
  }
}

function isInPeriod(date: string | null | undefined, periodStart: string): boolean {
  return Boolean(date) && DATE_RE.test(String(date)) && isDateInShoppingPeriod(String(date), periodStart)
}

export function buildShoppingPeriodView(input: ShoppingPeriodViewInput): ShoppingPeriodView {
  const period = shoppingPeriod(input.periodStart)
  const conflictManualItems: ShoppingManualItem[] = []
  const conflictPurchases: ShoppingPurchase[] = []
  const manualItems: ShoppingManualItem[] = []
  for (const item of input.manualItems) {
    const date = item.shoppingDate || item.weekStart
    if (!isInPeriod(date, period.start)) continue
    if (item.legacyWeekAmbiguous) {
      conflictManualItems.push(item)
      continue
    }
    manualItems.push(item)
  }
  const purchases: ShoppingPurchase[] = []
  for (const purchase of input.purchases) {
    if (!isInPeriod(purchase.shoppingDate, period.start)) continue
    if (purchase.legacyWeekAmbiguous) {
      conflictPurchases.push(purchase)
      continue
    }
    purchases.push(purchase)
  }
  const list = buildShoppingList({
    anchor: period.start,
    weekStartDay: SHOPPING_PERIOD_START_DAY,
    recipes: input.recipes,
    freeDishes: input.freeDishes,
    cookSessions: input.cookSessions,
    manualItems,
    purchases,
    rules: input.rules,
    quantityCorrections: input.quantityCorrections,
    today: input.today,
  })
  return {
    period,
    list,
    conflicts: {
      manualItems: conflictManualItems,
      purchases: conflictPurchases,
      total: conflictManualItems.length + conflictPurchases.length,
    },
  }
}
