/*
 * openCook Web
 * Copyright (C) 2026 openCook Web contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Central shopping-cycle service. It owns the one authoritative resolution of
 * persisted periods and the explicit transition when the user changes the
 * regular shopping weekday. Nothing here assumes a weekday or list name.
 */

import { db } from '../db'
import {
  addDays,
  dayNumber,
  todayKey,
  weekdayIndex,
} from '../domain/dates'
import {
  periodContainsDate,
  resolveShoppingPeriodFromData,
  shoppingPeriod,
  shoppingPeriodFromList,
  shoppingPeriodFromRange,
  standardShoppingListId,
  standardShoppingListName,
  standardShoppingListRecord,
  type ShoppingPeriod,
} from '../domain/shoppingLists'
import {
  getShoppingSettings,
  normalizeShoppingSettings,
  normalizeStandardListName,
  SHOPPING_PERIOD_START_DAY_KEY,
  STANDARD_SHOPPING_LIST_NAME_KEY,
  type ShoppingSettings,
} from '../settings/shopping'
import type { ShoppingList } from '../types'
import { ShoppingListError } from './errors'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export function requireDateKey(value: string, label = 'Der Einkaufstag'): string {
  if (!DATE_RE.test(value)) {
    throw new ShoppingListError('invalid-period', `${label} ist kein gültiges Datum.`)
  }
  return value
}

/**
 * Resolve the period that contains [anchor]. Persisted standard lists win over
 * the current configuration, so a changed shopping weekday can never re-date an
 * existing period.
 */
export async function resolveShoppingPeriod(anchor: string): Promise<ShoppingPeriod> {
  const date = requireDateKey(anchor)
  const [settings, lists] = await Promise.all([
    getShoppingSettings(),
    db.shoppingLists.toArray(),
  ])
  return resolveShoppingPeriodFromData(date, settings, lists)
}

export function currentPeriodForToday(
  settings: ShoppingSettings,
  lists: readonly ShoppingList[],
  today = todayKey(),
): ShoppingPeriod {
  return resolveShoppingPeriodFromData(today, settings, lists)
}

/** First day of the adjacent standard period, including a persisted transition. */
export function adjacentShoppingPeriodStart(
  anchor: string,
  direction: -1 | 1,
  settings: ShoppingSettings,
  lists: readonly ShoppingList[],
  today = todayKey(),
): string {
  const current = resolveShoppingPeriodFromData(anchor || today, settings, lists)
  const starts = lists
    .filter(
      (list): list is ShoppingList & { periodStart: string } =>
        list.kind === 'standard' && typeof list.periodStart === 'string',
    )
    .map((list) => list.periodStart)
  if (direction > 0) {
    const next = starts
      .filter((start) => start > current.start)
      .sort((a, b) => a.localeCompare(b))
    if (next[0]) return next[0]
    return shoppingPeriod(addDays(current.end, 1), settings.periodStartDay).start
  }
  const previous = starts
    .filter((start) => start < current.start)
    .sort((a, b) => b.localeCompare(a))
  if (previous[0]) return previous[0]
  return shoppingPeriod(addDays(current.start, -1), settings.periodStartDay).start
}

export function firstWeekdayAfter(date: string, weekday: number): string {
  const candidate = addDays(date, 1)
  const diff = (weekday - weekdayIndex(candidate) + 7) % 7
  return addDays(candidate, diff)
}

export interface ShoppingCycleConflict {
  code: 'future-standard-lists'
  message: string
  periodStarts: string[]
  periodLabels: string[]
}

export interface ShoppingCycleChangePreview {
  current: ShoppingSettings
  next: ShoppingSettings
  currentPeriod: ShoppingPeriod
  /** One-time shortened bridge period, or `null` when none is needed. */
  transition: ShoppingPeriod | null
  /** First regular period under the new weekday. */
  firstRegularPeriod: ShoppingPeriod
  /** Persisted periods after the current one; the change is refused for them. */
  futurePeriods: ShoppingPeriod[]
  blocked: boolean
  conflict: ShoppingCycleConflict | null
}

function futureStandardPeriods(
  lists: readonly ShoppingList[],
  current: ShoppingPeriod,
): ShoppingPeriod[] {
  return lists
    .filter(
      (list) =>
        list.kind === 'standard' &&
        typeof list.periodStart === 'string' &&
        list.periodStart > current.end,
    )
    .map((list) => shoppingPeriodFromList(list))
    .sort((a, b) => a.start.localeCompare(b.start))
}

