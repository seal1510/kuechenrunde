/*
 * openCook Web
 * Copyright (C) 2026 openCook Web contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Small, pure helpers for the editor session. They describe "has the user
 * changed anything?" without touching the recipe model or persisting state.
 */

import type { RecipeDraft } from './editor'

export interface EditorImageIdentity {
  id: string
}

/** Stable fingerprint of every editable draft field, including references. */
export function draftFingerprint(draft: RecipeDraft): string {
  return JSON.stringify(draft)
}

/**
 * Images are immutable once added, so their id and order are enough to detect
 * additions, removals and a changed main image.
 */
export function imageFingerprint(images: readonly EditorImageIdentity[]): string {
  return images.map((image) => image.id).join('\u0000')
}

export function editorFingerprint(
  draft: RecipeDraft,
  images: readonly EditorImageIdentity[],
): string {
  return `${draftFingerprint(draft)}\u0001${imageFingerprint(images)}`
}

/** A missing baseline means the editor is still loading and cannot be dirty. */
export function hasEditorChanges(
  baseline: string | null,
  draft: RecipeDraft,
  images: readonly EditorImageIdentity[],
): boolean {
  return baseline !== null && baseline !== editorFingerprint(draft, images)
}

export function editorSaveState(options: {
  saving: boolean
  dirty: boolean
  isNew: boolean
}): string {
  if (options.saving) return 'Speichere …'
  if (options.dirty) return 'Ungespeicherte Änderungen'
  return options.isNew ? 'Neues Rezept' : 'Keine Änderungen'
}
