/*
 * Küchenrunde – Wochenplanung im Cloud-Modus
 * Copyright (C) 2026 openCook Web contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Setzt die bestehende Planungsschnittstelle auf den CloudRecordsStore. Alle
 * zusammengehörigen Zeilen (Kochvorgang, Esstage, Tagesstatus, freies Gericht)
 * werden in einem einzigen apply_ops-Aufruf geschrieben. Erst die bestätigte
 * Server-Revision macht die Änderung im Store und damit in der Oberfläche
 * sichtbar. Realtime-Ereignisse anderer Sitzungen kommen über denselben Store
 * an; es gibt keine zweite Synchronisierungsengine und keine Offline-Queue.
 *
 * Die Fachregeln (Portionen, Kochmenge, Verschieben, Notizen) bleiben in den
 * vorhandenen Domain-Modulen. Hier wird ausschließlich die Persistenz getauscht.
 */

import { useCallback, useMemo, useSyncExternalStore } from 'react'
import {
  CloudRecordsStore,
  type RecordsTransaction,
  type RecordRow,
} from '../data/cloudRecords'
import {
  normalizeCalendarSettings,
  type CalendarSettings,
} from '../domain/calendar'
import { addDays, daysBetween } from '../domain/dates'
import {
  DEFAULT_PLAN_SLOT,
  cookedRedefinition,
  isValidDateKey,
  normalizeDayServings,
  planDayTotal,
} from '../domain/dishplan'
import { resolveOriginalServings } from '../domain/scaling'
import {
  resolveShoppingPeriodResolution,
  type ShoppingPeriod,
} from '../domain/shoppingLists'
import { randomId } from '../lib/id'
import { buildIngredientList } from '../recipe/editor'
import {
  CookedMoveConflictError,
  CookedPlanConflictError,
  DishPlanMoveConflictError,
  dishPlanMoveSignature,
  type DishPlanMoveSnapshot,
  type MoveDishPlanResult,
  type SaveDishPlanDay,
  type SaveDishPlanInput,
  type SaveDishPlanResult,
} from '../mealplan/dishService'
import {
  DayNoteMoveConflictError,
  dayNoteSignature,
  normalizeDayNoteText,
  type DayNoteMoveSnapshot,
} from '../mealplan/dayNoteService'
import {
  normalizeFreeDishName,
  normalizeFreeDishReferenceServings,
  type SaveFreeDishPlanInput,
  type SaveFreeDishPlanResult,
} from '../mealplan/freeDishService'
import type { PlanBackend, PlanData } from '../mealplan/planBackend'
import { MealPlanError } from '../mealplan/service'
import { calendarSettingsFromRows } from '../settings/calendar'
import { shoppingSettingsFromRows } from '../settings/shopping'
import { planDeletedSessionsShoppingCleanup } from '../shopping/deletionCleanup'
import type {
  CookSession,
  CookSessionStatus,
  DayNote,
  DishKind,
  FreeDish,
  MealDay,
  MealPlanEntry,
  Recipe,
  SettingRecord,
  ShoppingDemandAllocation,
  ShoppingItemRule,
  ShoppingList,
  ShoppingPurchase,
  ShoppingQuantityCorrection,
} from '../types'
import { DEFAULT_HOUSEHOLD_SIZE } from '../types'
import { useCloudImageUrl } from './CloudImageProvider'
import { useCloudRecipeImages } from './useCloudRecipes'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function now(): number {
  return Date.now()
}

function rowsToData<T>(rows: readonly RecordRow<T>[]): T[] {
  return rows.map((row) => row.data)
}

function writeRow<T>(
  tx: RecordsTransaction,
  collection: string,
  id: string,
  data: T,
  existing: RecordRow<T> | undefined,
): void {
  if (!existing) {
    tx.create(collection, id, data)
  } else if (existing.rev === 0) {
    tx.updateCreated(collection, id, data)
  } else {
    tx.update(collection, id, data, existing.rev)
  }
}