function buildPreview(
  current: ShoppingSettings,
  next: ShoppingSettings,
  lists: readonly ShoppingList[],
  today: string,
): ShoppingCycleChangePreview {
  const currentPeriod = currentPeriodForToday(current, lists, today)
  const futurePeriods = futureStandardPeriods(lists, currentPeriod)
  const anchorEnd = futurePeriods[futurePeriods.length - 1]?.end ?? currentPeriod.end
  const newStart = firstWeekdayAfter(anchorEnd, next.periodStartDay)
  const transition =
    dayNumber(newStart) > dayNumber(anchorEnd) + 1
      ? shoppingPeriodFromRange(addDays(anchorEnd, 1), addDays(newStart, -1), true)
      : null
  const firstRegularPeriod = shoppingPeriodFromRange(newStart, addDays(newStart, 6))
  const conflict: ShoppingCycleConflict | null =
    futurePeriods.length > 0
      ? {
          code: 'future-standard-lists',
          message:
            'Für spätere Zeiträume existieren bereits Einkaufszettel. Der Einkaufstag kann erst geändert werden, wenn diese Zeiträume nicht mehr betroffen sind; vorhandene Planungen werden nicht überschrieben.',
          periodStarts: futurePeriods.map((period) => period.start),
          periodLabels: futurePeriods.map((period) => period.label),
        }
      : null
  return {
    current,
    next,
    currentPeriod,
    transition,
    firstRegularPeriod,
    futurePeriods,
    blocked: conflict !== null,
    conflict,
  }
}

/** Describe the effect of a weekday/name change without writing anything. */
export async function previewShoppingCycleChange(
  patch: Partial<ShoppingSettings>,
  today = todayKey(),
): Promise<ShoppingCycleChangePreview> {
  const [current, lists] = await Promise.all([
    getShoppingSettings(),
    db.shoppingLists.toArray(),
  ])
  const next = normalizeShoppingSettings({ ...current, ...patch })
  return buildPreview(current, next, lists, today)
}

export interface ApplyShoppingCycleResult {
  settings: ShoppingSettings
  preview: ShoppingCycleChangePreview
  createdStandardListIds: string[]
  renamedStandardListIds: string[]
}

/**
 * Persist the shopping configuration.
 *
 * - The current period is materialised with its old boundaries first, so its
 *   purchases/allocations keep their dates even after the setting changed.
 * - One explicitly marked transition period bridges the days between the old
 *   period and the first new regular weekday.
 * - Existing future standard lists abort the change instead of being
 *   overwritten.
 */
export async function applyShoppingCycleChange(
  patch: Partial<ShoppingSettings>,
  today = todayKey(),
): Promise<ApplyShoppingCycleResult> {
  return db.transaction('rw', [db.settings, db.shoppingLists], async () => {
    const current = await getShoppingSettings()
    const lists = await db.shoppingLists.toArray()
    const next = normalizeShoppingSettings({ ...current, ...patch })
    const preview = buildPreview(current, next, lists, today)
    if (preview.blocked && preview.conflict) {
      throw new ShoppingListError(
        'cycle-change-conflict',
        preview.conflict.message,
        {
          periodStarts: preview.conflict.periodStarts,
          periodLabels: preview.conflict.periodLabels,
        },
      )
    }

    const now = Date.now()
    const created: string[] = []
    const byId = new Map(lists.map((list) => [list.id, list]))

    const ensureStandard = (period: ShoppingPeriod): void => {
      const id = standardShoppingListId(period.start)
      if (byId.has(id)) return
      const record = standardShoppingListRecord(period, next.standardListName, now)
      byId.set(id, record)
      created.push(id)
    }

    // Preserve the historical boundaries of the period the user is in.
    ensureStandard(preview.currentPeriod)
    if (preview.transition) ensureStandard(preview.transition)

    // Persist the setting before renaming so the new base name is authoritative.
    await db.settings.bulkPut([
      { key: SHOPPING_PERIOD_START_DAY_KEY, value: next.periodStartDay },
      { key: STANDARD_SHOPPING_LIST_NAME_KEY, value: next.standardListName },
    ])

    const renamed: string[] = []
    for (const list of byId.values()) {
      if (list.kind !== 'standard') continue
      const period = shoppingPeriodFromList(list)
      const name = standardShoppingListName(next.standardListName, period)
      if (name === list.name) continue
      const updated: ShoppingList = { ...list, name, updatedAt: now }
      byId.set(list.id, updated)
      renamed.push(list.id)
    }
    if (created.length > 0) {
      await db.shoppingLists.bulkPut(created.map((id) => byId.get(id)!))
    }
    if (renamed.length > 0) {
      await db.shoppingLists.bulkPut(renamed.map((id) => byId.get(id)!))
    }

    return {
      settings: next,
      preview,
      createdStandardListIds: created,
      renamedStandardListIds: renamed,
    }
  })
}

/** True when a persisted standard list covers the date. */
export function listCoversDate(list: ShoppingList, date: string): boolean {
  if (list.kind !== 'standard' || !list.periodStart || !list.periodEnd) return false
  return periodContainsDate({ start: list.periodStart, end: list.periodEnd }, date)
}

export function normalizeName(value: string): string {
  return normalizeStandardListName(value)
}
