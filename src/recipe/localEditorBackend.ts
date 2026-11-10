/*
 * Küchenrunde – lokales Rezepteditor-Backend
 * Copyright (C) 2026 openCook Web contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Bewahrt das bisherige Verhalten von RecipeEditorPage: Laden über Dexie,
 * Speichern inklusive Bildern und der vollständige Löschpfad.
 */

import { db } from '../db'
import { deleteRecipe } from '../import/importer'
import { loadRecipeEditorData, saveRecipeWithImages } from './repository'
import type { RecipeEditorBackend } from './editorBackend'

export const localRecipeEditorBackend: RecipeEditorBackend = {
  supportsImages: true,
  storageHint: 'Wird lokal als manuelles Rezept gespeichert.',
  deleteHint:
    'Entfernt dieses Rezept und seine Bilder. Ein vorheriges Backup wird empfohlen.',

  async load(id) {
    if (!id) return { recipe: null, images: [] }
    const data = await loadRecipeEditorData(id)
    return data ? { recipe: data.recipe, images: data.images } : null
  },

  async save(recipe, images, context) {
    if (!context.isNew) {
      const existing = await db.recipes.get(recipe.id)
      if (!existing) throw new Error('Das Rezept wurde nicht gefunden.')
    }
    await saveRecipeWithImages(recipe, images)
  },

  async remove(id) {
    await deleteRecipe(id)
  },
}
