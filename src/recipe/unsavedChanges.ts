/*
 * openCook Web
 * Copyright (C) 2026 openCook Web contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The editor-specific entry point for the central navigation guard. All
 * history handling lives in src/routing/NavigationGuard.tsx so every exit path
 * uses the same prompt and the same history bookkeeping.
 */

export {
  useUnsavedChangesGuard,
  type UnsavedChangesGuard,
} from '../routing/NavigationGuard'
export { UNSAVED_CHANGES_QUESTION } from '../routing/navigationGuardController'
