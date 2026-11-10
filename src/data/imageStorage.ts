/*
 * Küchenrunde – Zugriff auf den privaten Bildspeicher
 * Copyright (C) 2026 openCook Web contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Bewusst kleine Schnittstelle zwischen der Cloud-Bildverwaltung und
 * Supabase Storage. Sie kennt weder React noch Dexie und lässt sich in Tests
 * durch ein Double ersetzen. Signed URLs werden nur im Arbeitsspeicher
 * gehalten und niemals in der Datenbank gespeichert.
 */

import { CloudImageError } from './cloudErrors'

export const RECIPE_IMAGES_BUCKET = 'recipe-images'

export interface ImageStoragePort {
  /** Lädt eine neue Datei hoch. Ein vorhandener Pfad darf nicht überschrieben werden. */
  upload(path: string, bytes: ArrayBuffer, mimeType: string): Promise<void>
  /** Erzeugt eine zeitlich begrenzte, authentifizierte Download-URL. */
  createSignedUrl(path: string, expiresInSeconds: number): Promise<string>
  /** Entfernt eine oder mehrere Dateien. Fehlende Dateien gelten als entfernt. */
  remove(paths: readonly string[]): Promise<void>
}

/**
 * Deterministischer Pfad für ein neues Bild. Die ID stammt aus dem Editor und
 * bleibt über die Metadatenzeile stabil.
 */
export function imageStoragePath(recipeId: string, imageId: string): string {
  assertPathPart(recipeId, 'Rezept-ID')
  assertPathPart(imageId, 'Bild-ID')
  return `${recipeId}/${imageId}`
}

/**
 * Eigener Pfad für eine Ersetzung. Dadurch wird die bisherige Datei niemals
 * überschrieben, bevor die neuen Metadaten erfolgreich gespeichert sind.
 */
export function replacementImageStoragePath(
  recipeId: string,
  imageId: string,
  generation: string,
): string {
  assertPathPart(recipeId, 'Rezept-ID')
  assertPathPart(imageId, 'Bild-ID')
  if (typeof generation !== 'string' || !/^[A-Za-z0-9._-]+$/.test(generation)) {
    throw new CloudImageError('Ungültige Bildgeneration.')
  }
  return `${recipeId}/${imageId}-${generation}`
}

function assertPathPart(value: string, label: string): void {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.includes('/') ||
    value.includes('\\') ||
    value === '.' ||
    value === '..'
  ) {
    throw new CloudImageError(`${label} ist für einen Speicherpfad ungültig.`)
  }
}

/**
 * Formatiert einen Storage-Fehler ohne Secrets oder Signed-URL-Parameter.
 * Supabase liefert bei RLS-Verstößen oft nur eine generische Meldung.
 */
export function imageStorageFailure(
  action: 'upload' | 'download' | 'delete',
  cause: unknown,
): CloudImageError {
  const fallback =
    action === 'upload'
      ? 'Das Bild konnte nicht in den Familienspeicher hochgeladen werden.'
      : action === 'download'
        ? 'Das Bild konnte nicht aus dem Familienspeicher geladen werden.'
        : 'Das Bild konnte nicht aus dem Familienspeicher entfernt werden.'
  if (cause instanceof CloudImageError) return cause
  const code =
    typeof cause === 'object' && cause !== null
      ? String((cause as { code?: unknown }).code ?? '')
      : ''
  return new CloudImageError(fallback, code || undefined)
}
