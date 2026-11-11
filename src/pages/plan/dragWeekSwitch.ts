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

/**
 * After one switch the finger must move this far outside both zones before a
 * new dwell can start. The hysteresis keeps a finger resting on a zone border
 * from unlocking and immediately switching again.
 */
export const DRAG_WEEK_RELEASE_MARGIN_PX = 28

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

function distanceToRect(
  rect: DragWeekZoneRect,
  x: number,
  y: number,
): number {
  const dx = x < rect.left ? rect.left - x : x > rect.right ? x - rect.right : 0
  const dy = y < rect.top ? rect.top - y : y > rect.bottom ? y - rect.bottom : 0
  return Math.hypot(dx, dy)
}

/**
 * "Clearly left" means outside both zones by the release margin. Points in the
 * narrow gap between the two zones are deliberately not considered outside.
 */
export function isClearlyOutsideDragWeekZones(
  x: number,
  y: number,
  previous: DragWeekZoneRect | null,
  next: DragWeekZoneRect | null,
  margin = DRAG_WEEK_RELEASE_MARGIN_PX,
): boolean {
  const zones = [previous, next].filter(
    (zone): zone is DragWeekZoneRect => zone !== null,
  )
  if (zones.length === 0) return false
  return zones.every((zone) => distanceToRect(zone, x, y) > margin)
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

/**
 * The hold rule is deliberately a tiny state machine instead of a recursive
 * timer: one zone visit may consume exactly one week switch. `consumed` stays
 * true until the pointer has clearly left both zones, even if the finger
 * jitters across the border or moves between the two zones.
 */
export interface DragWeekSwitchGate {
  direction: DragWeekDirection | null
  consumed: boolean
}

export function createDragWeekSwitchGate(): DragWeekSwitchGate {
  return { direction: null, consumed: false }
}

export interface DragWeekSwitchGateUpdate {
  gate: DragWeekSwitchGate
  /** Start (or restart) the hold timer for this direction, if non-null. */
  arm: DragWeekDirection | null
}

export function updateDragWeekSwitchGate(
  gate: DragWeekSwitchGate,
  direction: DragWeekDirection | null,
  clearlyOutside: boolean,
): DragWeekSwitchGateUpdate {
  if (gate.consumed) {
    if (direction === null && clearlyOutside) {
      return { gate: { direction: null, consumed: false }, arm: null }
    }
    return { gate: { direction, consumed: true }, arm: null }
  }
  if (direction === null) {
    return { gate: { direction: null, consumed: false }, arm: null }
  }
  if (gate.direction === direction) {
    return { gate, arm: null }
  }
  return { gate: { direction, consumed: false }, arm: direction }
}

/** Mark the single switch of the current zone visit as used. */
export function consumeDragWeekSwitch(
  gate: DragWeekSwitchGate,
  direction: DragWeekDirection,
): DragWeekSwitchGate {
  if (gate.direction !== direction) return gate
  return { direction, consumed: true }
}