function normalizePlanDays(days: readonly SaveDishPlanDay[]): SaveDishPlanDay[] {
  if (!Array.isArray(days) || days.length === 0) {
    throw new MealPlanError('Bitte mindestens einen Tag planen.')
  }

  const seenDates = new Set<string>()
  const seenEntryIds = new Set<string>()
  return days.map((day) => {
    if (!isValidDateKey(day.date)) throw new MealPlanError('Ungültiges Datum.')
    if (seenDates.has(day.date)) {
      throw new MealPlanError('Ein Tag kann in diesem Gericht nur einmal vorkommen.')
    }
    seenDates.add(day.date)
    if (day.entryId) {
      if (seenEntryIds.has(day.entryId)) {
        throw new MealPlanError('Ein Tag kann in diesem Gericht nur einmal vorkommen.')
      }
      seenEntryIds.add(day.entryId)
    }
    return {
      entryId: day.entryId,
      date: day.date,
      servings: normalizeDayServings(day.servings),
    }
  })
}

function correctionValue(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.round(value * 10) / 10
    : null
}

async function writeDaySkipped(
  tx: RecordsTransaction,
  date: string,
  skipped: boolean,
): Promise<void> {
  const existing = tx.get<MealDay>('mealDays', date)
  const nowValue = now()
  const row: MealDay = {
    date,
    skipped,
    createdAt: existing?.data.createdAt ?? nowValue,
    updatedAt: nowValue,
  }
  writeRow(tx, 'mealDays', date, row, existing)
}

async function clearDaySkippedIfEmpty(
  tx: RecordsTransaction,
  date: string,
): Promise<void> {
  if (tx.list<MealPlanEntry>('mealPlans').some((row) => row.data.date === date)) {
    return
  }
  const day = tx.get<MealDay>('mealDays', date)
  if (day?.data.skipped) await writeDaySkipped(tx, date, false)
}

interface ConnectedDishIdentity {
  kind: DishKind
  recipeId: string | null
  freeDishId: string | null
}

interface PersistCloudDishOptions {
  identity: ConnectedDishIdentity
  days: SaveDishPlanDay[]
  cookSessionId?: string | null
  slot?: string
  cookStatus?: CookSessionStatus
  auto?: boolean
  allowCookedChange?: boolean
  prepare?: (tx: RecordsTransaction, nowValue: number) => Promise<void>
  afterPersist?: (
    tx: RecordsTransaction,
    session: CookSession,
    entries: MealPlanEntry[],
    nowValue: number,
  ) => Promise<void>
}

/**
 * Shared transaction for connected dishes. Mirrors the existing local service:
 * one cooking event owns the total quantity, one appointment per day links to
 * it, and removing a day never leaves an orphaned row.
 */
