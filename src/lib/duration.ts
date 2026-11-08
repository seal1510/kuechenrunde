/*
 * openCook Web
 * Copyright (C) 2026 openCook Web contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Shared duration normalisation for recipe display and the meal planner.
 *
 * Mela files are not consistent: the same field can contain an ISO-8601
 * duration ("PT1H30M"), a German human value ("1 Std. 30 Min."), a range
 * ("2-4 Stunden") or a mixed fraction ("6 1/2 - 7 Stunden"). The original
 * string is always kept in the database; this module only provides a safe
 * interpretation for rendering and for the planner's time-fit heuristic.
 */

export type ParsedDuration =
  | { kind: 'single'; minutes: number }
  | { kind: 'range'; minMinutes: number; maxMinutes: number }

const VULGAR_FRACTIONS: Record<string, string> = {
  '¼': '1/4',
  '½': '1/2',
  '¾': '3/4',
  '⅓': '1/3',
  '⅔': '2/3',
  '⅛': '1/8',
  '⅜': '3/8',
  '⅝': '5/8',
  '⅞': '7/8',
}

/** Normalise dashes, no-break spaces and vulgar fractions for parsing. */
function normalize(value: string): string {
  return value
    .replace(/[¼½¾⅓⅔⅛⅜⅝⅞]/g, (fraction) => ` ${VULGAR_FRACTIONS[fraction] ?? fraction}`)
    .replace(/[\u2010-\u2015\u2212]/g, '-')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

const NUMBER = String.raw`\d+(?:[.,]\d+)?`
const FRACTION = String.raw`\d+\s*\/\s*\d+`
const AMOUNT = String.raw`(?:${NUMBER}\s+${FRACTION}|${FRACTION}|${NUMBER})`
const UNIT = String.raw`(?:stunden?|std\.?|hrs?|hours?|hour|minuten?|mins?|minutes?|minute|min\.?|h|m)`
const UNIT_END = String.raw`(?=$|[\s,;.)])`

const ISO_DURATION =
  /^P(?:(\d+(?:[.,]\d+)?)D)?(?:T(?:(\d+(?:[.,]\d+)?)H)?(?:(\d+(?:[.,]\d+)?)M)?(?:(\d+(?:[.,]\d+)?)S)?)?$/i

const CLOCK = /(?:^|[\s(])(\d{1,2}):(\d{2})(?::(\d{2}))?(?=$|[\s,;.)])/

const RANGE =
  new RegExp(
    String.raw`(?:^|[\s(])(?:(?:ca|etwa|zirka|rund|circa|approximately|approx)\.?\s*)?` +
      `(${AMOUNT})\\s*(?:(${UNIT})${UNIT_END}\\s*)?(?:-|bis)\\s*` +
      `(${AMOUNT})\\s*(${UNIT})${UNIT_END}`,
    'i',
  )

const SINGLE = new RegExp(`(${AMOUNT})\\s*(${UNIT})${UNIT_END}`, 'gi')

function parseAmount(text: string): number | null {
  const value = text.trim()
  const mixed = /^(\d+)\s+(\d+)\s*\/\s*(\d+)$/.exec(value)
  if (mixed) {
    const denominator = Number(mixed[3])
    if (!denominator) return null
    return Number(mixed[1]) + Number(mixed[2]) / denominator
  }
  const fraction = /^(\d+)\s*\/\s*(\d+)$/.exec(value)
  if (fraction) {
    const denominator = Number(fraction[2])
    if (!denominator) return null
    return Number(fraction[1]) / denominator
  }
  const number = Number(value.replace(',', '.'))
  return Number.isFinite(number) ? number : null
}

function unitToMinutes(amount: number, unit: string): number {
  const normalized = unit.toLowerCase().replace(/\.$/, '')
  const isHours =
    normalized === 'h' ||
    normalized === 'hr' ||
    normalized === 'hrs' ||
    normalized.startsWith('hour') ||
    normalized.startsWith('std') ||
    normalized.startsWith('stunde')
  return isHours ? amount * 60 : amount
}

function single(minutes: number): ParsedDuration | null {
  if (!Number.isFinite(minutes) || minutes <= 0) return null
  return { kind: 'single', minutes: Math.round(minutes) }
}

function range(first: number, second: number): ParsedDuration | null {
  const minMinutes = Math.round(Math.min(first, second))
  const maxMinutes = Math.round(Math.max(first, second))
  if (minMinutes <= 0) return null
  return minMinutes === maxMinutes
    ? { kind: 'single', minutes: minMinutes }
    : { kind: 'range', minMinutes, maxMinutes }
}

/** Sum every complete "<amount> <unit>" pair in a text fragment. */
function sumUnits(text: string): number | null {
  let total = 0
  let found = false
  for (const match of text.matchAll(SINGLE)) {
    const amount = parseAmount(match[1] ?? '')
    if (amount === null) continue
    total += unitToMinutes(amount, match[2] ?? '')
    found = true
  }
  return found ? total : null
}

function parseIso(value: string): ParsedDuration | null {
  const match = ISO_DURATION.exec(value)
  if (!match) return null
  const [, days, hours, minutes, seconds] = match
  if (!days && !hours && !minutes && !seconds) return null
  const totalSeconds =
    Number((days ?? '0').replace(',', '.')) * 86_400 +
    Number((hours ?? '0').replace(',', '.')) * 3_600 +
    Number((minutes ?? '0').replace(',', '.')) * 60 +
    Number((seconds ?? '0').replace(',', '.'))
  return totalSeconds > 0 ? single(totalSeconds / 60) : null
}

/**
 * "1:30" / "1:30 Std." is a clock-style duration, not "30 Stunden". Parse it
 * before the generic unit scanner so the trailing "30 Stunden" cannot win.
 */
function parseClock(value: string): ParsedDuration | null {
  const match = CLOCK.exec(value)
  if (!match) return null
  const hours = Number(match[1])
  const minutes = Number(match[2])
  const seconds = Number(match[3] ?? 0)
  if (minutes > 59 || seconds > 59) return null
  return single(hours * 60 + minutes + seconds / 60)
}

/**
 * Interpret a stored time string. Returns:
 *  - `single` for one unambiguous duration,
 *  - `range` for an explicit range such as "2-4 Stunden",
 *  - `null` when the text cannot be interpreted safely (the caller should then
 *    display the original text instead of inventing a number).
 */
export function parseDuration(value: string | null | undefined): ParsedDuration | null {
  if (!value?.trim()) return null
  const text = normalize(value)

  // Mela exports sometimes store a bare integer. Existing archives prove these
  // are minutes (prep 20 + cook 5 = total 25; prep 30 + cook 10 = total 40).
  // Only whole numbers are treated this way; everything else stays untouched.
  if (/^\d+$/.test(text)) return single(Number(text))

  const iso = parseIso(text)
  if (iso) return iso

  const clock = parseClock(text)
  if (clock) return clock

  const rangeMatch = RANGE.exec(text)
  if (rangeMatch) {
    const [, firstText, firstUnit, secondText, secondUnit] = rangeMatch
    const firstAmount = parseAmount(firstText ?? '')
    const secondAmount = parseAmount(secondText ?? '')
    if (firstAmount !== null && secondAmount !== null) {
      const unit = secondUnit ?? firstUnit ?? ''
      const first = unitToMinutes(firstAmount, firstUnit ?? unit)
      const second = unitToMinutes(secondAmount, unit)
      // A compound value may have components before/after the range
      // ("1 Std. 30-45 Min."). Add them to both bounds.
      const start = rangeMatch.index
      const end = start + rangeMatch[0].length
      const extra = (sumUnits(text.slice(0, start)) ?? 0) + (sumUnits(text.slice(end)) ?? 0)
      const parsed = range(first + extra, second + extra)
      if (parsed) return parsed
    }
  }

  const total = sumUnits(text)
  return total === null ? null : single(total)
}

/** Minutes used by the planner; ranges use the upper bound on purpose. */
export function durationMinutes(value: string | null | undefined): number | null {
  const parsed = parseDuration(value)
  if (!parsed) return null
  return parsed.kind === 'single' ? parsed.minutes : parsed.maxMinutes
}
