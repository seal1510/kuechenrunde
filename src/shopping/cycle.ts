/*
 * openCook Web
 * Copyright (C) 2026 openCook Web contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Central shopping-cycle service. It owns the one authoritative resolution of
 * persisted periods, the explicit transition when the regular shopping weekday
 * changes, and the persisted future effective date for a change that cannot
 * start immediately because binding future periods already exist.
 */

import { db } from '../db'
import { addDays, dayNumber, normalizeWeekday, todayKey, weekdayIndex } from '../domain/dates'
import {
  findOverlappingStandardPeriods,
  findStandardPeriodGaps,
  periodContainsDate,
  periodStartDayForDate,
  resolveShoppingPeriodResolution,
  shoppingPeriod,
  shoppingPeriodFromList,
  shoppingPeriodFromRange,
  standardShoppingListId,
  standardShoppingListName,
  standardShoppingListRecord,
  type ShoppingPeriod,
  type ShoppingPeriodGap,
} from '../domain/shoppingLists'
import {
  getShoppingSettings,
  normalizePendingShoppingCycleChange,
  normalizeShoppingSettings,
  pendingShoppingCycleSettingValue,
  SHOPPING_CYCLE_PENDING_KEY,
  SHOPPING_PERIOD_START_DAY_KEY,
  STANDARD_SHOPPING_LIST_NAME_KEY,
  type PendingShoppingCycleChange,
  type ShoppingSettings,
} from '../settings/shopping'
import type {
  CookSession,
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

export interface ShoppingCycleData {
  manualItems: readonly ShoppingManualItem[]
  purchases: readonly ShoppingPurchase[]
  allocations: readonly ShoppingDemandAllocation[]
  cookSessions: readonly CookSession[]
  checks: readonly ShoppingCheck[]
}

export async function loadShoppingCycleData(): Promise<ShoppingCycleData> {
  const [manualItems, purchases, allocations, cookSessions, checks] = await Promise.all([
    db.shoppingManualItems.toArray(),
    db.shoppingPurchases.toArray(),
    db.shoppingDemandAllocations.toArray(),
    db.cookSessions.toArray(),
    db.shoppingChecks.toArray(),
  ])
  return { manualItems, purchases, allocations, cookSessions, checks }
}

function dateInList(list: ShoppingList, date: string): boolean {
  return Boolean(
    list.kind === 'standard' &&
      list.periodStart &&
      list.periodEnd &&
      periodContainsDate({ start: list.periodStart, end: list.periodEnd }, date),
  )
}

/**
 * A future standard list is binding when any persisted assignment or relevant
 * planned recipe demand refers to it. Empty system-generated lists are not
 * binding and may be removed/recreated by a controlled rhythm change.
 */
export function standardPeriodIsBinding(
  list: ShoppingList,
  data: ShoppingCycleData,
): boolean {
  if (list.kind !== 'standard' || !list.periodStart || !list.periodEnd) return false
  const start = list.periodStart
  return (
    data.manualItems.some(
      (item) =>
        item.listId === list.id ||
        (item.listId === undefined &&
          dateInList(list, item.shoppingDate || item.weekStart || '')),
    ) ||
    data.purchases.some(
      (purchase) =>
        purchase.listId === list.id ||
        (purchase.listId === undefined && dateInList(list, purchase.shoppingDate)),
    ) ||
    data.allocations.some(
      (allocation) =>
        allocation.listId === list.id || allocation.periodStart === start,
    ) ||
    data.cookSessions.some(
      (session) => session.status === 'planned' && dateInList(list, session.date),
    ) ||
    data.checks.some((check) =>
      dateInList(list, check.shoppingDate || check.weekStart),
    )
  )
}

/**
 * Resolve the period that contains [anchor]. Persisted standard lists win over
 * the current configuration, so a changed shopping weekday can never re-date an
 * existing period. An ambiguous date is reported instead of being guessed.
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

export function currentEffectivePeriodStartDay(
  settings: ShoppingSettings,
  today = todayKey(),
): number {
  return periodStartDayForDate(settings, today)
}

/** First day of the adjacent standard period, including a persisted transition. */
export function adjacentShoppingPeriodStart(
  anchor: string,
  direction: -1 | 1,
  settings: ShoppingSettings,
  lists: readonly ShoppingList[],
  today = todayKey(),
): string {
  const current = currentPeriodForToday(settings, lists, anchor || today)
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
    const nextDate = addDays(current.end, 1)
    return shoppingPeriod(nextDate, periodStartDayForDate(settings, nextDate)).start
  }
  const previous = starts
    .filter((start) => start < current.start)
    .sort((a, b) => b.localeCompare(a))
  if (previous[0]) return previous[0]
  const previousDate = addDays(current.start, -1)
  return shoppingPeriod(previousDate, periodStartDayForDate(settings, previousDate)).start
}

