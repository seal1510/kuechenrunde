/*
 * openCook Web
 * Copyright (C) 2026 openCook Web contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Presentation model for the day-based meal calendar. Every day has exactly
 * one add action; legacy meal slots are not surfaced as separate surfaces.
 * The visible window is a configurable seven-day core week plus optional
 * overlap days before and after it.
 */

import type { MealPlanEntry } from '../types'
import { addDays, startOfWeekOn } from './dates'

/** Thursday (0 = Monday … 6 = Sunday) is the private app default. */
export const DEFAULT_WEEK_START_DAY = 3
export const DEFAULT_OVERLAP_BEFORE = 2
export const DEFAULT_OVERLAP_AFTER = 2
export const MIN_OVERLAP_DAYS = 0
export const MAX_OVERLAP_DAYS = 7

export interface CalendarSettings {
  weekStartDay: number
  overlapBefore: number
  overlapAfter: number
}

export function normalizeWeekStartDay(value: number | null | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DEFAULT_WEEK_START_DAY
  }
  return ((Math.round(value) % 7) + 7) % 7
}

export function normalizeOverlapDays(
  value: number | null | undefined,
  fallback: number,
): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.max(MIN_OVERLAP_DAYS, Math.min(MAX_OVERLAP_DAYS, Math.round(value)))
}

export function normalizeCalendarSettings(
  value: Partial<CalendarSettings> = {},
): CalendarSettings {
  return {
    weekStartDay: normalizeWeekStartDay(value.weekStartDay),
    overlapBefore: normalizeOverlapDays(value.overlapBefore, DEFAULT_OVERLAP_BEFORE),
    overlapAfter: normalizeOverlapDays(value.overlapAfter, DEFAULT_OVERLAP_AFTER),
  }
}

export interface CalendarWindow {
  coreStart: string
  coreEnd: string
  /** Exactly seven days, starting at the configured weekday. */
  coreDays: string[]
  beforeDays: string[]
  afterDays: string[]
  visibleDays: string[]
}

/**
 * Build the visible calendar window around [anchor]. The core week always has
 * seven days; overlap days are optional and fully usable additional days.
 */
export function buildCalendarWindow(
  anchor: string,
  weekStartDay: number,
  overlapBefore: number,
  overlapAfter: number,
): CalendarWindow {
  const before = normalizeOverlapDays(overlapBefore, DEFAULT_OVERLAP_BEFORE)
  const after = normalizeOverlapDays(overlapAfter, DEFAULT_OVERLAP_AFTER)
  const coreStart = startOfWeekOn(anchor, weekStartDay)
  const coreDays = Array.from({ length: 7 }, (_, index) => addDays(coreStart, index))
  const beforeDays = Array.from({ length: before }, (_, index) =>
    addDays(coreStart, index - before),
  )
  const afterDays = Array.from({ length: after }, (_, index) =>
    addDays(coreStart, 7 + index),
  )
  return {
    coreStart,
    coreEnd: coreDays[6]!,
    coreDays,
    beforeDays,
    afterDays,
    visibleDays: [...beforeDays, ...coreDays, ...afterDays],
  }
}

export interface CalendarDay {
  date: string
  /** All dishes of that day, independent of their legacy internal slot. */
  entries: MealPlanEntry[]
  empty: boolean
  /** Exactly one add action per day, whether empty or occupied. */
  addActions: number
  /** False for overlap days before/after the seven-day core week. */
  core: boolean
}

function compareDayEntries(a: MealPlanEntry, b: MealPlanEntry): number {
  const position = (a.position ?? 0) - (b.position ?? 0)
  if (position !== 0) return position
  if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

export function planEntriesForDay(
  entries: readonly MealPlanEntry[],
  date: string,
): MealPlanEntry[] {
  return entries.filter((entry) => entry.date === date).sort(compareDayEntries)
}

/**
 * Build the visible day cells. Legacy entries in breakfast/lunch/dinner are
 * treated exactly like any other dish of their day.
 */
export function buildCalendarDays(
  dates: readonly string[],
  entries: readonly MealPlanEntry[],
  coreDates?: ReadonlySet<string>,
): CalendarDay[] {
  return dates.map((date) => {
    const dayEntries = planEntriesForDay(entries, date)
    return {
      date,
      entries: dayEntries,
      empty: dayEntries.length === 0,
      addActions: 1,
      core: coreDates ? coreDates.has(date) : true,
    }
  })
}

export function totalAddActions(days: readonly CalendarDay[]): number {
  return days.reduce((total, day) => total + day.addActions, 0)
}

/**
 * Render model for the calendar surface. The seven core days are always kept
 * apart from the optional overlap rows, so the week can never be squeezed by
 * the additional days.
 */
export interface CalendarLayout {
  before: CalendarDay[]
  main: CalendarDay[]
  after: CalendarDay[]
}

export function buildCalendarLayout(
  window: CalendarWindow,
  entries: readonly MealPlanEntry[],
): CalendarLayout {
  const coreDates = new Set(window.coreDays)
  return {
    before: buildCalendarDays(window.beforeDays, entries, coreDates),
    main: buildCalendarDays(window.coreDays, entries, coreDates),
    after: buildCalendarDays(window.afterDays, entries, coreDates),
  }
}
