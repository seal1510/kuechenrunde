/*
 * Küchenrunde – Cloud-Backend des Rezepteditors
 * Copyright (C) 2026 openCook Web contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Nutzt ausschließlich die Rezept-Collection im CloudRecordsStore. Bilder
 * bleiben im Cloud-Modus deaktiviert; jede Schreiboperation wird erst nach
 * Bestätigung durch Supabase als erfolgreich gemeldet.
 */

import type { CloudRecipeRepository } from '../data/cloudRecipes'
import type { RecipeEditorBackend } from '../recipe/editorBackend'

export function createCloudRecipeEditorBackend(
  repository: CloudRecipeRepository,
): RecipeEditorBackend {
  return {
    supportsImages: false,
    storageHint: 'Wird in der Familien-Cloud gespeichert.',
    deleteHint:
      'Entfernt dieses Rezept aus der Familien-Cloud. Ein vorheriges Backup wird empfohlen.',

    async load(id) {
      if (!id) return { recipe: null, images: [] }
      const loaded = await repository.load(id)
      return loaded
        ? { recipe: loaded.recipe, images: [], rev: loaded.rev }
        : null
    },

    async save(recipe, _images, context) {
      if (context.isNew) {
        await repository.create(recipe)
        return
      }
      if (context.expectedRev === undefined) {
        throw new Error('Die Revisionsnummer für das Rezept fehlt.')
      }
      await repository.update(recipe, context.expectedRev)
    },

    async remove(id, expectedRev) {
      if (expectedRev === undefined) {
        throw new Error('Die Revisionsnummer für das Rezept fehlt.')
      }
      await repository.remove(id, expectedRev)
    },
  }
}
