/*
 * openCook Web
 * Copyright (C) 2026 openCook Web contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Pure selection rules for the mobile day view. The selected day only affects
 * presentation; it never changes a plan entry or a cooking session.
 */

/**
 * Keep a requested day when it is part of the visible window. Otherwise prefer
 * today when it belongs to the seven-day core week, and fall back to the first
 * core day so week navigation always lands on a predictable day.
 */
export function resolveCalendarSelection(
  visibleDays: readonly string[],
  coreDays: readonly string[],
  today: string,
  requested: string | null,
): string {
  if (requested && visibleDays.includes(requested)) return requested
  if (coreDays.includes(today)) return today
  return coreDays[0] ?? visibleDays[0] ?? today
}