async function persistCloudDishPlan(
  store: CloudRecordsStore,
  options: PersistCloudDishOptions,
): Promise<SaveDishPlanResult> {
  const normalizedDays = normalizePlanDays(options.days)
  if (!options.identity.recipeId && !options.identity.freeDishId) {
    throw new MealPlanError('Dieses Gericht hat keine gültige Grundlage.')
  }
  const defaultSlot = options.slot?.trim() || DEFAULT_PLAN_SLOT

  return store.transaction(async (tx) => {
    if (options.prepare) await options.prepare(tx, now())

    const nowValue = now()
    const entryRows = tx.list<MealPlanEntry>('mealPlans')
    const allEntries = rowsToData(entryRows)
    const entryRowById = new Map(entryRows.map((row) => [row.data.id, row]))
    const sessionRow = options.cookSessionId
      ? tx.get<CookSession>('cookSessions', options.cookSessionId)
      : undefined
    if (options.cookSessionId && !sessionRow) {
      throw new MealPlanError('Dieses Gericht existiert nicht mehr.')
    }
    const session = sessionRow?.data
    if (session) {
      const sameDish = options.identity.freeDishId
        ? session.freeDishId === options.identity.freeDishId && !session.recipeId
        : session.recipeId === options.identity.recipeId && !session.freeDishId
      if (!sameDish) {
        throw new MealPlanError(
          options.identity.freeDishId
            ? 'Dieses freie Gericht kann nicht mit einem anderen Kochvorgang verknüpft werden.'
            : 'Das Rezept eines bestehenden Gerichts kann nicht geändert werden.',
        )
      }
    }

    const linked = session
      ? allEntries.filter((entry) => entry.cookSessionId === session.id)
      : []
    const linkedSorted = [...linked].sort((a, b) =>
      a.date < b.date ? -1 : a.date > b.date ? 1 : 0,
    )
    const firstExistingSlot = normalizedDays
      .map((day) =>
        day.entryId
          ? allEntries.find((entry) => entry.id === day.entryId)?.slot
          : undefined,
      )
      .find((slot): slot is string => Boolean(slot))
    const groupSlot = linkedSorted[0]?.slot ?? firstExistingSlot ?? defaultSlot
    const knownSessionIds = new Set(
      tx.list<CookSession>('cookSessions').map((row) => row.data.id),
    )

    const usedExistingIds = new Set<string>()
    const resolved = normalizedDays
      .slice()
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
      .map((day) => {
        let existing: MealPlanEntry | undefined
        if (day.entryId) {
          existing = allEntries.find((entry) => entry.id === day.entryId)
          if (!existing) throw new MealPlanError('Ein geplanter Tag existiert nicht mehr.')
          if (session) {
            if (existing.cookSessionId !== session.id) {
              throw new MealPlanError('Dieser Tag gehört zu einem anderen Gericht.')
            }
          } else if (
            existing.cookSessionId &&
            knownSessionIds.has(existing.cookSessionId)
          ) {
            throw new MealPlanError('Dieser Tag gehört zu einem anderen Gericht.')
          }
        } else if (session) {
          existing = linked.find(
            (entry) => entry.date === day.date && !usedExistingIds.has(entry.id),
          )
        }
        if (existing) usedExistingIds.add(existing.id)
        return { ...day, existing, slot: existing?.slot ?? groupSlot }
      })

    const totalServings = planDayTotal(resolved)
    const conflict = cookedRedefinition(session, resolved)
    if (conflict && !options.allowCookedChange) {
      throw new CookedPlanConflictError(conflict.totalServings, conflict.cookedServings)
    }

    const targetIds = new Set(
      resolved
        .map((day) => day.existing?.id)
        .filter((value): value is string => Boolean(value)),
    )
    const removed = linked.filter((entry) => !targetIds.has(entry.id))
    for (const entry of removed) {
      const row = entryRowById.get(entry.id)
      if (row) tx.remove('mealPlans', entry.id, row.rev)
    }

    const excludedIds = new Set<string>([
      ...linked.map((entry) => entry.id),
      ...targetIds,
    ])
    const external = allEntries.filter((entry) => !excludedIds.has(entry.id))
    const maxPosition = new Map<string, number>()
    for (const entry of external) {
      const key = `${entry.date}|${entry.slot}`
      maxPosition.set(key, Math.max(maxPosition.get(key) ?? -1, entry.position ?? 0))
    }

    const dishFields = options.identity.freeDishId
      ? { recipeId: null, freeDishId: options.identity.freeDishId }
      : { recipeId: options.identity.recipeId }
    const sessionId = session?.id ?? `cook-${randomId()}`
    const updatedSession: CookSession = {
      id: sessionId,
      ...dishFields,
      date: resolved[0]!.date,
      servings: totalServings,
      status: options.cookStatus ?? session?.status ?? 'planned',
      auto: options.auto ?? false,
      createdAt: session?.createdAt ?? nowValue,
      updatedAt: nowValue,
    }

    const entries: MealPlanEntry[] = resolved.map((day) => {
      const existing = day.existing
      const key = `${day.date}|${day.slot}`
      const position = (maxPosition.get(key) ?? -1) + 1
      maxPosition.set(key, position)
      const status = existing?.status ?? (existing?.cooked ? 'eaten' : 'planned')
      return {
        id: existing?.id ?? `meal-${randomId()}`,
        date: day.date,
        slot: day.slot,
        ...dishFields,
        servings: day.servings,
        position,
        cookSessionId: sessionId,
        status,
        auto: options.auto ?? false,
        pinned: existing?.pinned ?? false,
        leftover: false,
        cooked: status === 'eaten',
        reasons: existing?.reasons ?? [],
        createdAt: existing?.createdAt ?? nowValue,
        updatedAt: nowValue,
      }
    })

    writeRow(tx, 'cookSessions', sessionId, updatedSession, sessionRow)
    for (const entry of entries) {
      writeRow(tx, 'mealPlans', entry.id, entry, entryRowById.get(entry.id))
    }

    if (options.afterPersist) {
      await options.afterPersist(tx, updatedSession, entries, nowValue)
    }

    const newDates = new Set(entries.map((entry) => entry.date))
    for (const date of newDates) await writeDaySkipped(tx, date, false)
    const touchedDates = new Set([
      ...linked.map((entry) => entry.date),
      ...entries.map((entry) => entry.date),
    ])
    for (const date of touchedDates) {
      if (!newDates.has(date)) await clearDaySkippedIfEmpty(tx, date)
    }

    return { session: updatedSession, entries }
  })
}

