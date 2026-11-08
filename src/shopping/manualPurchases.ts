/*
 * openCook Web
 * Copyright (C) 2026 openCook Web contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Resolve whether an existing purchase can be unambiguously linked to one
 * manual article. This is deliberately stricter than matching only a product
 * key: the manual article, the purchase and the list context all have to agree.
 */

import { db } from '../db'
import {
  parseShoppingQuantityPosition,
  resolveCanonicalKey,
} from '../domain/shopping'
import {
  isDateInShoppingPeriod,
  shoppingPeriod,
  standardShoppingListId,
} from '../domain/shoppingLists'
import type { ShoppingList, ShoppingManualItem, ShoppingPurchase } from '../types'
import { loadShoppingPeriodDemand, manualItemKey } from './demand'
import { ShoppingListError } from './errors'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function dateOf(item: ShoppingManualItem): string {
  return item.shoppingDate || item.weekStart || ''
}

function periodOf(date: string): string {
  if (!DATE_RE.test(date)) {
    throw new ShoppingListError('invalid-period', 'Der Einkaufstag des Artikels ist ungültig.')
  }
  try {
    return shoppingPeriod(date).start
  } catch {
    throw new ShoppingListError('invalid-period', 'Der Einkaufstag des Artikels ist ungültig.')
  }
}

function contextFor(
  item: ShoppingManualItem,
  lists: Map<string, ShoppingList>,
): { key: string; listId: string; isFree: boolean } {
  const datePeriod = periodOf(dateOf(item))
  if (item.listId) {
    const list = lists.get(item.listId)
    if (!list) {
      throw new ShoppingListError(
        'list-not-found',
        'Die Einkaufsliste des manuellen Artikels wurde nicht gefunden.',
        { manualItemId: item.id, listId: item.listId },
      )
    }
    if (list.kind === 'free') {
      return { key: `free:${list.id}`, listId: list.id, isFree: true }
    }
    return { key: `standard:${list.periodStart ?? datePeriod}`, listId: list.id, isFree: false }
  }
  const standardId = standardShoppingListId(datePeriod)
  return { key: `standard:${datePeriod}`, listId: standardId, isFree: false }
}

function contextKeyForOther(
  item: ShoppingManualItem,
  lists: Map<string, ShoppingList>,
): string {
  try {
    return contextFor(item, lists).key
  } catch {
    return `invalid:${item.id}`
  }
}

function samePeriod(a: string, b: string): boolean {
  return DATE_RE.test(a) && DATE_RE.test(b) && shoppingPeriod(a).start === b
}

function purchaseIsInContext(
  purchase: ShoppingPurchase,
  context: { listId: string; isFree: boolean },
  periodStart: string,
  lists: Map<string, ShoppingList>,
): boolean {
  if (!DATE_RE.test(purchase.shoppingDate)) return false
  if (purchase.listId) {
    const list = lists.get(purchase.listId)
    if (context.isFree) return list?.kind === 'free' && list.id === context.listId
    if (list?.kind === 'free') return false
    if (list?.kind === 'standard') return list.periodStart === periodStart
    return false
  }
  // Legacy purchases written by the old page have no list. They can only be
  // attributed through the period of their action date.
  return samePeriod(purchase.shoppingDate, periodStart)
}

function purchaseIsCompatible(
  item: ShoppingManualItem,
  purchase: ShoppingPurchase,
): boolean {
  const parsed = parseShoppingQuantityPosition(item.quantityText ?? '', item.unit)
  if (!parsed) {
    return purchase.amounts.length === 0 && purchase.qualitative
  }
  const matching = purchase.amounts.filter((amount) => amount.dimension === parsed.dimension)
  if (matching.length !== 1 || purchase.amounts.length !== 1) return false
  const amount = matching[0]
  return amount !== undefined && (amount.lower > 0 || amount.upper > 0)
}

export interface ManualPurchaseContext {
  item: ShoppingManualItem
  periodStart: string
  listId: string
  isFree: boolean
  sameContextItems: ShoppingManualItem[]
  automaticDemand: boolean
  candidatePurchases: ShoppingPurchase[]
  adoptablePurchase?: ShoppingPurchase
  ambiguous: boolean
}

export async function loadManualPurchaseContext(
  item: ShoppingManualItem,
): Promise<ManualPurchaseContext> {
  const periodStart = periodOf(dateOf(item))
  const [lists, rules, allManualItems, allPurchases, demand] = await Promise.all([
    db.shoppingLists.toArray(),
    db.shoppingItemRules.toArray(),
    db.shoppingManualItems.toArray(),
    db.shoppingPurchases.toArray(),
    loadShoppingPeriodDemand(periodStart),
  ])
  const listById = new Map(lists.map((list) => [list.id, list]))
  const context = contextFor(item, listById)
  const key = manualItemKey(item)
  const sameContextItems = allManualItems.filter(
    (other) =>
      manualItemKey(other) === key &&
      contextKeyForOther(other, listById) === context.key,
  )
  const automaticDemand = demand.items.some((entry) => entry.key === key)
  const candidatePurchases = allPurchases.filter(
    (purchase) =>
      !purchase.manualItemId &&
      resolveCanonicalKey(purchase.itemKey, rules) === key &&
      purchaseIsInContext(purchase, context, periodStart, listById),
  )
  const compatible = candidatePurchases.filter((purchase) =>
    purchaseIsCompatible(item, purchase),
  )
  const ambiguous =
    candidatePurchases.length > 0 &&
    (sameContextItems.length !== 1 ||
      automaticDemand ||
      candidatePurchases.length !== 1 ||
      compatible.length !== 1)
  const adoptablePurchase =
    !ambiguous && candidatePurchases.length === 1 && compatible.length === 1
      ? compatible[0]
      : undefined
  return {
    item,
    periodStart,
    listId: context.listId,
    isFree: context.isFree,
    sameContextItems,
    automaticDemand,
    candidatePurchases,
    adoptablePurchase,
    ambiguous,
  }
}
