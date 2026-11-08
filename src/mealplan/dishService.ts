/*
 * openCook Web
 * Copyright (C) 2026 openCook Web contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Transactional service for dishes planned across one or several days. The
 * existing model is reused unchanged: one `CookSession` owns the total cooking
 * quantity, one `MealPlanEntry` per day links back to it.
 */

import { db } from '../db'
import { addDays, daysBetween } from '../domain/dates'
import {
  cookedRedefinition,
  DEFAULT_PLAN_SLOT,
  isValidDateKey,
  normalizeDayServings,
  planDayTotal,
} from '../domain/dishplan'
import { resolveOriginalServings } from '../domain/scaling'
import { randomId } from '../lib/id'
import type {
  CookSession,
  CookSessionStatus,
  DishKind,
  MealPlanEntry,
  Recipe,
} from '../types'
import { MealPlanError } from './service'

export class CookedPlanConflictError extends MealPlanError {
  readonly totalServings: number
  readonly cookedServings: number

  constructor(totalServings: number, cookedServings: number) {
    super(
      `Dieses Gericht ist bereits gekocht (${cookedServings} Portionen). ` +
        `Die neue Planung ergibt ${totalServings} Portionen.`,
    )
    this.name = 'CookedPlanConflictError'
    this.totalServings = totalServings
    this.cookedServings = cookedServings
  }
}

/**
 * Moving an already cooked dish changes its historical cooking date. The caller
 * must confirm that explicitly; a normal move never asks.
 */
export class CookedMoveConflictError extends MealPlanError {
  constructor() {
    super(
      'Dieses Gericht ist bereits gekocht. Das Verschieben ändert den historischen Kochtag.',
    )
    this.name = 'CookedMoveConflictError'
  }
}

export interface SaveDishPlanDay {
  /** Existing appointment id when this day is edited; absent for a new day. */
  entryId?: string
  date: string
  servings: number
}

export interface SaveDishPlanInput {
  /** Existing cooking event; absent for a new dish. */
  cookSessionId?: string | null
  recipeId: string
  /**
   * Internal fallback slot. New manual dishes use the shared default; existing
   * days keep their legacy slot because the user never sees this field.
   */
  slot?: string
  days: SaveDishPlanDay[]
  /** Cooking status of the whole dish. Daily appointment statuses are kept. */
  cookStatus?: CookSessionStatus
  auto?: boolean
  /** Set only after the user explicitly confirmed redefining a cooked amount. */
  allowCookedChange?: boolean
  /** User correction when the recipe has no usable original serving count. */
  originalServings?: number | null
}

export interface SaveDishPlanResult {
  session: CookSession
  entries: MealPlanEntry[]
}

function now(): number {
  return Date.now()
}

async function writeDaySkipped(date: string, skipped: boolean): Promise<void> {
  const existing = await db.mealDays.get(date)
  await db.mealDays.put({
    date,
    skipped,
    createdAt: existing?.createdAt ?? now(),
    updatedAt: now(),
  })
}

async function clearDaySkippedIfEmpty(date: string): Promise<void> {
  if ((await db.mealPlans.where('date').equals(date).count()) > 0) return
  const day = await db.mealDays.get(date)
  if (day?.skipped) await writeDaySkipped(date, false)
}

function correctionValue(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.round(value * 10) / 10
    : null
}

interface ConnectedDishIdentity {
  kind: DishKind
  recipeId: string | null
  freeDishId: string | null
}