async function saveCloudDishPlan(
  store: CloudRecordsStore,
  input: SaveDishPlanInput,
): Promise<SaveDishPlanResult> {
  let recipe: Recipe | undefined
  return persistCloudDishPlan(store, {
    identity: { kind: 'recipe', recipeId: input.recipeId, freeDishId: null },
    days: input.days,
    cookSessionId: input.cookSessionId,
    slot: input.slot,
    cookStatus: input.cookStatus,
    auto: input.auto,
    allowCookedChange: input.allowCookedChange,
    prepare: async (tx) => {
      const row = tx.get<Recipe>('recipes', input.recipeId)
      if (!row) throw new MealPlanError('Das gewählte Rezept existiert nicht mehr.')
      recipe = row.data
    },
    afterPersist: async (tx, _session, _entries, nowValue) => {
      const corrected = correctionValue(input.originalServings)
      if (corrected !== null && recipe && !resolveOriginalServings(recipe)) {
        const row = tx.get<Recipe>('recipes', recipe.id)
        if (row) {
          const updatedRecipe: Recipe = {
            ...recipe,
            servingsNumber: corrected,
            updatedAt: nowValue,
          }
          tx.update('recipes', recipe.id, updatedRecipe, row.rev)
        }
      }
    },
  })
}

async function saveCloudFreeDishPlan(
  store: CloudRecordsStore,
  input: SaveFreeDishPlanInput,
): Promise<SaveFreeDishPlanResult> {
  const name = normalizeFreeDishName(input.name)
  if (!name) throw new MealPlanError('Bitte einen Namen für das Gericht angeben.')
  const referenceServings = normalizeFreeDishReferenceServings(input.referenceServings)
  if (input.cookSessionId && !input.freeDishId) {
    throw new MealPlanError('Dieses Gericht existiert nicht mehr.')
  }

  const freeDishId = input.freeDishId?.trim() || `free-${randomId()}`
  let written: FreeDish | null = null

  const result = await persistCloudDishPlan(store, {
    identity: { kind: 'free', recipeId: null, freeDishId },
    days: input.days,
    cookSessionId: input.cookSessionId,
    cookStatus: input.cookStatus,
    allowCookedChange: input.allowCookedChange,
    prepare: async (tx, nowValue) => {
      const existing = tx.get<FreeDish>('freeDishes', freeDishId)
      if (input.freeDishId && !existing) {
        throw new MealPlanError('Dieses freie Gericht existiert nicht mehr.')
      }
      const freeDish: FreeDish = {
        id: freeDishId,
        name,
        referenceServings,
        ingredients: buildIngredientList(
          input.ingredients,
          existing?.data.ingredients ?? [],
        ),
        createdAt: existing?.data.createdAt ?? nowValue,
        updatedAt: nowValue,
      }
      writeRow(tx, 'freeDishes', freeDishId, freeDish, existing)
      written = freeDish
    },
  })

  if (!written) {
    throw new MealPlanError('Das freie Gericht konnte nicht gespeichert werden.')
  }
  return { ...result, freeDish: written }
}

interface CloudShoppingCleanup {
  removedPurchaseIds: string[]
  removedAllocationIds: string[]
}

const EMPTY_CLEANUP: CloudShoppingCleanup = {
  removedPurchaseIds: [],
  removedAllocationIds: [],
}

/**
 * Offene Einkaufsdaten dürfen nach dem Entfernen eines Gerichts nicht als
 * Waisen zurückbleiben. Die Oberfläche ist im Cloud-Modus noch deaktiviert;
 * falls bereits Cloud-Einkaufszeilen existieren, werden sie nach derselben
 * reinen Regel wie lokal bereinigt. Es gibt keinen Hintergrundlauf.
 */
