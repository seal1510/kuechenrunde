/*
 * openCook Web
 * Copyright (C) 2026 openCook Web contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Which footer a planning dialog shows. A pending discard confirmation must
 * always replace the normal actions, in every visible step, so it can never
 * become an invisible state that swallows the close action.
 */

export type PlanningFooterMode = 'none' | 'actions' | 'prompt'

export function dishFooterMode(
  showingPicker: boolean,
  prompted: boolean,
): PlanningFooterMode {
  if (prompted) return 'prompt'
  return showingPicker ? 'none' : 'actions'
}

export function dialogFooterMode(prompted: boolean): PlanningFooterMode {
  return prompted ? 'prompt' : 'actions'
}
