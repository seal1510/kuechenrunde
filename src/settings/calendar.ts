/*
 * openCook Web
 * Copyright (C) 2026 openCook Web contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Calendar settings live in the existing `settings` table, so backup/restore
 * keeps them without a new schema or parallel store.
 */

import { db } from '../db'
import {
  DEFAULT_OVERLAP_AFTER,
  DEFAULT_OVERLAP_BEFORE,
  DEFAULT_WEEK_START_DAY,
  normalizeCalendarSettings,
  type CalendarSettings,
} from '../domain/calendar'
import type { SettingRecord } from '../types'

export const CALENDAR_SETTING_KEYS = [
  'weekStartDay',
  'overlapBefore',
  'overlapAfter',
] as const

function numeric(value: SettingRecord['value'] | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

/** Pure parser for live-query consumers and tests. */
export function calendarSettingsFromRows(
  rows: readonly SettingRecord[],
): CalendarSettings {
  const byKey = new Map(rows.map((row) => [row.key, row.value]))
  return normalizeCalendarSettings({
    weekStartDay: numeric(byKey.get('weekStartDay')) ?? DEFAULT_WEEK_START_DAY,
    overlapBefore: numeric(byKey.get('overlapBefore')) ?? DEFAULT_OVERLAP_BEFORE,
    overlapAfter: numeric(byKey.get('overlapAfter')) ?? DEFAULT_OVERLAP_AFTER,
  })
}

export async function getCalendarSettings(): Promise<CalendarSettings> {
  const rows = await db.settings.bulkGet([...CALENDAR_SETTING_KEYS])
  return calendarSettingsFromRows(
    rows.filter((row): row is SettingRecord => Boolean(row)),
  )
}

/** Persist a partial change with validation/clamping and return the result. */
export async function setCalendarSettings(
  patch: Partial<CalendarSettings>,
): Promise<CalendarSettings> {
  return db.transaction('rw', db.settings, async () => {
    const current = await getCalendarSettings()
    const next = normalizeCalendarSettings({ ...current, ...patch })
    await db.settings.bulkPut([
      { key: 'weekStartDay', value: next.weekStartDay },
      { key: 'overlapBefore', value: next.overlapBefore },
      { key: 'overlapAfter', value: next.overlapAfter },
    ])
    return next
  })
}