async function planCloudShoppingCleanup(
  tx: RecordsTransaction,
  deletedSessions: readonly CookSession[],
): Promise<CloudShoppingCleanup> {
  const purchaseRows = tx.list<ShoppingPurchase>('shoppingPurchases')
  const allocationRows = tx.list<ShoppingDemandAllocation>(
    'shoppingDemandAllocations',
  )
  if (purchaseRows.length === 0 && allocationRows.length === 0) {
    return EMPTY_CLEANUP
  }
  const active = deletedSessions.filter((session) => session.status !== 'cooked')
  if (active.length === 0) return EMPTY_CLEANUP

  const settings = shoppingSettingsFromRows(
    rowsToData(tx.list<SettingRecord>('settings')),
  )
  const lists = rowsToData(tx.list<ShoppingList>('shoppingLists'))
  const recipes = rowsToData(tx.list<Recipe>('recipes'))
  const freeDishes = rowsToData(tx.list<FreeDish>('freeDishes'))
  const sessions = rowsToData(tx.list<CookSession>('cookSessions'))
  const rules = rowsToData(tx.list<ShoppingItemRule>('shoppingItemRules'))
  const quantityCorrections = rowsToData(
    tx.list<ShoppingQuantityCorrection>('shoppingQuantityCorrections'),
  )
  const purchases = rowsToData(purchaseRows)
  const allocations = rowsToData(allocationRows)

  const deletedIds = new Set(deletedSessions.map((session) => session.id))
  const remainingSessions = sessions.filter((session) => !deletedIds.has(session.id))
  const groups = new Map<
    string,
    { period: ShoppingPeriod; sessions: CookSession[] }
  >()

  for (const session of active) {
    if (!DATE_RE.test(session.date)) continue
    let resolution
    try {
      resolution = resolveShoppingPeriodResolution(session.date, settings, lists)
    } catch {
      continue
    }
    if (resolution.conflict) continue
    const group = groups.get(resolution.period.start) ?? {
      period: resolution.period,
      sessions: [],
    }
    group.sessions.push(session)
    groups.set(resolution.period.start, group)
  }

  const removedPurchaseIds = new Set<string>()
  const removedAllocationIds = new Set<string>()
  for (const { period, sessions: groupSessions } of groups.values()) {
    const planned = planDeletedSessionsShoppingCleanup({
      period,
      recipes,
      freeDishes,
      deletedSessions: groupSessions,
      remainingSessions,
      rules,
      quantityCorrections,
      purchases,
      allocations,
    })
    for (const id of planned.removedPurchaseIds) removedPurchaseIds.add(id)
    for (const id of planned.removedAllocationIds) removedAllocationIds.add(id)
  }

  return {
    removedPurchaseIds: Array.from(removedPurchaseIds),
    removedAllocationIds: Array.from(removedAllocationIds),
  }
}

async function deleteCloudDishPlan(
  store: CloudRecordsStore,
  cookSessionId: string,
): Promise<{ deletedMeals: number }> {
  return store.transaction(async (tx) => {
    const sessionRow = tx.get<CookSession>('cookSessions', cookSessionId)
    const session = sessionRow?.data
    const entryRows = tx
      .list<MealPlanEntry>('mealPlans')
      .filter((row) => row.data.cookSessionId === cookSessionId)
    const cleanup = await planCloudShoppingCleanup(tx, session ? [session] : [])

    for (const row of entryRows) {
      tx.remove('mealPlans', row.data.id, row.rev)
    }
    if (sessionRow) tx.remove('cookSessions', cookSessionId, sessionRow.rev)

    const freeDishId =
      session?.freeDishId ??
      entryRows.find((row) => row.data.freeDishId)?.data.freeDishId ??
      null
    if (freeDishId) {
      const freeDish = tx.get<FreeDish>('freeDishes', freeDishId)
      if (freeDish) tx.remove('freeDishes', freeDishId, freeDish.rev)
    }

    for (const id of cleanup.removedPurchaseIds) {
      const row = tx.get<ShoppingPurchase>('shoppingPurchases', id)
      if (row) tx.remove('shoppingPurchases', id, row.rev)
    }
    for (const id of cleanup.removedAllocationIds) {
      const row = tx.get<ShoppingDemandAllocation>('shoppingDemandAllocations', id)
      if (row) tx.remove('shoppingDemandAllocations', id, row.rev)
    }

    const dates = new Set(entryRows.map((row) => row.data.date))
    for (const date of dates) await clearDaySkippedIfEmpty(tx, date)
    return { deletedMeals: entryRows.length }
  })
}

