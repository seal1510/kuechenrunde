/*
 * Küchenrunde – Backend-Schnittstelle des Rezepteditors
 * Copyright (C) 2026 openCook Web contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Der vorhandene Editor wird von lokal (Dexie) und Cloud (Supabase) genutzt.
 * Nur die Persistenz unterscheidet sich; Formular, Validierung und
 * Navigationsschutz bleiben identisch.
 */

import type { Recipe, RecipeImage } from '../types'
import type { EditorImage } from './repository'

export interface RecipeEditorLoad {
  recipe: Recipe | null
  images: RecipeImage[]
  /** Nur im Cloud-Modus: Revision für Compare-and-Swap. */
  rev?: number
}

export interface RecipeEditorSaveContext {
  isNew: boolean
  expectedRev?: number
}

export interface RecipeEditorBackend {
  /** Bilder sind im Cloud-Modus noch nicht angebunden. */
  supportsImages: boolean
  storageHint: string
  deleteHint: string
  load(id?: string): Promise<RecipeEditorLoad | null>
  save(
    recipe: Recipe,
    images: EditorImage[],
    context: RecipeEditorSaveContext,
  ): Promise<void>
  remove(id: string, expectedRev?: number): Promise<void>
}
