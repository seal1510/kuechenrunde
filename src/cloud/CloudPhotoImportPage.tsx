/*
 * Küchenrunde – Cloud-Verdrahtung des Foto-/Scan-Imports
 * Copyright (C) 2026 openCook Web contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Die Oberfläche bleibt vollständig im Browser. Nur die Erkennung geht an den
 * eigenen Endpunkt `/api/recipe-ocr`; das Speichern nutzt die bestehende
 * Cloud-Bildpipeline (`saveRecipeImages`) mit `isNew: true`. Fotos werden nur
 * übergeben, wenn der Nutzer die Checkbox aktiviert hat.
 */

import { useCallback } from 'react'
import type { CloudRecipeImageService } from '../data/cloudImages'
import type { PhotoOcrPage } from '../import/photo-ocr'
import { requestPhotoOcr, type PhotoOcrResult } from '../import/photo-ocr-client'
import { PhotoImportPage } from '../pages/PhotoImportPage'
import type { EditorImage } from '../recipe/repository'
import { getAccessToken } from '../supabase/auth'
import type { Recipe } from '../types'

export interface PhotoOcrCallOptions {
  signal?: AbortSignal
}

/** Ruft den same-origin Endpunkt mit dem aktuellen Supabase-Token auf. */
export function requestCloudPhotoOcr(
  pages: PhotoOcrPage[],
  options: PhotoOcrCallOptions = {},
): Promise<PhotoOcrResult> {
  return requestPhotoOcr(pages, {
    getAccessToken,
    signal: options.signal,
  })
}

/**
 * Speichert ein neues Foto-Rezept über den vorhandenen Cloud-Bilddienst.
 * Seite und Bild-Metadaten werden atomar geschrieben; die Bilddateien liegen
 * ausschließlich im privaten Bucket.
 */
export async function saveCloudPhotoImportedRecipe(
  images: CloudRecipeImageService,
  recipe: Recipe,
  editorImages: EditorImage[],
): Promise<string[]> {
  if (recipe.importSource !== 'photo') {
    throw new Error('Der Cloud-Import akzeptiert nur Foto-Rezepte.')
  }
  const result = await images.saveRecipeImages({
    recipe,
    images: editorImages,
    isNew: true,
  })
  return result.warnings
}

export function CloudPhotoImportPage({
  images,
}: {
  images: CloudRecipeImageService
}) {
  const recognize = useCallback(
    (pages: PhotoOcrPage[], options: PhotoOcrCallOptions = {}) =>
      requestCloudPhotoOcr(pages, options),
    [],
  )
  const saveRecipe = useCallback(
    (recipe: Recipe, editorImages: EditorImage[]) =>
      saveCloudPhotoImportedRecipe(images, recipe, editorImages),
    [images],
  )

  return <PhotoImportPage recognize={recognize} saveRecipe={saveRecipe} />
}