async function removeCloudMealEntry(
  store: CloudRecordsStore,
  id: string,
): Promise<void> {
  await store.transaction(async (tx) => {
    const entry = tx.get<MealPlanEntry>('mealPlans', id)
    if (!entry) return
    tx.remove('mealPlans', id, entry.rev)
    const freeDishId = entry.data.freeDishId
    if (!freeDishId) return

    const remainingMeals = tx
      .list<MealPlanEntry>('mealPlans')
      .filter((row) => row.data.freeDishId === freeDishId).length
    const remainingSessions = tx
      .list<CookSession>('cookSessions')
      .filter((row) => row.data.freeDishId === freeDishId).length
    if (remainingMeals > 0 || remainingSessions > 0) return

    const freeDish = tx.get<FreeDish>('freeDishes', freeDishId)
    if (freeDish) tx.remove('freeDishes', freeDishId, freeDish.rev)
  })
}

async function moveCloudDishPlanInTransaction(
  tx: RecordsTransaction,
  entryId: string,
  targetDate: string,
  options: { allowCookedChange?: boolean } = {},
): Promise<MoveDishPlanResult> {
  if (!isValidDateKey(targetDate)) throw new MealPlanError('Ungültiges Zieldatum.')

  const draggedRow = tx.get<MealPlanEntry>('mealPlans', entryId)
  if (!draggedRow) throw new MealPlanError('Dieser Essenstermin existiert nicht mehr.')
  const dragged = draggedRow.data

  const sessionId = dragged.cookSessionId ?? null
  const sessionRow = sessionId
    ? tx.get<CookSession>('cookSessions', sessionId)
    : undefined
  const session = sessionRow?.data
  if (dragged.date === targetDate) {
    return { moved: false, deltaDays: 0, session, entries: [dragged] }
  }

  const entryRows = tx.list<MealPlanEntry>('mealPlans')
  const linked = sessionId
    ? entryRows.filter((row) => row.data.cookSessionId === sessionId)
    : [draggedRow]
  const rows = linked.some((row) => row.data.id === dragged.id)
    ? linked
    : [...linked, draggedRow]
  const entries = rows.map((row) => row.data)

  const cooked =
    session?.status === 'cooked' ||
    entries.some((entry) => entry.cooked || entry.status === 'eaten')
  if (cooked && !options.allowCookedChange) throw new CookedMoveConflictError()

  const deltaDays = daysBetween(dragged.date, targetDate)
  const nowValue = now()
  const movedEntries = entries
    .map((entry) => ({
      ...entry,
      date: addDays(entry.date, deltaDays),
      updatedAt: nowValue,
    }))
    .sort((a, b) =>
      a.date < b.date ? -1 : a.date > b.date ? 1 : a.id < b.id ? -1 : 1,
    )

  const rowById = new Map(rows.map((row) => [row.data.id, row]))
  for (const entry of movedEntries) {
    const row = rowById.get(entry.id)
    if (row) tx.update('mealPlans', entry.id, entry, row.rev)
    else tx.create('mealPlans', entry.id, entry)
  }

  let updatedSession = session
  if (session && sessionRow) {
    updatedSession = {
      ...session,
      date: movedEntries[0]!.date,
      updatedAt: nowValue,
    }
    tx.update('cookSessions', session.id, updatedSession, sessionRow.rev)
  }

  const newDates = new Set(movedEntries.map((entry) => entry.date))
  for (const date of newDates) await writeDaySkipped(tx, date, false)
  const oldDates = new Set(entries.map((entry) => entry.date))
  for (const date of oldDates) {
    if (!newDates.has(date)) await clearDaySkippedIfEmpty(tx, date)
  }

  return {
    moved: true,
    deltaDays,
    session: updatedSession,
    entries: movedEntries,
  }
}

async function moveCloudDishPlanEntry(
  store: CloudRecordsStore,
  entryId: string,
  targetDate: string,
  options: { allowCookedChange?: boolean } = {},
): Promise<MoveDishPlanResult> {
  return store.transaction((tx) =>
    moveCloudDishPlanInTransaction(tx, entryId, targetDate, options),
  )
}

