/*
 * openCook Web
 * Copyright (C) 2026 openCook Web contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Central, persistent shopping-cycle configuration. These settings are stored
 * in the existing `settings` table (so backups keep them) but are deliberately
 * independent from the visual calendar week start. No shopping service may
 * assume a fixed weekday or a fixed standard-list name.
 */

import { db } from '../db'
import { normalizeWeekday } from '../domain/dates'
import { DEFAULT_STANDARD_SHOPPING_LIST_NAME } from '../domain/shoppingLists'
import type { SettingRecord } from '../types'

export { DEFAULT_STANDARD_SHOPPING_LIST_NAME }

export const SHOPPING_PERIOD_START_DAY_KEY = 'shoppingPeriodStartDay'
export const STANDARD_SHOPPING_LIST_NAME_KEY = 'standardShoppingListName'

/**
 * Initial value for existing installations: the historical shopping logic
 * started on Thursday. It is only a default for the editable setting and must
 * never be used as a hidden fallback when the user changed it.
 */
export const DEFAULT_SHOPPING_PERIOD_START_DAY = 3
/** Re-exported from the pure domain module to keep a single product default. */
export const MAX_STANDARD_LIST_NAME_LENGTH = 60

export interface ShoppingSettings {
  /** 0 = Monday … 6 = Sunday. */
  periodStartDay: number
  /** Editable base name of every standard shopping list. */
  standardListName: string
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

function numeric(value: SettingRecord['value'] | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
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

/**
 * Persist a partial change. This only writes the setting rows; callers that
 * change the shopping weekday must use the cycle service so the transition and
 * historical period boundaries are handled explicitly.
 */
export async function saveShoppingSettings(
  patch: Partial<ShoppingSettings>,
): Promise<ShoppingSettings> {
  return db.transaction('rw', db.settings, async () => {
    const current = await getShoppingSettings()
    const next = normalizeShoppingSettings({ ...current, ...patch })
    await db.settings.bulkPut([
      { key: SHOPPING_PERIOD_START_DAY_KEY, value: next.periodStartDay },
      { key: STANDARD_SHOPPING_LIST_NAME_KEY, value: next.standardListName },
    ])
    return next
  })
}
