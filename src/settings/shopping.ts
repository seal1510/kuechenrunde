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
export const SHOPPING_CYCLE_PENDING_KEY = 'shoppingCyclePending'

/**
 * Initial value for existing installations: the historical shopping logic
 * started on Thursday. It is only a default for the editable setting and must
 * never be used as a hidden fallback when the user changed it.
 */
export const DEFAULT_SHOPPING_PERIOD_START_DAY = 3
/** Re-exported from the pure domain module to keep a single product default. */
export const MAX_STANDARD_LIST_NAME_LENGTH = 60

export interface PendingShoppingCycleChange {
  /** 0 = Monday … 6 = Sunday. */
  periodStartDay: number
  /** First day the new rhythm applies; persisted and stable. */
  effectiveFrom: string
  createdAt: number
}

export interface ShoppingSettings {
  /** 0 = Monday … 6 = Sunday; the currently stored base weekday. */
  periodStartDay: number
  /** Editable base name of every standard shopping list. */
  standardListName: string
  /** A stored, possibly future rhythm change. */
  pending: PendingShoppingCycleChange | null
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export function normalizePendingShoppingCycleChange(
  value: unknown,
): PendingShoppingCycleChange | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const periodStartDay = record.periodStartDay
  const effectiveFrom = record.effectiveFrom
  const createdAt = record.createdAt
  if (
    typeof periodStartDay !== 'number' ||
    !Number.isFinite(periodStartDay) ||
    typeof effectiveFrom !== 'string' ||
    !DATE_RE.test(effectiveFrom)
  ) {
    return null
  }
  return {
    periodStartDay: normalizeWeekday(periodStartDay),
    effectiveFrom,
    createdAt: typeof createdAt === 'number' && Number.isFinite(createdAt) ? createdAt : 0,
  }
}

function parsePendingSetting(value: SettingRecord['value'] | undefined): PendingShoppingCycleChange | null {
  if (typeof value !== 'string' || !value.trim()) return null
  try {
    return normalizePendingShoppingCycleChange(JSON.parse(value))
  } catch {
    return null
  }
}

export function pendingShoppingCycleSettingValue(
  pending: PendingShoppingCycleChange | null,
): string | null {
  return pending ? JSON.stringify(pending) : null
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
    pending: normalizePendingShoppingCycleChange(value.pending),
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
    pending: parsePendingSetting(byKey.get(SHOPPING_CYCLE_PENDING_KEY)),
  })
}

export async function getShoppingSettings(): Promise<ShoppingSettings> {
  const rows = await db.settings.bulkGet([
    SHOPPING_PERIOD_START_DAY_KEY,
    STANDARD_SHOPPING_LIST_NAME_KEY,
    SHOPPING_CYCLE_PENDING_KEY,
  ])
  return shoppingSettingsFromRows(rows.filter((row): row is SettingRecord => Boolean(row)))
}