async function undoCloudDishPlanMove(
  store: CloudRecordsStore,
  input: {
    entryId: string
    originalDate: string
    expected: DishPlanMoveSnapshot
  },
): Promise<MoveDishPlanResult> {
  return store.transaction(async (tx) => {
    if (!isValidDateKey(input.originalDate)) {
      throw new MealPlanError('Ungültiges Zieldatum.')
    }
    const draggedRow = tx.get<MealPlanEntry>('mealPlans', input.entryId)
    if (!draggedRow) throw new DishPlanMoveConflictError()
    const dragged = draggedRow.data

    const sessionId = dragged.cookSessionId ?? null
    if (sessionId !== input.expected.cookSessionId) {
      throw new DishPlanMoveConflictError()
    }
    const entries = sessionId
      ? tx
          .list<MealPlanEntry>('mealPlans')
          .filter((row) => row.data.cookSessionId === sessionId)
          .map((row) => row.data)
      : [dragged]
    const sessionRow = sessionId
      ? tx.get<CookSession>('cookSessions', sessionId)
      : undefined
    if (
      dishPlanMoveSignature(entries, sessionRow?.data ?? null) !==
      input.expected.signature
    ) {
      throw new DishPlanMoveConflictError()
    }

    return moveCloudDishPlanInTransaction(tx, input.entryId, input.originalDate, {
      allowCookedChange: true,
    })
  })
}

async function saveCloudDayNote(
  store: CloudRecordsStore,
  date: string,
  text: string,
): Promise<DayNote | null> {
  if (!isValidDateKey(date)) throw new Error('Ungültiges Datum.')
  const value = normalizeDayNoteText(text)
  return store.transaction(async (tx) => {
    const existing = tx.get<DayNote>('dayNotes', date)
    if (!value) {
      if (existing) tx.remove('dayNotes', date, existing.rev)
      return null
    }
    const nowValue = now()
    const note: DayNote = {
      date,
      text: value,
      createdAt: existing?.data.createdAt ?? nowValue,
      updatedAt: nowValue,
    }
    writeRow(tx, 'dayNotes', date, note, existing)
    return note
  })
}

async function deleteCloudDayNote(
  store: CloudRecordsStore,
  date: string,
): Promise<void> {
  if (!isValidDateKey(date)) throw new Error('Ungültiges Datum.')
  await store.transaction(async (tx) => {
    const existing = tx.get<DayNote>('dayNotes', date)
    if (existing) tx.remove('dayNotes', date, existing.rev)
  })
}

async function moveCloudDayNoteInTransaction(
  tx: RecordsTransaction,
  date: string,
  targetDate: string,
): Promise<DayNote> {
  if (!isValidDateKey(date) || !isValidDateKey(targetDate)) {
    throw new Error('Ungültiges Datum.')
  }
  const noteRow = tx.get<DayNote>('dayNotes', date)
  if (!noteRow) throw new Error('Der Kommentar existiert nicht mehr.')
  if (date === targetDate) return noteRow.data

  if (tx.get<DayNote>('dayNotes', targetDate)) {
    throw new DayNoteMoveConflictError()
  }

  const moved: DayNote = {
    ...noteRow.data,
    date: targetDate,
    updatedAt: now(),
  }
  tx.remove('dayNotes', date, noteRow.rev)
  tx.create('dayNotes', targetDate, moved)
  return moved
}

async function moveCloudDayNote(
  store: CloudRecordsStore,
  date: string,
  targetDate: string,
): Promise<DayNote> {
  return store.transaction((tx) =>
    moveCloudDayNoteInTransaction(tx, date, targetDate),
  )
}

async function undoCloudDayNoteMove(
  store: CloudRecordsStore,
  input: {
    currentDate: string
    originalDate: string
    expected: DayNoteMoveSnapshot
  },
): Promise<DayNote> {
  return store.transaction(async (tx) => {
    if (!isValidDateKey(input.currentDate) || !isValidDateKey(input.originalDate)) {
      throw new Error('Ungültiges Datum.')
    }
    const current = tx.get<DayNote>('dayNotes', input.currentDate)
    if (!current || dayNoteSignature(current.data) !== input.expected.signature) {
      throw new DayNoteMoveConflictError(
        'Rückgängig nicht möglich: Der Kommentar wurde zwischenzeitlich geändert.',
      )
    }
    if (tx.get<DayNote>('dayNotes', input.originalDate)) {
      throw new DayNoteMoveConflictError(
        'Rückgängig nicht möglich: Am ursprünglichen Tag ist inzwischen ein Kommentar vorhanden.',
      )
    }
    return moveCloudDayNoteInTransaction(
      tx,
      input.currentDate,
      input.originalDate,
    )
  })
}

