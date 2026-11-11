/*
 * Küchenrunde – drag-and-drop week switching
 * Copyright (C) 2026 openCook Web contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Pure timing, hit-testing and drop-target rules for the temporary week switch
 * zones shown during a phone drag. The actual week change still goes through
 * the existing anchor-date state and the existing move service.
 */

/** A short deliberate dwell, not an accidental touch. */
export const DRAG_WEEK_HOLD_MS = 650

export type DragWeekDirection = -1 | 1

export interface DragWeekZoneRect {
  left: number
  top: number
  right: number
  bottom: number
}

function contains(rect: DragWeekZoneRect, x: number, y: number): boolean {
  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom
}

/** Which temporary week zone contains the pointer, if any. */
export function dragWeekDirectionAtPoint(
  x: number,
  y: number,
  previous: DragWeekZoneRect | null,
  next: DragWeekZoneRect | null,
): DragWeekDirection | null {
  if (previous && contains(previous, x, y)) return -1
  if (next && contains(next, x, y)) return 1
  return null
}

export interface DragDropTargetInput {
  /** A real release commits; a cancelled pointer never does. */
  commit: boolean
  /** Releasing over a week switch zone is never a drop. */
  overWeekZone: boolean
  hitDate: string | null
  originDate: string
}

/**
 * Resolve the date that may be persisted on release. Null means "return the
 * floating card" and guarantees that week switching or cancelling never writes.
 */
export function resolveDragDropTarget({
  commit,
  overWeekZone,
  hitDate,
  originDate,
}: DragDropTargetInput): string | null {
  if (!commit || overWeekZone) return null
  if (!hitDate || hitDate === originDate) return null
  return hitDate
}
