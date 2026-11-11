/*
 * Küchenrunde – drag week switch rule tests
 * Copyright (C) 2026 openCook Web contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, expect, it } from 'vitest'
import {
  DRAG_WEEK_HOLD_MS,
  dragWeekDirectionAtPoint,
  resolveDragDropTarget,
  type DragWeekZoneRect,
} from './dragWeekSwitch'

const previous: DragWeekZoneRect = {
  left: 10,
  top: 700,
  right: 190,
  bottom: 760,
}
const next: DragWeekZoneRect = {
  left: 200,
  top: 700,
  right: 380,
  bottom: 760,
}

describe('drag week switch zones', () => {
  it('waits a deliberate 600–800 ms before switching', () => {
    expect(DRAG_WEEK_HOLD_MS).toBeGreaterThanOrEqual(600)
    expect(DRAG_WEEK_HOLD_MS).toBeLessThanOrEqual(800)
  })

  it('detects the previous zone, the next zone and the space outside', () => {
    expect(dragWeekDirectionAtPoint(100, 730, previous, next)).toBe(-1)
    expect(dragWeekDirectionAtPoint(300, 730, previous, next)).toBe(1)
    expect(dragWeekDirectionAtPoint(195, 730, previous, next)).toBeNull()
    expect(dragWeekDirectionAtPoint(100, 650, previous, next)).toBeNull()
    expect(dragWeekDirectionAtPoint(10, 700, previous, next)).toBe(-1)
    expect(dragWeekDirectionAtPoint(380, 760, previous, next)).toBe(1)
  })

  it('never drops while over a week switch zone', () => {
    expect(
      resolveDragDropTarget({
        commit: true,
        overWeekZone: true,
        hitDate: '2026-11-13',
        originDate: '2026-11-11',
      }),
    ).toBeNull()
  })

  it('never writes on cancel, on the origin day or without a valid day', () => {
    expect(
      resolveDragDropTarget({
        commit: false,
        overWeekZone: false,
        hitDate: '2026-11-13',
        originDate: '2026-11-11',
      }),
    ).toBeNull()
    expect(
      resolveDragDropTarget({
        commit: true,
        overWeekZone: false,
        hitDate: '2026-11-11',
        originDate: '2026-11-11',
      }),
    ).toBeNull()
    expect(
      resolveDragDropTarget({
        commit: true,
        overWeekZone: false,
        hitDate: null,
        originDate: '2026-11-11',
      }),
    ).toBeNull()
  })

  it('allows a real release on a different target day', () => {
    expect(
      resolveDragDropTarget({
        commit: true,
        overWeekZone: false,
        hitDate: '2026-11-13',
        originDate: '2026-11-11',
      }),
    ).toBe('2026-11-13')
  })
})
