/*
 * Küchenrunde (vormals openCook Web)
 * Copyright (C) 2026 openCook Web contributors
 * Copyright (C) 2026 olie.xdev <olie.xdeveloper@googlemail.com>
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Pure port of openCook's MealPlanReconciler. A past, un-cooked, procured dish
 * rolls forward to the next free day within a small window. It is deliberately
 * not run automatically on app start in this package; the pure function is
 * available and tested for the later self-healing flow.
 *
 * Original: https://github.com/oliexdev/openCook (v0.4, commit 6e0c234).
 * Die Portierung ist im Baseline-Commit vom 2026-11-08 enthalten; für
 * Küchenrunde am 2026-11-10 angepasst.
 */

import { addDays } from './dates'

export interface PastEntry {
  entryId: string
  date: string
  procured: boolean
}

export interface Move {
  entryId: string
  toDate: string
}

export const DEFAULT_WINDOW_DAYS = 2

export function reconcile(
  pastUncooked: PastEntry[],
  occupied: ReadonlySet<string>,
  skipped: ReadonlySet<string>,
  today: string,
  window: number = DEFAULT_WINDOW_DAYS,
): Move[] {
  const taken = new Set(occupied)
  const moves: Move[] = []

  for (const entry of [...pastUncooked].filter((item) => item.procured).sort((a, b) => a.date.localeCompare(b.date))) {
    let target: string | null = null
    for (let offset = 0; offset <= window; offset += 1) {
      const candidate = addDays(today, offset)
      if (!taken.has(candidate) && !skipped.has(candidate)) {
        target = candidate
        break
      }
    }
    if (!target) continue
    taken.add(target)
    moves.push({ entryId: entry.entryId, toDate: target })
  }

  return moves
}