async function saveCloudCalendarSettings(
  store: CloudRecordsStore,
  patch: Partial<CalendarSettings>,
): Promise<CalendarSettings> {
  return store.transaction(async (tx) => {
    const rows = tx.list<SettingRecord>('settings')
    const current = calendarSettingsFromRows(rowsToData(rows))
    const next = normalizeCalendarSettings({ ...current, ...patch })
    const rowByKey = new Map(rows.map((row) => [row.data.key, row]))
    const values: SettingRecord[] = [
      { key: 'weekStartDay', value: next.weekStartDay },
      { key: 'overlapBefore', value: next.overlapBefore },
      { key: 'overlapAfter', value: next.overlapAfter },
    ]
    for (const value of values) {
      writeRow(tx, 'settings', value.key, value, rowByKey.get(value.key))
    }
    // Validate through the same shared normalizer as the local setting.
    return calendarSettingsFromRows(values)
  })
}

async function saveCloudHouseholdSize(
  store: CloudRecordsStore,
  size: number,
): Promise<void> {
  const value = Math.min(
    20,
    Math.max(1, Math.round(Number.isFinite(size) ? size : DEFAULT_HOUSEHOLD_SIZE)),
  )
  await store.transaction(async (tx) => {
    const existing = tx.get<SettingRecord>('settings', 'householdSize')
    const row: SettingRecord = { key: 'householdSize', value }
    writeRow(tx, 'settings', 'householdSize', row, existing)
  })
}

/** Pure snapshot view used by the hook and by tests. */
export function readPlanData(store: CloudRecordsStore): PlanData | undefined {
  if (!store.isLoaded()) return undefined
  return {
    entries: rowsToData(store.list<MealPlanEntry>('mealPlans')),
    recipes: rowsToData(store.list<Recipe>('recipes')),
    freeDishes: rowsToData(store.list<FreeDish>('freeDishes')),
    sessions: rowsToData(store.list<CookSession>('cookSessions')),
    settings: rowsToData(store.list<SettingRecord>('settings')),
    dayNotes: rowsToData(store.list<DayNote>('dayNotes')),
  }
}

function useStoreVersion(store: CloudRecordsStore): number {
  const subscribe = useCallback(
    (onStoreChange: () => void) => store.subscribe(onStoreChange),
    [store],
  )
  const getSnapshot = useCallback(() => store.getVersion(), [store])
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

function CloudPlanRecipeCover({
  store,
  recipe,
  className = '',
}: {
  store: CloudRecordsStore
  recipe: Recipe
  className?: string
}) {
  const images = useCloudRecipeImages(store, recipe.id)
  const cover = images?.[0]
  const url = useCloudImageUrl(cover?.storagePath)
  const initial = recipe.title.trim().charAt(0).toLocaleUpperCase('de') || '?'
  return (
    <span
      className={`plan-cover${url.url ? ' has-image' : ''} ${className}`.trim()}
      aria-hidden="true"
    >
      {url.url ? (
        <img src={url.url} alt="" loading="lazy" decoding="async" />
      ) : (
        <span className="plan-cover-initial">{initial}</span>
      )}
    </span>
  )
}

export function createCloudPlanBackend(store: CloudRecordsStore): PlanBackend {
  return {
    cookModeEnabled: true,
    renderRecipeCover: (recipe, className) => (
      <CloudPlanRecipeCover
        store={store}
        recipe={recipe}
        className={className}
      />
    ),

    usePlanData() {
      const version = useStoreVersion(store)
      return useMemo(() => readPlanData(store), [store, version])
    },

    saveDishPlan: (input) => saveCloudDishPlan(store, input),
    saveFreeDishPlan: (input) => saveCloudFreeDishPlan(store, input),
    deleteDishPlan: (cookSessionId) => deleteCloudDishPlan(store, cookSessionId),
    removeMealEntry: (id) => removeCloudMealEntry(store, id),
    moveDishPlanEntry: (entryId, targetDate, options = {}) =>
      moveCloudDishPlanEntry(store, entryId, targetDate, options),
    undoDishPlanMove: (input) => undoCloudDishPlanMove(store, input),
    moveDayNote: (date, targetDate) => moveCloudDayNote(store, date, targetDate),
    undoDayNoteMove: (input) => undoCloudDayNoteMove(store, input),
    saveDayNote: (date, text) => saveCloudDayNote(store, date, text),
    deleteDayNote: (date) => deleteCloudDayNote(store, date),
    setCalendarSettings: (patch) => saveCloudCalendarSettings(store, patch),
    setHouseholdSize: (size) => saveCloudHouseholdSize(store, size),
  }
}
