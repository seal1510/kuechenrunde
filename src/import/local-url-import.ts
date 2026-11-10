/*
 * Küchenrunde – lokale Persistenz des URL-Imports
 * Copyright (C) 2026 openCook Web contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Dieser Modul ist die einzige Stelle, die den vorhandenen URL-Import mit
 * Dexie verbindet. Die reine Importlogik in url-import.ts bleibt dadurch frei
 * von der lokalen Datenbank und kann auch im Cloud-Pfad verwendet werden.
 */

import { db } from '../db'
import { saveRecipeWithImages, type EditorImage } from '../recipe/repository'
import type { Recipe } from '../types'
import {
  findUrlImportDuplicatesIn,
  type UrlDuplicateInfo,
} from './url-import'

/** Local Dexie variant; the cloud import passes the loaded snapshot instead. */
export async function findUrlImportDuplicates(
  importUrl: string,
  candidateKey: string,
): Promise<UrlDuplicateInfo> {
  return findUrlImportDuplicatesIn(await db.recipes.toArray(), importUrl, candidateKey)
}

/** Save a confirmed URL import into the local Dexie library. */
export async function saveLocalUrlImport(
  recipe: Recipe,
  images: EditorImage[],
): Promise<string[]> {
  await saveRecipeWithImages(recipe, images)
  return []
}
