/*
 * Küchenrunde – Backend-Schnittstelle des Rezepteditors
 * Copyright (C) 2026 openCook Web contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Der vorhandene Editor wird von lokal (Dexie) und Cloud (Supabase) genutzt.
 * Nur die Persistenz unterscheidet sich; Formular, Validierung und
 * Navigationsschutz bleiben identisch.
 */

import type { Recipe } from '../types'
import type { EditorImage } from './repository'

export interface RecipeEditorLoad {
  recipe: Recipe | null
  images: EditorImage[]
  /** Nur im Cloud-Modus: Revision für Compare-and-Swap. */
  rev?: number
}

export interface RecipeEditorSaveContext {
  isNew: boolean
  expectedRev?: number
}

/**
 * Non-fatal problems after a successful metadata write. The recipe is saved,
 * but leftover storage objects could not be removed. The UI must show this
 * instead of reporting a completely clean success.
 */
export interface RecipeEditorSaveResult {
  warnings: string[]
}

export interface RecipeEditorBackend {
  supportsImages: boolean
  /** Optional allow-list enforced by the backing storage bucket. */
  imageMimeTypes?: readonly string[]
  storageHint: string
  deleteHint: string
  load(id?: string): Promise<RecipeEditorLoad | null>
  save(
    recipe: Recipe,
    images: EditorImage[],
    context: RecipeEditorSaveContext,
  ): Promise<RecipeEditorSaveResult | void>
  remove(id: string, expectedRev?: number): Promise<RecipeEditorSaveResult | void>
}