export function firstWeekdayAfter(date: string, weekday: number): string {
  const candidate = addDays(date, 1)
  const diff = (weekday - weekdayIndex(candidate) + 7) % 7
  return addDays(candidate, diff)
}

/**
 * The dates a new automatic meal plan should cover. It uses the configured
 * shopping/planning period, including a shortened transition period, and never
 * a hidden Monday default.
 */
export function planningDatesForToday(
  today: string,
  settings: ShoppingSettings,
  lists: readonly ShoppingList[],
): string[] {
  const period = currentPeriodForToday(settings, lists, today)
  return period.days.filter((day) => day >= today)
}

export type ShoppingCycleChangeMode =
  | 'name'
  | 'materialize'
  | 'cancel'
  | 'immediate'
  | 'scheduled'

export interface ShoppingCycleConflict {
  code: 'overlapping-periods' | 'period-gaps' | 'unassigned-future-data'
  message: string
  listIds?: string[]
  periodStarts?: string[]
  periodLabels?: string[]
  gaps?: ShoppingPeriodGap[]
  dates?: string[]
}

export interface ShoppingCycleChangePreview {
  current: ShoppingSettings
  nextDay: number
  nextName: string
  currentEffectiveDay: number
  mode: ShoppingCycleChangeMode
  currentPeriod: ShoppingPeriod
  /** First day of the new rhythm (or today for name/materialize/cancel). */
  effectiveFrom: string
  transition: ShoppingPeriod | null
  firstRegularPeriod: ShoppingPeriod
  bindingFuturePeriods: ShoppingPeriod[]
  unusedFuturePeriods: ShoppingPeriod[]
  blocked: boolean
  conflict: ShoppingCycleConflict | null
}

function futureStandardPeriods(
  lists: readonly ShoppingList[],
  current: ShoppingPeriod,
): ShoppingList[] {
  return lists
    .filter(
      (list): list is ShoppingList & { periodStart: string } =>
        list.kind === 'standard' &&
        typeof list.periodStart === 'string' &&
        list.periodStart > current.end,
    )
    .slice()
    .sort((a, b) => a.periodStart.localeCompare(b.periodStart))
}

function unassignedFutureData(
  current: ShoppingPeriod,
  lists: readonly ShoppingList[],
  data: ShoppingCycleData,
): string[] {
  const dates = new Set<string>()
  const freeListIds = new Set(
    lists.filter((list) => list.kind === 'free').map((list) => list.id),
  )
  const covered = (date: string): boolean =>
    lists.some(
      (list) =>
        list.kind === 'standard' &&
        typeof list.periodStart === 'string' &&
        typeof list.periodEnd === 'string' &&
        periodContainsDate({ start: list.periodStart, end: list.periodEnd }, date),
    )
  const add = (date: string | undefined): void => {
    if (date && DATE_RE.test(date) && date > current.end && !covered(date)) {
      dates.add(date)
    }
  }
  for (const item of data.manualItems) {
    if (item.listId && freeListIds.has(item.listId)) continue
    add(item.shoppingDate || item.weekStart)
  }
  for (const purchase of data.purchases) {
    if (purchase.listId && freeListIds.has(purchase.listId)) continue
    add(purchase.shoppingDate)
  }
  for (const allocation of data.allocations) {
    if (
      allocation.periodStart > current.end &&
      !lists.some(
        (list) =>
          list.kind === 'standard' && list.periodStart === allocation.periodStart,
      )
    ) {
      dates.add(allocation.periodStart)
    }
  }
  return Array.from(dates).sort()
}

function overlapConflict(lists: readonly ShoppingList[]): ShoppingCycleConflict | null {
  const overlaps = findOverlappingStandardPeriods(lists)
  if (overlaps.length === 0) return null
  const listIds = Array.from(
    new Set(overlaps.flatMap((overlap) => [overlap.firstListId, overlap.secondListId])),
  )
  return {
    code: 'overlapping-periods',
    message:
      'Mehrere Standard-Einkaufsperioden decken denselben Kalendertag ab. Die Einkaufsdaten können ohne eindeutige Zuordnung nicht verändert werden.',
    listIds,
  }
}

