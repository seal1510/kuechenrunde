/*
 * openCook Web
 * Copyright (C) 2026 openCook Web contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Shared drag payload for dish cards and comment cards.
 */

import type { DayNote, MealPlanEntry } from '../../types'

export type DragItem =
  | { kind: 'entry'; entry: MealPlanEntry }
  | { kind: 'note'; note: DayNote }

export function dragItemKey(item: DragItem): string {
  return item.kind === 'entry' ? `entry:${item.entry.id}` : `note:${item.note.date}`
}

export function dragItemDate(item: DragItem): string {
  return item.kind === 'entry' ? item.entry.date : item.note.date
}
