/*
 * openCook Web
 * Copyright (C) 2026 openCook Web contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Deterministic presentation colours for connected multi-day dishes. Only the
 * cooking-event id is used, never the recipe name or the visible sort order.
 */

import type { MealPlanEntry } from '../types'

export const GROUP_COLOR_COUNT = 4

export interface GroupTheme {
  colorIndex: number
  sessionId: string
}

/** Stable FNV-1a hash mapped to the small muted palette. */
export function groupColorIndex(cookSessionId: string): number {
  let hash = 2166136261
  for (let index = 0; index < cookSessionId.length; index += 1) {
    hash ^= cookSessionId.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0) % GROUP_COLOR_COUNT
}

/**
 * Single dishes and entries without a cooking event stay neutral. The theme is
 * derived exclusively from `cookSessionId`, so two sessions of the same recipe
 * are still separate groups.
 */
export function groupThemeFor(
  entry: Pick<MealPlanEntry, 'cookSessionId'>,
  groupSize: number,
): GroupTheme | null {
  if (!entry.cookSessionId || groupSize <= 1) return null
  return {
    colorIndex: groupColorIndex(entry.cookSessionId),
    sessionId: entry.cookSessionId,
  }
}

/** Shared hover/focus highlight uses the cooking-event id, never the recipe. */
export function isGroupHighlighted(
  theme: GroupTheme | null,
  highlightedSessionId: string | null,
): boolean {
  return Boolean(theme && highlightedSessionId === theme.sessionId)
}