function gapConflict(gaps: readonly ShoppingPeriodGap[]): ShoppingCycleConflict | null {
  if (gaps.length === 0) return null
  return {
    code: 'period-gaps',
    message:
      'Zwischen den verbindlichen zukünftigen Einkaufsperioden liegen Tage ohne eindeutige Standardperiode. Der Rhythmus kann erst nach einer eindeutigen Zuordnung geändert werden.',
    gaps: [...gaps],
  }
}

function buildPreview(
  current: ShoppingSettings,
  nextDay: number,
  nextName: string,
  lists: readonly ShoppingList[],
  data: ShoppingCycleData,
  today: string,
  cancelPending = false,
): ShoppingCycleChangePreview {
  const currentEffectiveDay = periodStartDayForDate(current, today)
  const resolution = resolveShoppingPeriodResolution(today, current, lists)
  const currentPeriod = resolution.period
  const futureLists = futureStandardPeriods(lists, currentPeriod)
  const bindingFuture = futureLists.filter((list) => standardPeriodIsBinding(list, data))
  const unusedFuture = futureLists.filter((list) => !standardPeriodIsBinding(list, data))
  const bindingPeriods = bindingFuture.map((list) => shoppingPeriodFromList(list))
  const base = {
    current,
    nextDay,
    nextName,
    currentEffectiveDay,
    currentPeriod,
    bindingFuturePeriods: bindingPeriods,
  }

  if (cancelPending && current.pending && current.pending.effectiveFrom > today) {
    if (bindingFuture.length === 0) {
      return {
        ...base,
        mode: 'cancel',
        effectiveFrom: today,
        transition: null,
        firstRegularPeriod: currentPeriod,
        unusedFuturePeriods: unusedFuture.map((list) => shoppingPeriodFromList(list)),
        blocked: false,
        conflict: null,
      }
    }
    // The planned transition/period already contains binding data. Cancel is
    // still possible, but only by bridging the binding periods back to the
    // previous regular rhythm; no binding list is removed or changed.
    const anchorEnd = bindingPeriods[bindingPeriods.length - 1]!.end
    const gaps = findStandardPeriodGaps(
      bindingFuture,
      addDays(currentPeriod.end, 1),
      anchorEnd,
    )
    const gap = gapConflict(gaps)
    const newStart = firstWeekdayAfter(anchorEnd, nextDay)
    const transition =
      dayNumber(newStart) > dayNumber(anchorEnd) + 1
        ? shoppingPeriodFromRange(addDays(anchorEnd, 1), addDays(newStart, -1), true)
        : null
    return {
      ...base,
      mode: 'immediate',
      effectiveFrom: newStart,
      transition,
      firstRegularPeriod: shoppingPeriodFromRange(newStart, addDays(newStart, 6)),
      unusedFuturePeriods: unusedFuture.map((list) => shoppingPeriodFromList(list)),
      blocked: gap !== null,
      conflict: gap,
    }
  }

  if (nextDay === currentEffectiveDay) {
    if (current.pending && current.pending.effectiveFrom <= today) {
      return {
        ...base,
        mode: 'materialize',
        effectiveFrom: today,
        transition: null,
        firstRegularPeriod: currentPeriod,
        unusedFuturePeriods: [],
        blocked: false,
        conflict: null,
      }
    }
    return {
      ...base,
      mode: 'name',
      effectiveFrom: today,
      transition: null,
      firstRegularPeriod: currentPeriod,
      unusedFuturePeriods: [],
      blocked: false,
      conflict: null,
    }
  }

  if (resolution.conflict) {
    return {
      ...base,
      mode: 'scheduled',
      effectiveFrom: addDays(currentPeriod.end, 1),
      transition: null,
      firstRegularPeriod: currentPeriod,
      unusedFuturePeriods: [],
      blocked: true,
      conflict: {
        code: 'overlapping-periods',
        message:
          'Der heutige Einkaufstag ist bereits mehreren Standardperioden zugeordnet. Eine Rhythmusänderung ist ohne eindeutige Zuordnung nicht möglich.',
        listIds: resolution.conflict.listIds,
      },
    }
  }

  const overlap = overlapConflict(lists)
  if (overlap) {
    return {
      ...base,
      mode: 'scheduled',
      effectiveFrom: addDays(currentPeriod.end, 1),
      transition: null,
      firstRegularPeriod: currentPeriod,
      unusedFuturePeriods: [],
      blocked: true,
      conflict: overlap,
    }
  }

  const unassigned = unassignedFutureData(currentPeriod, lists, data)
  if (unassigned.length > 0) {
    return {
      ...base,
      mode: 'scheduled',
      effectiveFrom: addDays(currentPeriod.end, 1),
      transition: null,
      firstRegularPeriod: currentPeriod,
      unusedFuturePeriods: [],
      blocked: true,
      conflict: {
        code: 'unassigned-future-data',
        message:
          'Zukünftige Einkaufsdaten ohne eindeutige Standardperiode wurden gefunden. Sie würden durch eine Rhythmusänderung sonst stillschweigend neu zugeordnet.',
        dates: unassigned,
      },
    }
  }

  const anchorEnd = bindingPeriods[bindingPeriods.length - 1]?.end ?? currentPeriod.end
  const gaps =
    bindingPeriods.length > 0
      ? findStandardPeriodGaps(bindingFuture, addDays(currentPeriod.end, 1), anchorEnd)
      : []
  const gap = gapConflict(gaps)
  const newStart = firstWeekdayAfter(anchorEnd, nextDay)
  const transition =
    dayNumber(newStart) > dayNumber(anchorEnd) + 1
      ? shoppingPeriodFromRange(addDays(anchorEnd, 1), addDays(newStart, -1), true)
      : null
  const firstRegularPeriod = shoppingPeriodFromRange(newStart, addDays(newStart, 6))
  return {
    ...base,
    mode: bindingFuture.length > 0 ? 'scheduled' : 'immediate',
    effectiveFrom: newStart,
    transition,
    firstRegularPeriod,
    unusedFuturePeriods: unusedFuture.map((list) => shoppingPeriodFromList(list)),
    blocked: gap !== null,
    conflict: gap,
  }
}

