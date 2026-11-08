/*
 * openCook Web
 * Copyright (C) 2026 openCook Web contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Date-only helpers for the planner. Everything is stored as a local calendar
 * date ("YYYY-MM-DD"); arithmetic uses UTC midnights so DST changes cannot shift
 * a day. No Date#toISOString() is used for local dates.
 */

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/

export interface DateParts {
  year: number
  month: number
  day: number
}

export function parseDateKey(key: string): DateParts {
  const match = DATE_RE.exec(key)
  if (!match) throw new Error(`Invalid date key: ${key}`)
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    throw new Error(`Invalid date key: ${key}`)
  }
  return { year, month, day }
}

export function dateKey(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/** Today in the device's local timezone, never UTC. */
export function todayKey(now: Date = new Date()): string {
  return dateKey(now.getFullYear(), now.getMonth() + 1, now.getDate())
}

export function addDays(key: string, days: number): string {
  const { year, month, day } = parseDateKey(key)
  const date = new Date(Date.UTC(year, month - 1, day + days))
  return dateKey(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate())
}

/** Days since 1970-01-01 for a calendar date (UTC, no time component). */
export function dayNumber(key: string): number {
  const { year, month, day } = parseDateKey(key)
  return Math.floor(Date.UTC(year, month - 1, day) / 86_400_000)
}

export function daysBetween(from: string, to: string): number {
  return dayNumber(to) - dayNumber(from)
}

/** 0 = Monday … 6 = Sunday. */
export function weekdayIndex(key: string): number {
  const { year, month, day } = parseDateKey(key)
  return (new Date(Date.UTC(year, month - 1, day)).getUTCDay() + 6) % 7
}

export function isWeekend(key: string): boolean {
  return weekdayIndex(key) >= 5
}

export const WEEKDAY_NAMES = [
  'Montag',
  'Dienstag',
  'Mittwoch',
  'Donnerstag',
  'Freitag',
  'Samstag',
  'Sonntag',
] as const

/** Normalise a weekday number to 0 = Monday … 6 = Sunday. */
export function normalizeWeekday(value: number): number {
  if (!Number.isFinite(value)) return 0
  return ((Math.round(value) % 7) + 7) % 7
}

export function weekdayName(index: number): string {
  return WEEKDAY_NAMES[normalizeWeekday(index)] ?? WEEKDAY_NAMES[0]
}

/**
 * First day of the week containing [key].
 * `weekStartDay`: 0 = Monday … 6 = Sunday. No weekday is special-cased.
 */
export function startOfWeekOn(key: string, weekStartDay: number): string {
  const start = normalizeWeekday(weekStartDay)
  const diff = (weekdayIndex(key) - start + 7) % 7
  return addDays(key, -diff)
}

/** Monday of the week containing [key]; kept for existing Monday-based callers. */
export function startOfWeek(key: string): string {
  return startOfWeekOn(key, 0)
}

/** Seven days starting at [weekStartDay] for the week containing [today]. */
export function currentWeek(today: string = todayKey(), weekStartDay = 0): string[] {
  const start = startOfWeekOn(today, weekStartDay)
  return Array.from({ length: 7 }, (_, index) => addDays(start, index))
}

/** Today and the remaining days of the configured week. */
export function planningDays(today: string = todayKey(), weekStartDay = 0): string[] {
  const days = currentWeek(today, weekStartDay)
  return days.filter((day) => daysBetween(today, day) >= 0)
}

const WEEKDAY_SHORT = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So']

export function weekdayShort(key: string): string {
  return WEEKDAY_SHORT[weekdayIndex(key)] ?? ''
}

export function formatDayLabel(key: string): string {
  const { day, month } = parseDateKey(key)
  return `${weekdayShort(key)}, ${String(day).padStart(2, '0')}.${String(month).padStart(2, '0')}.`
}

export function formatWeekRange(start: string): string {
  const end = addDays(start, 6)
  const a = parseDateKey(start)
  const b = parseDateKey(end)
  const left = `${String(a.day).padStart(2, '0')}.${String(a.month).padStart(2, '0')}.`
  const right = `${String(b.day).padStart(2, '0')}.${String(b.month).padStart(2, '0')}.${b.year}`
  return `${left} – ${right}`
}
