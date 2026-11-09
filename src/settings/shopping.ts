/*
 * openCook Web
 * Copyright (C) 2026 openCook Web contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Central, persistent shopping configuration. These settings are stored in the
 * existing `settings` table (so backups keep them) but are deliberately
 * independent from the visual calendar week start. The shopping weekday is a
 * plain setting: it is read on every period resolution and has no schedule.
 */

import { db } from '../db'
import { normalizeWeekday } from '../domain/dates'
import { DEFAULT_STANDARD_SHOPPING_LIST_NAME } from '../domain/shoppingLists'
import type { SettingRecord } from '../types'

export { DEFAULT_STANDARD_SHOPPING_LIST_NAME }

export const SHOPPING_PERIOD_START_DAY_KEY = 'shoppingPeriodStartDay'
export const STANDARD_SHOPPING_LIST_NAME_KEY = 'standardShoppingListName'
/**
 * Obsolete key of the removed "planned rhythm change" setting. It is only read
 * by the migration helpers below so an existing plan is not silently dropped.
 */
export const LEGACY_SHOPPING_CYCLE_PENDING_KEY = 'shoppingCyclePending'

/**
 * Initial value for existing installations: the historical shopping logic
 * started on Thursday. It is only a default for the editable setting and must
 * never be used as a hidden fallback when the user changed it.
 */
export const DEFAULT_SHOPPING_PERIOD_START_DAY = 3
export const MAX_STANDARD_LIST_NAME_LENGTH = 60

export interface ShoppingSettings {
  /** 0 = Monday … 6 = Sunday. */
  periodStartDay: number
  /** Editable base name of every standard shopping list. */
  standardListName: string
}

function numeric(value: SettingRecord['value'] | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

export function normalizeStandardListName(value: unknown): string {
  const clean = String(value ?? '').replace(/\s+/g, ' ').trim()
  if (!clean) return DEFAULT_STANDARD_SHOPPING_LIST_NAME
  return clean.slice(0, MAX_STANDARD_LIST_NAME_LENGTH).trim()
}

export function normalizeShoppingSettings(
  value: Partial<ShoppingSettings> = {},
): ShoppingSettings {
  return {
    periodStartDay:
      typeof value.periodStartDay === 'number' && Number.isFinite(value.periodStartDay)
        ? normalizeWeekday(value.periodStartDay)
        : DEFAULT_SHOPPING_PERIOD_START_DAY,
    standardListName: normalizeStandardListName(value.standardListName),
  }
}

/** Pure parser shared by live-query consumers, backup import and tests. */
export function shoppingSettingsFromRows(
  rows: readonly SettingRecord[],
): ShoppingSettings {
  const byKey = new Map(rows.map((row) => [row.key, row.value]))
  const rawName = byKey.get(STANDARD_SHOPPING_LIST_NAME_KEY)
  return normalizeShoppingSettings({
    periodStartDay: numeric(byKey.get(SHOPPING_PERIOD_START_DAY_KEY)),
    standardListName: typeof rawName === 'string' ? rawName : undefined,
  })
}

export async function getShoppingSettings(): Promise<ShoppingSettings> {
  const rows = await db.settings.bulkGet([
    SHOPPING_PERIOD_START_DAY_KEY,
    STANDARD_SHOPPING_LIST_NAME_KEY,
  ])
  return shoppingSettingsFromRows(rows.filter((row): row is SettingRecord => Boolean(row)))
}

/* ------------------------------------------------------------------ */
/* Migration-only helpers for the removed planned-change setting        */
/* ------------------------------------------------------------------ */

/**
 * Read the weekday out of the obsolete pending row. Returns `null` when the
 * stored value is missing or unusable, so callers can leave it untouched.
 */
export function legacyPendingShoppingCycleDay(value: unknown): number | null {
  if (typeof value !== 'string' || !value.trim()) return null
  try {
    const parsed: unknown = JSON.parse(value)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null
    const day = (parsed as Record<string, unknown>).periodStartDay
    if (typeof day !== 'number' || !Number.isFinite(day)) return null
    return normalizeWeekday(day)
  } catch {
    return null
  }
}

/**
 * Promote an old planned change into the normal setting and drop the obsolete
 * row. Nothing is scheduled anymore: the user's last chosen weekday simply
 * becomes the current setting. When the row is unusable it is preserved.
 */
export function normalizeLegacyShoppingSettingsRows(
  rows: readonly SettingRecord[],
): SettingRecord[] {
  const pending = rows.find((row) => row.key === LEGACY_SHOPPING_CYCLE_PENDING_KEY)
  if (!pending) return [...rows]
  const day = legacyPendingShoppingCycleDay(pending.value)
  if (day === null) return [...rows]
  return [
    ...rows.filter(
      (row) =>
        row.key !== LEGACY_SHOPPING_CYCLE_PENDING_KEY &&
        row.key !== SHOPPING_PERIOD_START_DAY_KEY,
    ),
    { key: SHOPPING_PERIOD_START_DAY_KEY, value: day },
  ]
}