/** Describe the effect of a weekday/name change without writing anything. */
export async function previewShoppingCycleChange(
  patch: Partial<ShoppingSettings>,
  today = todayKey(),
  options: { cancelPending?: boolean } = {},
): Promise<ShoppingCycleChangePreview> {
  const [current, lists, data] = await Promise.all([
    getShoppingSettings(),
    db.shoppingLists.toArray(),
    loadShoppingCycleData(),
  ])
  const currentEffectiveDay = periodStartDayForDate(current, today)
  const next = normalizeShoppingSettings({
    ...current,
    periodStartDay:
      typeof patch.periodStartDay === 'number'
        ? patch.periodStartDay
        : currentEffectiveDay,
    standardListName: patch.standardListName ?? current.standardListName,
  })
  return buildPreview(
    current,
    next.periodStartDay,
    next.standardListName,
    lists,
    data,
    today,
    options.cancelPending === true,
  )
}

export interface ApplyShoppingCycleResult {
  settings: ShoppingSettings
  preview: ShoppingCycleChangePreview
  createdStandardListIds: string[]
  removedStandardListIds: string[]
  renamedStandardListIds: string[]
}

/**
 * Persist the shopping configuration.
 *
 * - Name-only changes never touch period data or conflict rules.
 * - Unused future system lists are removed in a controlled transaction.
 * - Binding future periods are preserved; the new rhythm becomes effective
 *   after them and is stored as a pending plan with a stable effective date.
 * - A second change before the effective date replaces the pending plan.
 */
