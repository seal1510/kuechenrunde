/*
 * openCook Web
 * Copyright (C) 2026 openCook Web contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Shopping-period resolution and the plain shopping settings. The shopping
 * weekday is a normal setting: it is stored directly and read on demand. There
 * is no planned future rhythm, no effective date and no transition period.
 * Existing standard lists keep their persisted boundaries and shopping data is
 * never re-dated by a settings change.
 */

import { db } from '../db'
import { addDays, todayKey } from '../domain/dates'
import {
  periodContainsDate,
  resolveShoppingPeriodResolution,
  shoppingPeriodFromRange,
  standardShoppingListName,
  type ShoppingPeriod,
} from '../domain/shoppingLists'
import {
  getShoppingSettings,
  normalizeShoppingSettings,
  SHOPPING_PERIOD_START_DAY_KEY,
  STANDARD_SHOPPING_LIST_NAME_KEY,
  type ShoppingSettings,
} from '../settings/shopping'
import type {
  ShoppingCheck,
  ShoppingDemandAllocation,
  ShoppingList,
  ShoppingManualItem,
  ShoppingPurchase,
} from '../types'
import { ShoppingListError } from './errors'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export function requireDateKey(value: string, label = 'Der Einkaufstag'): string {
  if (!DATE_RE.test(value)) {
    throw new ShoppingListError('invalid-period', `${label} ist kein gültiges Datum.`)
  }
  return value
}

interface ShoppingData {
  manualItems: readonly ShoppingManualItem[]
  purchases: readonly ShoppingPurchase[]
  allocations: readonly ShoppingDemandAllocation[]
  checks: readonly ShoppingCheck[]
}

async function loadShoppingData(): Promise<ShoppingData> {
  const [manualItems, purchases, allocations, checks] = await Promise.all([
    db.shoppingManualItems.toArray(),
    db.shoppingPurchases.toArray(),
    db.shoppingDemandAllocations.toArray(),
    db.shoppingChecks.toArray(),
  ])
  return { manualItems, purchases, allocations, checks }
}

/**
 * Resolve the period that contains [anchor]. Persisted standard lists win over
 * the current configuration, so a changed shopping weekday can never re-date
 * an existing period. An ambiguous date is reported instead of being guessed.
 */
export async function resolveShoppingPeriod(anchor: string): Promise<ShoppingPeriod> {
  const date = requireDateKey(anchor)
  const [settings, lists] = await Promise.all([
    getShoppingSettings(),
    db.shoppingLists.toArray(),
  ])
  const resolution = resolveShoppingPeriodResolution(date, settings, lists)
  if (resolution.conflict) {
    throw new ShoppingListError(
      'overlapping-periods',
      `Für ${date} sind mehrere Standard-Einkaufsperioden zugeordnet. Bitte die betroffenen Einkaufszettel prüfen.`,
      {
        date,
        listIds: resolution.conflict.listIds,
      },
    )
  }
  return resolution.period
}

export function currentPeriodForToday(
  settings: ShoppingSettings,
  lists: readonly ShoppingList[],
  today = todayKey(),
): ShoppingPeriod {
  const resolution = resolveShoppingPeriodResolution(today, settings, lists)
  if (resolution.conflict) {
    throw new ShoppingListError(
      'overlapping-periods',
      `Für ${today} sind mehrere Standard-Einkaufsperioden zugeordnet.`,
      { date: today, listIds: resolution.conflict.listIds },
    )
  }
  return resolution.period
}

/**
 * First day of the adjacent period. It steps one day past the current
 * boundary, so trimmed periods between persisted lists remain reachable.
 */
export function adjacentShoppingPeriodStart(
  anchor: string,
  direction: -1 | 1,
  settings: ShoppingSettings,
  lists: readonly ShoppingList[],
): string {
  const current = currentPeriodForToday(settings, lists, anchor || todayKey())
  const adjacentDate = addDays(direction > 0 ? current.end : current.start, direction)
  return currentPeriodForToday(settings, lists, adjacentDate).start
}

/**
 * The dates a new automatic meal plan should cover. It uses the configured
 * shopping/planning period and never a hidden Monday default.
 */
export function planningDatesForToday(
  today: string,
  settings: ShoppingSettings,
  lists: readonly ShoppingList[],
): string[] {
  const period = currentPeriodForToday(settings, lists, today)
  return period.days.filter((day) => day >= today)
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

/**
 * True when a standard list already carries persisted shopping data or user
 * decisions. Such a list must survive a weekday change; an auto-generated list
 * without data may be removed so it cannot block the new setting.
 */
function listHasShoppingData(list: ShoppingList, data: ShoppingData): boolean {
  if (list.kind !== 'standard' || !list.periodStart || !list.periodEnd) return false
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
        allocation.listId === list.id || allocation.periodStart === list.periodStart,
    ) ||
    data.checks.some((check) => dateInList(list, check.shoppingDate || check.weekStart))
  )
}

/**
 * Persist the shopping weekday and standard-list name. The change is immediate
 * and applies only to dates that no persisted standard list already covers.
 *
 * Empty auto-generated standard lists are removed so they cannot block the new
 * weekday. Lists with purchases, manual articles, allocations or checks keep
 * their exact boundaries and names follow the persisted period, never the new
 * setting. No data is re-dated or deleted.
 */
export async function applyShoppingSettings(
  patch: Partial<ShoppingSettings>,
  today = todayKey(),
): Promise<ShoppingSettings> {
  return db.transaction(
    'rw',
    [
      db.settings,
      db.shoppingLists,
      db.shoppingManualItems,
      db.shoppingPurchases,
      db.shoppingDemandAllocations,
      db.shoppingChecks,
    ],
    async () => {
      const [current, lists, data] = await Promise.all([
        getShoppingSettings(),
        db.shoppingLists.toArray(),
        loadShoppingData(),
      ])
      const next = normalizeShoppingSettings({ ...current, ...patch })
      const now = Date.now()
      const dayChanged = next.periodStartDay !== current.periodStartDay

      const removable = dayChanged
        ? lists.filter(
            (list) =>
              list.kind === 'standard' &&
              list.periodStart !== null &&
              list.periodEnd !== null &&
              list.periodEnd >= today &&
              !listHasShoppingData(list, data),
          )
        : []
      const removableIds = new Set(removable.map((list) => list.id))

      await db.settings.bulkPut([
        { key: SHOPPING_PERIOD_START_DAY_KEY, value: next.periodStartDay },
        { key: STANDARD_SHOPPING_LIST_NAME_KEY, value: next.standardListName },
      ])

      if (removable.length > 0) {
        await db.shoppingLists.bulkDelete(Array.from(removableIds))
      }

      const renamed: ShoppingList[] = []
      for (const list of lists) {
        if (list.kind !== 'standard' || removableIds.has(list.id)) continue
        if (!list.periodStart || !list.periodEnd) continue
        const period = shoppingPeriodFromRange(list.periodStart, list.periodEnd)
        const name = standardShoppingListName(next.standardListName, period)
        if (name === list.name) continue
        renamed.push({ ...list, name, updatedAt: now })
      }
      if (renamed.length > 0) {
        await db.shoppingLists.bulkPut(renamed)
      }
      return next
    },
  )
}
