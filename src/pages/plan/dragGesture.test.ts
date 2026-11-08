import { describe, expect, it } from 'vitest'
import {
  MOUSE_DRAG_THRESHOLD_PX,
  TOUCH_LONG_PRESS_MS,
  activateDragGesture,
  cancelDragGesture,
  createDragGesture,
  dragDistance,
  isDragActive,
  moveDragGesture,
  shouldActivateTouchHold,
} from './dragGesture'

describe('dish card drag activation', () => {
  it('keeps a short mouse click inactive and activates after the threshold', () => {
    const start = createDragGesture('mouse', 100, 100, 0)
    const clickLike = moveDragGesture(start, 103, 103)

    expect(isDragActive(clickLike)).toBe(false)
    expect(clickLike.cancelled).toBe(false)
    const active = moveDragGesture(start, 100 + MOUSE_DRAG_THRESHOLD_PX, 100)
    expect(isDragActive(active)).toBe(true)
    expect(dragDistance(start, 103, 104)).toBeCloseTo(5)
  })

  it('does not activate touch before the long-press duration', () => {
    const start = createDragGesture('touch', 50, 50, 1000)

    expect(shouldActivateTouchHold(start, 1000 + TOUCH_LONG_PRESS_MS - 1)).toBe(false)
    expect(isDragActive(start)).toBe(false)
    expect(shouldActivateTouchHold(start, 1000 + TOUCH_LONG_PRESS_MS)).toBe(true)
    expect(isDragActive(activateDragGesture(start))).toBe(true)
  })

  it('cancels a pending touch drag when the finger scrolls too far', () => {
    const start = createDragGesture('touch', 50, 50, 0)
    const moved = moveDragGesture(start, 50, 61)

    expect(moved.cancelled).toBe(true)
    expect(shouldActivateTouchHold(moved, TOUCH_LONG_PRESS_MS + 1)).toBe(false)
    expect(isDragActive(activateDragGesture(moved))).toBe(false)
  })

  it('keeps a small touch move pending so the long press can still activate', () => {
    const start = createDragGesture('touch', 50, 50, 0)
    const moved = moveDragGesture(start, 54, 56)

    expect(moved.cancelled).toBe(false)
    expect(shouldActivateTouchHold(moved, TOUCH_LONG_PRESS_MS)).toBe(true)
    expect(isDragActive(activateDragGesture(moved))).toBe(true)
  })

  it('ignores scroll cancellation after the drag is already active', () => {
    const start = createDragGesture('touch', 100, 100, 0)
    const active = activateDragGesture(start)
    const moved = moveDragGesture(active, 100, 180)

    expect(moved).toBe(active)
    expect(isDragActive(moved)).toBe(true)
  })

  it('cancels an active gesture cleanly', () => {
    const active = activateDragGesture(createDragGesture('mouse', 0, 0, 0))
    const cancelled = cancelDragGesture(active)

    expect(isDragActive(cancelled)).toBe(false)
    expect(cancelled.cancelled).toBe(true)
  })
})
