/*
 * openCook Web
 * Copyright (C) 2026 openCook Web contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Central state for the weekly-planning overlays. Exactly one overlay can be
 * active at a time, and a create flow remembers the chooser it came from.
 * The reducer contains no React, database or service code.
 */

export type PlanningOverlay =
  | { kind: 'none' }
  | { kind: 'chooser'; date: string }
  | { kind: 'create'; date: string; backDate: string }
  | { kind: 'free-create'; date: string; backDate: string }
  | { kind: 'note'; date: string; backDate: string }
  | { kind: 'note-direct'; date: string }
  | { kind: 'edit'; entryId: string }

export const NO_PLANNING_OVERLAY: PlanningOverlay = { kind: 'none' }

export type PlanningSessionAction =
  | { type: 'open-chooser'; date: string }
  | { type: 'choose-recipe'; date: string }
  | { type: 'choose-free-dish'; date: string }
  | { type: 'choose-note'; date: string }
  | { type: 'open-note'; date: string }
  | { type: 'open-edit'; entryId: string }
  | { type: 'back-to-chooser' }
  | { type: 'close' }

export function planningSessionReducer(
  state: PlanningOverlay,
  action: PlanningSessionAction,
): PlanningOverlay {
  switch (action.type) {
    case 'open-chooser':
      return { kind: 'chooser', date: action.date }
    case 'choose-recipe':
      return { kind: 'create', date: action.date, backDate: action.date }
    case 'choose-free-dish':
      return { kind: 'free-create', date: action.date, backDate: action.date }
    case 'choose-note':
      return { kind: 'note', date: action.date, backDate: action.date }
    case 'open-note':
      return { kind: 'note-direct', date: action.date }
    case 'open-edit':
      return { kind: 'edit', entryId: action.entryId }
    case 'back-to-chooser': {
      const date = planningBackDate(state)
      return date ? { kind: 'chooser', date } : state
    }
    case 'close':
      return NO_PLANNING_OVERLAY
  }
}

/** Date of the chooser this overlay was opened from, if there is one. */
export function planningBackDate(state: PlanningOverlay): string | null {
  return state.kind === 'create' ||
    state.kind === 'free-create' ||
    state.kind === 'note'
    ? state.backDate
    : null
}
