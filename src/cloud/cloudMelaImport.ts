/*
 * Küchenrunde – Mela-Import in die Familien-Cloud
 * Copyright (C) 2026 openCook Web contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Wiederverwendet den vorhandenen Mela-Parser und die reine Recipe-Abbildung.
 * Gespeichert wird über den bestehenden CloudRecipeImageService: Bilder gehen
 * in den privaten Bucket, Rezept und Bild-Metadaten in einen atomaren
 * apply_ops-Aufruf.
 */

import type { CloudRecipeImageService } from '../data/cloudImages'
import type { CloudRecordsStore } from '../data/cloudRecords'
import { CLOUD_RECIPE_IMAGE_MIME_TYPES, MAX_RECIPE_IMAGE_BYTES } from '../import/image-mime'
import { recipeFromParsedMela } from '../import/melaRecipe'
import { randomId } from '../lib/id'
import type { EditorImage } from '../recipe/repository'
import type {
  ImportProgress,
  ImportResult,
  ImportWarning,
  ParsedMelaRecipe,
  Recipe,
} from '../types'

/** Existing Mela import ids from the loaded Cloud snapshot. */
export async function existingCloudImportIds(
  store: CloudRecordsStore,
  ids: string[],
): Promise<Set<string>> {
  const wanted = new Set(ids.filter(Boolean))
  const found = new Set<string>()
  for (const row of store.list<Recipe>('recipes')) {
    if (wanted.has(row.data.importId)) found.add(row.data.importId)
  }
  return found
}

function cloudEditorImages(
  parsed: ParsedMelaRecipe,
  warnings: ImportWarning[],
): EditorImage[] {
  const images: EditorImage[] = []
  parsed.images.forEach((image, index) => {
    const label = `Bild ${index + 1}`
    if (!CLOUD_RECIPE_IMAGE_MIME_TYPES.includes(image.mimeType)) {
      warnings.push({
        title: parsed.title,
        message: `${label} hat ein im Familienspeicher nicht erlaubtes Format (${image.mimeType}) und wurde übersprungen.`,
      })
      return
    }
    if (image.bytes.byteLength === 0) {
      warnings.push({
        title: parsed.title,
        message: `${label} ist leer und wurde übersprungen.`,
      })
      return
    }
    if (image.bytes.byteLength > MAX_RECIPE_IMAGE_BYTES) {
      warnings.push({
        title: parsed.title,
        message: `${label} ist größer als 10 MB und wurde übersprungen.`,
      })
      return
    }
    images.push({
      id: randomId(),
      bytes: image.bytes,
      mimeType: image.mimeType,
      name: `${parsed.title} ${index + 1}`,
    })
  })
  return images
}

function findCloudImportId(store: CloudRecordsStore, importId: string): boolean {
  return store
    .list<Recipe>('recipes')
    .some((row) => row.data.importId === importId)
}

/**
 * Import parsed Mela recipes into the shared Cloud library. Idempotent by Mela
 * import id: an existing recipe is skipped, a concurrent duplicate is reported
 * as duplicate, and a failed recipe never leaves a partial row behind.
 */
export async function importMelaRecipesToCloud(
  store: CloudRecordsStore,
  images: CloudRecipeImageService,
  recipes: ParsedMelaRecipe[],
  onProgress?: (progress: ImportProgress) => void,
): Promise<ImportResult> {
  if (!store.isLoaded()) {
    throw new Error('Die Cloud-Daten sind nicht geladen.')
  }

  const result: ImportResult = {
    imported: 0,
    duplicates: 0,
    failed: [],
    warnings: [],
    images: 0,
  }
  const existing = await existingCloudImportIds(
    store,
    recipes.map((recipe) => recipe.importId),
  )

  for (let index = 0; index < recipes.length; index += 1) {
    const parsed = recipes[index]
    if (!parsed) continue
    onProgress?.({ current: index + 1, total: recipes.length, title: parsed.title })

    if (existing.has(parsed.importId)) {
      result.duplicates += 1
      continue
    }

    const recipe = recipeFromParsedMela(parsed)
    const imageWarnings: ImportWarning[] = []
    const editorImages = cloudEditorImages(parsed, imageWarnings)

    try {
      await images.saveRecipeImages({
        recipe,
        images: editorImages,
        isNew: true,
      })
      existing.add(parsed.importId)
      result.imported += 1
      result.images += editorImages.length
      for (const warning of parsed.warnings) {
        result.warnings.push({ title: parsed.title, message: warning })
      }
      result.warnings.push(...imageWarnings)
    } catch (error) {
      // A concurrent import can win the unique importId index. Treat that as a
      // duplicate instead of a failed recipe.
      if (findCloudImportId(store, parsed.importId)) {
        existing.add(parsed.importId)
        result.duplicates += 1
      } else {
        result.failed.push({
          title: parsed.title,
          message: (error as Error).message || 'Der Import ist fehlgeschlagen.',
        })
      }
    }
  }

  return result
}
