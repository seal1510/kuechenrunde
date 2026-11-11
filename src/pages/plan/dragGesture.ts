/*
 * openCook Web
 * Copyright (C) 2026 openCook Web contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Pure activation rules for dragging a whole calendar dish card. Mouse/pen use
 * a short movement threshold; touch waits for a long press while small moves
 * are still treated as scrolling. No DOM or React imports.
 */

export const MOUSE_DRAG_THRESHOLD_PX = 6
export const TOUCH_LONG_PRESS_MS = 300
export const TOUCH_SCROLL_CANCEL_PX = 10

export type DragPointerType = 'mouse' | 'touch' | 'pen'

export interface DragGestureState {
  pointerType: DragPointerType
  startX: number
  startY: number
  startedAt: number
  active: boolean
  cancelled: boolean
}

export function createDragGesture(
  pointerType: DragPointerType,
  x: number,
  y: number,
  now: number,
): DragGestureState {
  return {
    pointerType,
    startX: x,
    startY: y,
    startedAt: now,
    active: false,
    cancelled: false,
  }
}

export function dragDistance(state: DragGestureState, x: number, y: number): number {
  return Math.hypot(x - state.startX, y - state.startY)
}

/**
 * Mouse/pen activate as soon as the movement threshold is crossed. Touch stays
 * inactive until the hold timer fires; moving beyond the scroll tolerance
 * before that cancels the pending drag so normal scrolling keeps working.
 */
export function moveDragGesture(
  state: DragGestureState,
  x: number,
  y: number,
): DragGestureState {
  if (state.active || state.cancelled) return state
  const distance = dragDistance(state, x, y)

  if (state.pointerType === 'touch') {
    return distance > TOUCH_SCROLL_CANCEL_PX
      ? { ...state, cancelled: true }
      : state
  }

  return distance >= MOUSE_DRAG_THRESHOLD_PX
    ? { ...state, active: true }
    : state
}

export function shouldActivateTouchHold(
  state: DragGestureState,
  now: number,
): boolean {
  return (
    state.pointerType === 'touch' &&
    !state.active &&
    !state.cancelled &&
    now - state.startedAt >= TOUCH_LONG_PRESS_MS
  )
}

export function activateDragGesture(state: DragGestureState): DragGestureState {
  if (state.active || state.cancelled) return state
  return { ...state, active: true }
}

export function cancelDragGesture(state: DragGestureState): DragGestureState {
  return { ...state, active: false, cancelled: true }
}

export function isDragActive(state: DragGestureState | null): boolean {
  return Boolean(state?.active)
}

export interface DragSessionRef<T> {
  current: T | null
}

/**
 * Atomically claim a drag session. The first release (pointerup, touchend or
 * pointercancel) receives the session; every later release receives null, so a
 * single gesture can never trigger two move operations.
 */
export function takeDragSession<T>(ref: DragSessionRef<T>): T | null {
  const session = ref.current
  ref.current = null
  return session
}