export async function applyShoppingCycleChange(
  patch: Partial<ShoppingSettings>,
  today = todayKey(),
  options: { cancelPending?: boolean } = {},
): Promise<ApplyShoppingCycleResult> {
  return db.transaction(
    'rw',
    [
      db.settings,
      db.shoppingLists,
      db.shoppingManualItems,
      db.shoppingPurchases,
      db.shoppingDemandAllocations,
      db.cookSessions,
      db.shoppingChecks,
    ],
    async () => {
      const [current, lists, data] = await Promise.all([
        getShoppingSettings(),
        db.shoppingLists.toArray(),
        loadShoppingCycleData(),
      ])
      const currentEffectiveDay = periodStartDayForDate(current, today)
      const next = normalizeShoppingSettings({
        ...current,
        periodStartDay:
          typeof patch.periodStartDay === 'number'
            ? patch.periodStartDay
            : currentEffectiveDay,
        standardListName: patch.standardListName ?? current.standardListName,
      })
      const preview = buildPreview(
        current,
        next.periodStartDay,
        next.standardListName,
        lists,
        data,
        today,
        options.cancelPending === true,
      )
      if (preview.blocked && preview.conflict) {
        throw new ShoppingListError(
          'cycle-change-conflict',
          preview.conflict.message,
          {
            code: preview.conflict.code,
            listIds: preview.conflict.listIds,
            gaps: preview.conflict.gaps,
            dates: preview.conflict.dates,
          },
        )
      }

      const now = Date.now()
      const byId = new Map(lists.map((list) => [list.id, list]))
      const created: string[] = []
      const removed: string[] = []

      const removeUnusedFuture = (): void => {
        for (const period of preview.unusedFuturePeriods) {
          const list = byId.get(standardShoppingListId(period.start))
          if (!list) continue
          if (standardPeriodIsBinding(list, data)) {
            throw new ShoppingListError(
              'cycle-change-conflict',
              'Ein zukünftiger Einkaufszettel hat inzwischen verbindliche Daten erhalten. Die Änderung wurde abgebrochen.',
              { listId: list.id },
            )
          }
          const hasAllocation = data.allocations.some(
            (allocation) =>
              allocation.listId === list.id ||
              allocation.periodStart === list.periodStart,
          )
          if (hasAllocation) {
            throw new ShoppingListError(
              'cycle-change-conflict',
              'Ein zukünftiger Einkaufszettel hat inzwischen eine Mengenverteilung erhalten. Die Änderung wurde abgebrochen.',
              { listId: list.id },
            )
          }
          byId.delete(list.id)
          removed.push(list.id)
        }
      }

      const ensureStandard = (period: ShoppingPeriod): void => {
        const id = standardShoppingListId(period.start)
        if (byId.has(id)) return
        const record = standardShoppingListRecord(period, next.standardListName, now)
        byId.set(id, record)
        created.push(id)
      }

      removeUnusedFuture()
      if (removed.length > 0) await db.shoppingLists.bulkDelete(removed)
      ensureStandard(preview.currentPeriod)
      if (preview.transition) ensureStandard(preview.transition)

      const hasActivePending =
        current.pending !== null && current.pending.effectiveFrom <= today
      const baseDay =
        preview.mode === 'scheduled'
          ? hasActivePending
            ? currentEffectiveDay
            : current.periodStartDay
          : preview.nextDay
      const pending: PendingShoppingCycleChange | null =
        preview.mode === 'scheduled'
          ? {
              periodStartDay: preview.nextDay,
              effectiveFrom: preview.effectiveFrom,
              createdAt: now,
            }
          : preview.mode === 'name'
            ? current.pending
            : null

      await db.settings.bulkPut([
        { key: SHOPPING_PERIOD_START_DAY_KEY, value: baseDay },
        { key: STANDARD_SHOPPING_LIST_NAME_KEY, value: next.standardListName },
      ])
      if (pending) {
        await db.settings.put({
          key: SHOPPING_CYCLE_PENDING_KEY,
          value: pendingShoppingCycleSettingValue(pending)!,
        })
      } else {
        await db.settings.delete(SHOPPING_CYCLE_PENDING_KEY)
      }

      const renamed: string[] = []
      const generatedPrefix = `${current.standardListName} · `
      for (const list of byId.values()) {
        if (list.kind !== 'standard') continue
        // Only generated names follow the global base name. A genuinely
        // custom standard-list name is preserved.
        if (
          !list.name.startsWith(generatedPrefix) &&
          !list.name.startsWith('Donnerstags-Einkauf ·')
        ) {
          continue
        }
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
        settings: {
          ...next,
          pending,
        },
        preview,
        createdStandardListIds: created,
        removedStandardListIds: removed,
        renamedStandardListIds: renamed,
      }
    },
  )
}

/** True when a persisted standard list covers the date. */
export function listCoversDate(list: ShoppingList, date: string): boolean {
  if (list.kind !== 'standard' || !list.periodStart || !list.periodEnd) return false
  return periodContainsDate({ start: list.periodStart, end: list.periodEnd }, date)
}
