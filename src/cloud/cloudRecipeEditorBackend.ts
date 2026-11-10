/*
 * Küchenrunde – Cloud-Backend des Rezepteditors
 * Copyright (C) 2026 openCook Web contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Nutzt die Rezept-Collection und die Bild-Collection im CloudRecordsStore.
 * Rezept und Bild-Metadaten werden in einem atomaren apply_ops-Aufruf
 * gespeichert; die Bilddateien liegen ausschließlich im privaten Bucket
 * `recipe-images`. Jede Schreiboperation gilt erst nach Bestätigung durch
 * Supabase als erfolgreich.
 */

import type { CloudRecipeRepository } from '../data/cloudRecipes'
import type { CloudRecipeImageService } from '../data/cloudImages'
import { CLOUD_RECIPE_IMAGE_MIME_TYPES } from '../import/image-mime'
import type { RecipeEditorBackend } from '../recipe/editorBackend'

export function createCloudRecipeEditorBackend(
  repository: CloudRecipeRepository,
  images: CloudRecipeImageService,
): RecipeEditorBackend {
  return {
    supportsImages: true,
    imageMimeTypes: CLOUD_RECIPE_IMAGE_MIME_TYPES,
    storageHint:
      'Wird in der Familien-Cloud gespeichert. Bilder liegen im privaten Familienspeicher.',
    deleteHint:
      'Entfernt dieses Rezept und seine Bilder aus der Familien-Cloud. Ein vorheriges Backup wird empfohlen.',

    async load(id) {
      if (!id) return { recipe: null, images: [] }
      const loaded = await repository.load(id)
      if (!loaded) return null
      return {
        recipe: loaded.recipe,
        images: images.listForRecipe(id).map((meta) => ({
          id: meta.id,
          mimeType: meta.mimeType,
          storagePath: meta.storagePath,
          size: meta.size,
        })),
        rev: loaded.rev,
      }
    },

    async save(recipe, editorImages, context) {
      if (!context.isNew && context.expectedRev === undefined) {
        throw new Error('Die Revisionsnummer für das Rezept fehlt.')
      }
      return images.saveRecipeImages({
        recipe,
        images: editorImages,
        isNew: context.isNew,
        expectedRev: context.expectedRev,
      })
    },

    async remove(id, expectedRev) {
      if (expectedRev === undefined) {
        throw new Error('Die Revisionsnummer für das Rezept fehlt.')
      }
      return images.deleteRecipe(id, expectedRev)
    },
  }
}
