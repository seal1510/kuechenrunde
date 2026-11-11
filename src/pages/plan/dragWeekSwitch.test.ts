/*
 * Küchenrunde – drag week switch rule tests
 * Copyright (C) 2026 openCook Web contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, expect, it } from 'vitest'
import {
  DRAG_WEEK_HOLD_MS,
  DRAG_WEEK_RELEASE_MARGIN_PX,
  consumeDragWeekSwitch,
  createDragWeekSwitchGate,
  dragWeekDirectionAtPoint,
  isClearlyOutsideDragWeekZones,
  resolveDragDropTarget,
  updateDragWeekSwitchGate,
  type DragWeekSwitchGate,
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


describe('one week switch per zone visit', () => {
  function arm(
    gate: DragWeekSwitchGate,
    direction: -1 | 1,
  ): { gate: DragWeekSwitchGate; arm: -1 | 1 | null } {
    return updateDragWeekSwitchGate(gate, direction, false)
  }

  it('consumes the hold exactly once even when the finger stays in the zone', () => {
    let gate = createDragWeekSwitchGate()
    let step = arm(gate, 1)
    expect(step.arm).toBe(1)
    gate = step.gate

    // The 650 ms timer fires once and marks this zone visit as used.
    gate = consumeDragWeekSwitch(gate, 1)
    expect(gate).toEqual({ direction: 1, consumed: true })

    // Every further movement or update while the finger remains in the zone
    // must not start another timer.
    for (let index = 0; index < 10; index += 1) {
      step = arm(gate, 1)
      expect(step.arm).toBeNull()
      expect(step.gate.consumed).toBe(true)
      gate = step.gate
    }
  })

  it('does not unlock on small border movements or in the gap between zones', () => {
    let gate = consumeDragWeekSwitch(
      updateDragWeekSwitchGate(createDragWeekSwitchGate(), 1, false).gate,
      1,
    )

    // The finger slips out of the zone, but not far enough to count as a
    // deliberate exit. Re-entering must still not arm another switch.
    let step = updateDragWeekSwitchGate(gate, null, false)
    expect(step.gate.consumed).toBe(true)
    expect(step.arm).toBeNull()
    gate = step.gate

    step = updateDragWeekSwitchGate(gate, 1, false)
    expect(step.gate.consumed).toBe(true)
    expect(step.arm).toBeNull()
    gate = step.gate

    // Moving to the other zone is still "inside the zones" as well.
    step = updateDragWeekSwitchGate(gate, -1, false)
    expect(step.gate.consumed).toBe(true)
    expect(step.arm).toBeNull()
  })

  it('allows a new switch only after a clear exit and a fresh entry', () => {
    let gate = consumeDragWeekSwitch(
      updateDragWeekSwitchGate(createDragWeekSwitchGate(), 1, false).gate,
      1,
    )

    // Clearly outside: unlock, but do not arm while the finger is outside.
    let step = updateDragWeekSwitchGate(gate, null, true)
    expect(step.gate).toEqual({ direction: null, consumed: false })
    expect(step.arm).toBeNull()
    gate = step.gate

    // A fresh entry starts a new 650 ms dwell.
    step = arm(gate, 1)
    expect(step.arm).toBe(1)
    gate = step.gate

    // That second visit again allows exactly one switch.
    gate = consumeDragWeekSwitch(gate, 1)
    expect(gate.consumed).toBe(true)
    expect(arm(gate, 1).arm).toBeNull()
  })

  it('keeps the previous zone equally one-shot', () => {
    let gate = createDragWeekSwitchGate()
    expect(updateDragWeekSwitchGate(gate, -1, false).arm).toBe(-1)
    gate = consumeDragWeekSwitch(
      updateDragWeekSwitchGate(gate, -1, false).gate,
      -1,
    )
    expect(updateDragWeekSwitchGate(gate, -1, false).arm).toBeNull()
  })
})

describe('clear exit hysteresis', () => {
  it('requires the release margin beyond both zones', () => {
    expect(isClearlyOutsideDragWeekZones(100, 730, previous, next)).toBe(false)
    expect(isClearlyOutsideDragWeekZones(195, 730, previous, next)).toBe(false)
    expect(
      isClearlyOutsideDragWeekZones(
        100,
        700 - DRAG_WEEK_RELEASE_MARGIN_PX + 1,
        previous,
        next,
      ),
    ).toBe(false)
    expect(
      isClearlyOutsideDragWeekZones(
        100,
        700 - DRAG_WEEK_RELEASE_MARGIN_PX - 1,
        previous,
        next,
      ),
    ).toBe(true)
    expect(isClearlyOutsideDragWeekZones(500, 730, previous, next)).toBe(true)
  })

  it('does not unlock before both zone rectangles are measured', () => {
    expect(isClearlyOutsideDragWeekZones(0, 0, null, null)).toBe(false)
  })
})
