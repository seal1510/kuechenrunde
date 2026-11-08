/*
 * openCook Web
 * Copyright (C) 2026 openCook Web contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Where the header back action leads inside a planning dialog. The dialog
 * still owns all draft state; this helper only names the previous step so the
 * behaviour stays testable without a browser environment.
 */

export type PlanningBackTarget = 'picker' | 'chooser'

export interface PlanningBackStep {
  target: PlanningBackTarget
  /** Accessible label, also used as tooltip. */
  label: string
  /** True when the current draft stays untouched (picker → plan reversal). */
  keepsDraft: boolean
}

const TO_PICKER: PlanningBackStep = {
  target: 'picker',
  label: 'Zurück zur Rezeptauswahl',
  keepsDraft: true,
}

const TO_CHOOSER: PlanningBackStep = {
  target: 'chooser',
  label: 'Zurück zu Hinzufügen',
  keepsDraft: false,
}

/**
 * Create flow: Add entry → recipe picker → planning form.
 * Editing an existing calendar entry never gets an artificial earlier step.
 */
export function dishBackStep(
  mode: 'create' | 'edit',
  showingPicker: boolean,
  canReturnToChooser: boolean,
): PlanningBackStep | null {
  if (mode !== 'create') return null
  if (!showingPicker) return TO_PICKER
  return canReturnToChooser ? TO_CHOOSER : null
}

/** Free dishes and new comments go straight back to the shared chooser. */
export function chooserBackStep(
  canReturnToChooser: boolean,
): PlanningBackStep | null {
  return canReturnToChooser ? TO_CHOOSER : null
}

/** Free-dish create flow; editing keeps the direct calendar entry. */
export function freeDishBackStep(
  mode: 'create' | 'edit',
  canReturnToChooser: boolean,
): PlanningBackStep | null {
  return mode === 'create' ? chooserBackStep(canReturnToChooser) : null
}