export interface PersistDishPlanOptions {
  identity: ConnectedDishIdentity
  days: SaveDishPlanDay[]
  cookSessionId?: string | null
  slot?: string
  cookStatus?: CookSessionStatus
  auto?: boolean
  allowCookedChange?: boolean
  /** Runs inside the transaction before any existing row is removed. */
  prepare?: (nowValue: number) => Promise<void>
  /** Runs inside the transaction after the cooking event and days are written. */
  afterPersist?: (
    session: CookSession,
    entries: MealPlanEntry[],
    nowValue: number,
  ) => Promise<void>
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

/**
 * Shared transaction for every connected dish, independent of whether its
 * content comes from the recipe library or from a plan-only free dish. Every
 * day keeps its own eater count; the cooking quantity is always the sum of all
 * days, so a repeated save of the same appointment ids cannot duplicate rows.
 */
export async function persistDishPlan(
  options: PersistDishPlanOptions,
): Promise<SaveDishPlanResult> {
  const normalizedDays = normalizePlanDays(options.days)
  if (!options.identity.recipeId && !options.identity.freeDishId) {
    throw new MealPlanError('Dieses Gericht hat keine gültige Grundlage.')
  }
  const defaultSlot = options.slot?.trim() || DEFAULT_PLAN_SLOT

  return db.transaction(
    'rw',
    [db.recipes, db.mealPlans, db.cookSessions, db.mealDays, db.freeDishes],
    async () => {
      if (options.prepare) await options.prepare(now())

      const nowValue = now()
      const allEntries = await db.mealPlans.toArray()
      const session = options.cookSessionId
        ? await db.cookSessions.get(options.cookSessionId)
        : undefined
      if (options.cookSessionId && !session) {
        throw new MealPlanError('Dieses Gericht existiert nicht mehr.')
      }
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
        (await db.cookSessions.toArray()).map((candidate) => candidate.id),
      )

      // Resolve existing rows before deleting anything, so editing by date also
      // keeps ids stable when the caller does not send them.
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
              // A missing cooking event is an old broken link, not another
              // dish: adopting it repairs the entry instead of blocking edits.
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
      if (removed.length > 0) {
        await db.mealPlans.bulkDelete(removed.map((entry) => entry.id))
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

      await db.cookSessions.put(updatedSession)
      await db.mealPlans.bulkPut(entries)

      if (options.afterPersist) {
        await options.afterPersist(updatedSession, entries, nowValue)
      }

      const newDates = new Set(entries.map((entry) => entry.date))
      for (const date of newDates) await writeDaySkipped(date, false)
      const touchedDates = new Set([
        ...linked.map((entry) => entry.date),
        ...entries.map((entry) => entry.date),
      ])
      for (const date of touchedDates) {
        if (!newDates.has(date)) await clearDaySkippedIfEmpty(date)
      }

      return { session: updatedSession, entries }
    },
  )
}

/**
 * Create or update a connected library dish. The recipe is read-only except
 * for the optional explicit original-portion correction.
 */
export async function saveDishPlan(input: SaveDishPlanInput): Promise<SaveDishPlanResult> {
  let recipe: Recipe | undefined
  return persistDishPlan({
    identity: { kind: 'recipe', recipeId: input.recipeId, freeDishId: null },
    days: input.days,
    cookSessionId: input.cookSessionId,
    slot: input.slot,
    cookStatus: input.cookStatus,
    auto: input.auto,
    allowCookedChange: input.allowCookedChange,
    prepare: async () => {
      recipe = await db.recipes.get(input.recipeId)
      if (!recipe) throw new MealPlanError('Das gewählte Rezept existiert nicht mehr.')
    },
    afterPersist: async (_session, _entries, nowValue) => {
      const corrected = correctionValue(input.originalServings)
      if (corrected !== null && recipe && !resolveOriginalServings(recipe)) {
        const updatedRecipe: Recipe = {
          ...recipe,
          servingsNumber: corrected,
          updatedAt: nowValue,
        }
        await db.recipes.put(updatedRecipe)
      }
    },
  })
}

export interface MoveDishPlanResult {
  moved: boolean
  deltaDays: number
  session?: CookSession
  entries: MealPlanEntry[]
}

export class DishPlanMoveConflictError extends MealPlanError {
  constructor(
    message = 'Rückgängig nicht möglich: Die Planung wurde zwischenzeitlich geändert.',
  ) {
    super(message)
    this.name = 'DishPlanMoveConflictError'
  }
}

export interface DishPlanMoveSnapshot {
  cookSessionId: string | null
  signature: string
}

function canonicalMoveEntry(entry: MealPlanEntry) {
  return {
    id: entry.id,
    date: entry.date,
    slot: entry.slot,
    recipeId: entry.recipeId,
    freeDishId: entry.freeDishId ?? null,
    servings: entry.servings ?? null,
    position: entry.position ?? null,
    cookSessionId: entry.cookSessionId ?? null,
    status: entry.status ?? null,
    auto: entry.auto,
    pinned: entry.pinned,
    leftover: entry.leftover,
    cooked: entry.cooked,
  }
}

/**
 * Stable signature of one connected dish after a move. Undo compares it before
 * changing anything, so a later edit of the same group can never be overwritten.
 */
export function dishPlanMoveSignature(
  entries: readonly MealPlanEntry[],
  session?: CookSession | null,
): string {
  const ordered = [...entries]
    .map(canonicalMoveEntry)
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  const sessionValue = session
    ? {
        id: session.id,
        recipeId: session.recipeId,
        freeDishId: session.freeDishId ?? null,
        date: session.date,
        servings: session.servings,
        status: session.status,
        auto: session.auto,
      }
    : null
  return JSON.stringify({ entries: ordered, session: sessionValue })
}

async function moveDishPlanInTransaction(
  entryId: string,
  targetDate: string,
  options: { allowCookedChange?: boolean } = {},
): Promise<MoveDishPlanResult> {
  if (!isValidDateKey(targetDate)) throw new MealPlanError('Ungültiges Zieldatum.')

  const dragged = await db.mealPlans.get(entryId)
  if (!dragged) throw new MealPlanError('Dieser Essenstermin existiert nicht mehr.')

  const sessionId = dragged.cookSessionId ?? null
  const session = sessionId ? await db.cookSessions.get(sessionId) : undefined
  if (dragged.date === targetDate) {
    return { moved: false, deltaDays: 0, session, entries: [dragged] }
  }

  const linked = sessionId
    ? await db.mealPlans.where('cookSessionId').equals(sessionId).toArray()
    : [dragged]
  const entries = linked.some((entry) => entry.id === dragged.id)
    ? linked
    : [...linked, dragged]

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

  await db.mealPlans.bulkPut(movedEntries)

  let updatedSession = session
  if (session) {
    // One cooking event always starts on its earliest planned day.
    updatedSession = {
      ...session,
      date: movedEntries[0]!.date,
      updatedAt: nowValue,
    }
    await db.cookSessions.put(updatedSession)
  }

  const newDates = new Set(movedEntries.map((entry) => entry.date))
  for (const date of newDates) await writeDaySkipped(date, false)
  const oldDates = new Set(entries.map((entry) => entry.date))
  for (const date of oldDates) {
    if (!newDates.has(date)) await clearDaySkippedIfEmpty(date)
  }

  return {
    moved: true,
    deltaDays,
    session: updatedSession,
    entries: movedEntries,
  }
}

/**
 * Move one meal appointment and every appointment sharing its `cookSessionId`
 * by the same date difference. The dragged date is the anchor, so gaps between
 * non-consecutive days stay exactly as they are. IDs, portions, status and the
 * cooking quantity are never rewritten; only dates and timestamps move.
 */
export async function moveDishPlanEntry(
  entryId: string,
  targetDate: string,
  options: { allowCookedChange?: boolean } = {},
): Promise<MoveDishPlanResult> {
  return db.transaction(
    'rw',
    [db.mealPlans, db.cookSessions, db.mealDays],
    () => moveDishPlanInTransaction(entryId, targetDate, options),
  )
}

/**
 * Undo the last move without creating a parallel plan. The expected signature
 * was captured immediately after the move; if the same group changed since
 * then, nothing is written and the caller receives a conflict.
 */
export async function undoDishPlanMove(input: {
  entryId: string
  originalDate: string
  expected: DishPlanMoveSnapshot
}): Promise<MoveDishPlanResult> {
  return db.transaction(
    'rw',
    [db.mealPlans, db.cookSessions, db.mealDays],
    async () => {
      if (!isValidDateKey(input.originalDate)) {
        throw new MealPlanError('Ungültiges Zieldatum.')
      }
      const dragged = await db.mealPlans.get(input.entryId)
      if (!dragged) throw new DishPlanMoveConflictError()

      const sessionId = dragged.cookSessionId ?? null
      if (sessionId !== input.expected.cookSessionId) {
        throw new DishPlanMoveConflictError()
      }
      const entries = sessionId
        ? await db.mealPlans.where('cookSessionId').equals(sessionId).toArray()
        : [dragged]
      const session = sessionId ? await db.cookSessions.get(sessionId) : undefined
      if (dishPlanMoveSignature(entries, session) !== input.expected.signature) {
        throw new DishPlanMoveConflictError()
      }

      return moveDishPlanInTransaction(input.entryId, input.originalDate, {
        allowCookedChange: true,
      })
    },
  )
}

/** Mark the whole dish as cooked / planned. Day statuses stay untouched. */
export async function setDishPlanCooked(
  cookSessionId: string,
  cooked: boolean,
): Promise<CookSession> {
  return db.transaction('rw', db.cookSessions, async () => {
    const session = await db.cookSessions.get(cookSessionId)
    if (!session) throw new MealPlanError('Dieses Gericht existiert nicht mehr.')
    const updated: CookSession = {
      ...session,
      status: cooked ? 'cooked' : 'planned',
      auto: false,
      updatedAt: now(),
    }
    await db.cookSessions.put(updated)
    return updated
  })
}

/**
 * Remove a complete connected dish: all its days, the cooking event and, for a
 * free dish, its plan-only ingredient snapshot. Other meals, notes and recipes
 * are untouched and no orphaned free-dish row remains.
 */
export async function deleteDishPlan(
  cookSessionId: string,
): Promise<{ deletedMeals: number }> {
  return db.transaction(
    'rw',
    [db.mealPlans, db.cookSessions, db.mealDays, db.freeDishes, db.cookProgress],
    async () => {
      const session = await db.cookSessions.get(cookSessionId)
      const entries = await db.mealPlans
        .where('cookSessionId')
        .equals(cookSessionId)
        .toArray()
      if (entries.length > 0) {
        await db.mealPlans.bulkDelete(entries.map((entry) => entry.id))
      }
      await db.cookSessions.delete(cookSessionId)
      await db.cookProgress.delete(cookSessionId)
      const freeDishId =
        session?.freeDishId ??
        entries.find((entry) => entry.freeDishId)?.freeDishId ??
        null
      if (freeDishId) await db.freeDishes.delete(freeDishId)
      const dates = new Set(entries.map((entry) => entry.date))
      for (const date of dates) await clearDaySkippedIfEmpty(date)
      return { deletedMeals: entries.length }
    },
  )
}
