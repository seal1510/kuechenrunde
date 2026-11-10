/*
 * Küchenrunde – Cloud-Anbindung des URL-Rezeptimports
 * Copyright (C) 2026 openCook Web contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Wiederverwendet den vorhandenen URL-Import: Parser, Vorschau, Validierung und
 * Dublettenregeln bleiben identisch. Nur die Persistenz läuft über den
 * bestehenden CloudRecipeRepository- und CloudRecipeImageService-Pfad.
 */

import type { CloudRecipeRepository } from '../data/cloudRecipes'
import type { CloudRecipeImageService } from '../data/cloudImages'
import type { UrlDuplicateInfo } from '../import/url-import'
import { findUrlImportDuplicatesIn } from '../import/url-import'
import type { EditorImage } from '../recipe/repository'
import type { Recipe } from '../types'

/**
 * Same duplicate rules as the local import, applied to the loaded Cloud
 * snapshot. A full scan catches URL imports, manual recipes with a matching
 * sourceUrl and other candidates from the same page.
 */
export function findCloudUrlImportDuplicates(
  repository: CloudRecipeRepository,
  importUrl: string,
  candidateKey: string,
): UrlDuplicateInfo {
  return findUrlImportDuplicatesIn(repository.list(), importUrl, candidateKey)
}

/**
 * Persist a newly imported recipe through the existing image service. The
 * service uploads new images to the private `recipe-images` bucket and writes
 * recipe plus image metadata in one atomic apply_ops call. It never overwrites
 * an existing recipe.
 */
export async function saveCloudUrlImportedRecipe(
  images: CloudRecipeImageService,
  recipe: Recipe,
  editorImages: EditorImage[],
): Promise<string[]> {
  if (recipe.importSource !== 'url') {
    throw new Error('Der Cloud-Import akzeptiert nur URL-Rezepte.')
  }
  const result = await images.saveRecipeImages({
    recipe,
    images: editorImages,
    isNew: true,
  })
  return result.warnings
}
