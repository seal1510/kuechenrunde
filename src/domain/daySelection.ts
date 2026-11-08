/*
 * openCook Web
 * Copyright (C) 2026 openCook Web contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Pure selection model for the planning dialog. A day is selected with one
 * click, deselected with another, and the selection is independent of the
 * week currently shown in the dialog. No React or database imports.
 */

import {
  DEFAULT_DAY_SERVINGS,
  planDayTotal,
  type PlanDayDraft,
} from './dishplan'
import {
  addDays,
  parseDateKey,
  startOfWeekOn,
  weekdayShort,
} from './dates'
import type { MealPlanEntry } from '../types'

export const MIN_DAY_SERVINGS = 1
export const MAX_DAY_SERVINGS = 99

export interface SelectedDay {
  date: string
  servings: number
  /** Existing appointment when this day was already planned. */
  entryId?: string
}

export interface DaySelection {
  /** Always chronologically sorted and free of duplicate dates. */
  days: SelectedDay[]
  /**
   * Existing appointment ids are remembered per date, so deselecting and
   * reselecting a day inside the dialog reuses its row instead of orphaning it.
   */
  entryIdsByDate: Readonly<Record<string, string>>
}

export interface DayChoice {
  date: string
  weekday: string
  day: number
  month: number
  selected: boolean
}

function compareByDate(a: { date: string }, b: { date: string }): number {
  return a.date < b.date ? -1 : a.date > b.date ? 1 : 0
}

export function clampDayServings(value: number): number {
  if (!Number.isFinite(value)) return MIN_DAY_SERVINGS
  return Math.max(
    MIN_DAY_SERVINGS,
    Math.min(MAX_DAY_SERVINGS, Math.round(value)),
  )
}

function normalize(state: DaySelection): DaySelection {
  const seen = new Set<string>()
  const days = [...state.days]
    .sort(compareByDate)
    .filter((day) => {
      if (seen.has(day.date)) return false
      seen.add(day.date)
      return true
    })
  return { ...state, days }
}

/**
 * Initial state for the dialog. Creating starts with exactly the clicked day;
 * editing starts with every stored day of the connected dish.
 */
export function createDaySelection(
  initialEntries: readonly MealPlanEntry[],
  initialDate: string,
): DaySelection {
  const entryIdsByDate: Record<string, string> = {}
  const days: SelectedDay[] = []

  for (const entry of [...initialEntries].sort(compareByDate)) {
    if (days.some((day) => day.date === entry.date)) continue
    entryIdsByDate[entry.date] = entry.id
    days.push({
      date: entry.date,
      servings: clampDayServings(entry.servings ?? DEFAULT_DAY_SERVINGS),
      entryId: entry.id,
    })
  }

  if (days.length === 0) {
    days.push({ date: initialDate, servings: DEFAULT_DAY_SERVINGS })
  }

  return normalize({ days, entryIdsByDate })
}

export function isDaySelected(selection: DaySelection, date: string): boolean {
  return selection.days.some((day) => day.date === date)
}

/** One click selects a day immediately; clicking it again deselects it. */
export function toggleDay(selection: DaySelection, date: string): DaySelection {
  if (isDaySelected(selection, date)) {
    return normalize({
      ...selection,
      days: selection.days.filter((day) => day.date !== date),
    })
  }

  const entryId = selection.entryIdsByDate[date]
  const day: SelectedDay = {
    date,
    servings: DEFAULT_DAY_SERVINGS,
    ...(entryId ? { entryId } : {}),
  }
  return normalize({ ...selection, days: [...selection.days, day] })
}

export function setDayServings(
  selection: DaySelection,
  date: string,
  servings: number,
): DaySelection {
  return normalize({
    ...selection,
    days: selection.days.map((day) =>
      day.date === date
        ? { ...day, servings: clampDayServings(servings) }
        : day,
    ),
  })
}

export function adjustDayServings(
  selection: DaySelection,
  date: string,
  delta: number,
): DaySelection {
  const day = selection.days.find((candidate) => candidate.date === date)
  if (!day) return selection
  return setDayServings(selection, date, day.servings + delta)
}

export function selectedDates(selection: DaySelection): string[] {
  return selection.days.map((day) => day.date)
}

/** Total cooking quantity is the sum of all selected day portions. */
export function selectionTotal(selection: DaySelection): number {
  return planDayTotal(selection.days)
}

/** At least one day is required; duplicates and invalid portions never pass. */
export function isSelectionValid(selection: DaySelection): boolean {
  const dates = new Set(selection.days.map((day) => day.date))
  return (
    selection.days.length > 0 &&
    dates.size === selection.days.length &&
    selection.days.every(
      (day) =>
        Number.isFinite(day.servings) &&
        day.servings >= MIN_DAY_SERVINGS &&
        day.servings <= MAX_DAY_SERVINGS,
    )
  )
}

/** Convert the dialog state into the service input without changing dates. */
export function toPlanDays(selection: DaySelection): PlanDayDraft[] {
  return [...selection.days].sort(compareByDate).map((day) => ({
    entryId: day.entryId,
    date: day.date,
    servings: day.servings,
  }))
}

export function weekStartFor(date: string, weekStartDay: number): string {
  return startOfWeekOn(date, weekStartDay)
}

export function shiftWeekStart(weekStart: string, weeks: number): string {
  return addDays(weekStart, weeks * 7)
}

/**
 * Seven consecutive days for the week grid. Selection flags come from the
 * whole selection, not from the displayed week, so other weeks stay selected.
 */
export function dayChoicesForWeek(
  weekStart: string,
  selection: DaySelection,
): DayChoice[] {
  return Array.from({ length: 7 }, (_, index) => {
    const date = addDays(weekStart, index)
    const { day, month } = parseDateKey(date)
    return {
      date,
      weekday: weekdayShort(date),
      day,
      month,
      selected: isDaySelected(selection, date),
    }
  })
}
