/*
 * openCook Web
 * Copyright (C) 2026 openCook Web contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Pure meal-plan rules: portion balance between cooking events and meal
 * appointments, validation and slot metadata. No database or React imports.
 */

import type { CookSession, MealPlanEntry, MealSlot, MealEntryStatus } from '../types'

export const MEAL_SLOTS: readonly MealSlot[] = ['breakfast', 'lunch', 'dinner']

export const MEAL_SLOT_LABELS: Record<MealSlot, string> = {
  breakfast: 'Frühstück',
  lunch: 'Mittagessen',
  dinner: 'Abendessen',
}

export function isMealSlot(value: string): value is MealSlot {
  return (MEAL_SLOTS as readonly string[]).includes(value)
}

export function mealSlotLabel(slot: string): string {
  return isMealSlot(slot) ? MEAL_SLOT_LABELS[slot] : slot
}

export function mealEntryStatus(entry: MealPlanEntry): MealEntryStatus {
  return entry.status ?? (entry.cooked ? 'eaten' : 'planned')
}

export interface PortionsBalance {
  /** Portions the cooking event provides. */
  provided: number
  /** Portions consumed by all linked meal appointments. */
  assigned: number
  /** Still unassigned; never negative silently. */
  remaining: number
  /** True when linked appointments exceed the prepared portions. */
  overAssigned: boolean
}

function positive(value: number | undefined | null): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0
}

export function linkedMealEntries(
  sessionId: string,
  entries: readonly MealPlanEntry[],
): MealPlanEntry[] {
  return entries.filter((entry) => entry.cookSessionId === sessionId)
}

export function cookSessionBalance(
  session: CookSession,
  entries: readonly MealPlanEntry[],
): PortionsBalance {
  const provided = positive(session.servings)
  const assigned = linkedMealEntries(session.id, entries).reduce(
    (sum, entry) => sum + positive(entry.servings),
    0,
  )
  return {
    provided,
    assigned,
    remaining: provided - assigned,
    overAssigned: assigned > provided,
  }
}

/**
 * Available portions for a new/updated appointment. When an existing
 * appointment is edited, its own current portions are ignored so the check
 * answers "can this entry use N portions?".
 */
export function availablePortions(
  session: CookSession,
  entries: readonly MealPlanEntry[],
  excludeEntryId?: string,
): number {
  const provided = positive(session.servings)
  const assigned = linkedMealEntries(session.id, entries)
    .filter((entry) => entry.id !== excludeEntryId)
    .reduce((sum, entry) => sum + positive(entry.servings), 0)
  return Math.max(0, provided - assigned)
}

export interface AssignmentCheck {
  ok: boolean
  available: number
  message?: string
}

export function checkMealAssignment(
  session: CookSession,
  entries: readonly MealPlanEntry[],
  servings: number,
  excludeEntryId?: string,
): AssignmentCheck {
  const available = availablePortions(session, entries, excludeEntryId)
  const wanted = positive(servings)
  if (wanted <= 0) {
    return { ok: false, available, message: 'Bitte eine Portionszahl größer als 0 angeben.' }
  }
  if (wanted > available) {
    return {
      ok: false,
      available,
      message:
        `Für diesen Kochvorgang sind nur noch ${available} von ${positive(session.servings)} Portionen verfügbar. ` +
        `${wanted} Portionen können nicht zugewiesen werden. Reduziere die Portionen oder einen anderen Essenstermin.`,
    }
  }
  return { ok: true, available }
}

export function checkCookServings(
  session: CookSession,
  entries: readonly MealPlanEntry[],
  servings: number,
  excludeEntryId?: string,
): AssignmentCheck {
  const wanted = positive(servings)
  const assigned = linkedMealEntries(session.id, entries)
    .filter((entry) => entry.id !== excludeEntryId)
    .reduce((sum, entry) => sum + positive(entry.servings), 0)
  if (wanted < assigned) {
    return {
      ok: false,
      available: assigned,
      message:
        `Es sind bereits ${assigned} Portionen aus diesem Kochvorgang zugewiesen. ` +
        `Die Kochmenge kann nicht unter ${assigned} Portionen gesetzt werden. ` +
        'Entferne oder reduziere zuerst verknüpfte Essenstermine.',
    }
  }
  if (wanted <= 0) {
    return { ok: false, available: assigned, message: 'Bitte eine Kochmenge größer als 0 angeben.' }
  }
  return { ok: true, available: assigned }
}

/** Manual, pinned, eaten or already cooked entries survive an automatic replan. */
export function isProtectedEntry(
  entry: MealPlanEntry,
  session?: CookSession | null,
): boolean {
  return (
    entry.auto === false ||
    entry.pinned ||
    entry.cooked ||
    mealEntryStatus(entry) === 'eaten' ||
    session?.status === 'cooked'
  )
}

export function sortMealEntries(entries: readonly MealPlanEntry[]): MealPlanEntry[] {
  return [...entries].sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1
    if (a.slot !== b.slot) return a.slot < b.slot ? -1 : 1
    const positionDiff = (a.position ?? 0) - (b.position ?? 0)
    if (positionDiff !== 0) return positionDiff
    return a.createdAt - b.createdAt
  })
}
