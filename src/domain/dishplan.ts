/*
 * openCook Web
 * Copyright (C) 2026 openCook Web contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Pure rules for a dish planned over several days. One cooking event
 * (`CookSession`) provides the sum of all daily portions; every day is one
 * `MealPlanEntry` linked to that event. No database or React imports.
 */

import type { CookSession, MealPlanEntry, Recipe } from '../types'
import { addDays, parseDateKey } from './dates'
import { resolveOriginalServings, scaleRecipeIngredients, type RecipeScaleResult } from './scaling'

/** Convenience default for a new day row; every day is editable on its own. */
export const DEFAULT_DAY_SERVINGS = 2

/**
 * Internal slot for new manual dishes. The user never sees or chooses it; the
 * value keeps the existing automatic planner and old slot-based data working.
 */
export const DEFAULT_PLAN_SLOT = 'dinner'

export interface PlanDayValue {
  date: string
  servings: number
}

export interface PlanDayDraft extends PlanDayValue {
  /** Existing appointment when editing; absent for a newly added day. */
  entryId?: string
}

export function isValidDateKey(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  try {
    parseDateKey(value)
    return true
  } catch {
    return false
  }
}

/** Daily eaters are portions. Only positive, readable values are accepted. */
export function normalizeDayServings(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error('Bitte eine Portionszahl größer als 0 angeben.')
  }
  const rounded = Math.round(value * 10) / 10
  if (rounded <= 0) throw new Error('Bitte eine Portionszahl größer als 0 angeben.')
  return rounded
}

/** Total cooking quantity: the sum of all planned daily portions. */
export function planDayTotal(days: readonly PlanDayValue[]): number {
  const sum = days.reduce((total, day) => {
    const value = Number.isFinite(day.servings) && day.servings > 0 ? day.servings : 0
    return total + value
  }, 0)
  return Math.round(sum * 10) / 10
}

export function distinctPlanDates(days: readonly PlanDayValue[]): string[] {
  return Array.from(new Set(days.map((day) => day.date))).sort()
}

/** Consecutive local dates starting at [start]. */
export function consecutiveDates(start: string, count: number): string[] {
  const length = Math.max(1, Math.floor(count))
  return Array.from({ length }, (_, index) => addDays(start, index))
}

/** All dates linked to one cooking event, without duplicates. */
export function groupDates(
  entries: readonly MealPlanEntry[],
  cookSessionId: string | null | undefined,
): string[] {
  if (!cookSessionId) return []
  return Array.from(
    new Set(
      entries
        .filter((entry) => entry.cookSessionId === cookSessionId)
        .map((entry) => entry.date),
    ),
  ).sort()
}

export function groupSize(
  entries: readonly MealPlanEntry[],
  cookSessionId: string | null | undefined,
): number {
  return groupDates(entries, cookSessionId).length
}

/** Subtle label for a connected dish, e.g. "3 Tage". */
export function groupLabel(dayCount: number): string | null {
  return dayCount > 1 ? `${dayCount} Tage` : null
}

/** Existing appointments of one dish, sorted by date. */
export function groupEntries(
  entries: readonly MealPlanEntry[],
  cookSessionId: string | null | undefined,
): MealPlanEntry[] {
  if (!cookSessionId) return []
  return entries
    .filter((entry) => entry.cookSessionId === cookSessionId)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
}

/** Shift a whole dish while keeping gaps between individually removed days. */
export function shiftPlanDays(days: readonly PlanDayDraft[], deltaDays: number): PlanDayDraft[] {
  if (deltaDays === 0) return [...days]
  return days.map((day) => ({ ...day, date: addDays(day.date, deltaDays) }))
}

export interface CookedRedefinition {
  totalServings: number
  cookedServings: number
  message: string
}

/**
 * A cooked amount is a fact. Changing the planned days would silently
 * redefine it, so the caller must ask explicitly before saving.
 */
export function cookedRedefinition(
  session: CookSession | null | undefined,
  days: readonly PlanDayValue[],
): CookedRedefinition | null {
  if (!session || session.status !== 'cooked') return null
  const total = planDayTotal(days)
  if (total === session.servings) return null
  return {
    totalServings: total,
    cookedServings: session.servings,
    message:
      `Dieses Gericht ist bereits gekocht (${session.servings} Portionen). ` +
      `Die neue Planung ergibt ${total} Portionen.`,
  }
}

export interface PlanScale {
  originalServings: number | null
  totalServings: number
  scaling: RecipeScaleResult
}

/**
 * Scale the recipe for the sum of all day portions. The original recipe is
 * read-only; a missing original serving count may be corrected by the user.
 */
export function scalePlan(
  recipe: Recipe,
  days: readonly PlanDayValue[],
  originalOverride?: number | null,
): PlanScale {
  const fromRecipe = resolveOriginalServings(recipe)
  const override =
    typeof originalOverride === 'number' && Number.isFinite(originalOverride) && originalOverride > 0
      ? originalOverride
      : null
  const originalServings = fromRecipe ?? override
  const totalServings = planDayTotal(days)
  return {
    originalServings,
    totalServings,
    scaling: scaleRecipeIngredients(recipe.ingredients, originalServings, totalServings),
  }
}
