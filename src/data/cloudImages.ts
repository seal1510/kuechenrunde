/*
 * Küchenrunde – Cloud-Bildverwaltung
 * Copyright (C) 2026 openCook Web contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Storage und PostgreSQL sind keine gemeinsame Transaktion. Deshalb gilt eine
 * bewusst kleine, nachvollziehbare Reihenfolge:
 *
 *  Hinzufügen/Ersetzen:
 *    1. neue Datei unter einem frischen Pfad hochladen,
 *    2. Rezept und alle Bild-Metadaten in EINEM apply_ops-Aufruf speichern,
 *    3. bei Fehlern die neuen Dateien wieder entfernen (Best Effort).
 *  Alte Dateien werden erst nach erfolgreichem Metadaten-Schreiben gelöscht.
 *
 *  Entfernen/Löschen:
 *    Metadaten zuerst atomar aktualisieren, Dateien danach löschen. Schlägt
 *    das Dateilöschen fehl, bleibt eine verwaiste Datei zurück, aber niemals
 *    ein Metadatensatz mit fehlender Datei. Der Aufrufer erhält dafür eine
 *    sichtbare Warnung statt eines stillen Erfolgs.
 */

import type { EditorImage } from '../recipe/repository'
import type { Recipe, RecipeImageMeta } from '../types'
import { CloudConflictError, CloudImageError } from './cloudErrors'
import {
  CloudRecordsStore,
  RecordConflictError,
  type RecordRow,
  type RecordsTransaction,
} from './cloudRecords'
import {
  CLOUD_RECIPE_IMAGE_MIME_TYPES,
  MAX_RECIPE_IMAGE_BYTES,
} from '../import/image-mime'
import {
  imageStoragePath,
  replacementImageStoragePath,
  type ImageStoragePort,
} from './imageStorage'

export const IMAGES_COLLECTION = 'images'

export interface ImageWriteResult {
  /** Nicht fatale Aufräumprobleme, die die Oberfläche sichtbar machen muss. */
  warnings: string[]
}

export interface SaveRecipeImagesInput {
  recipe: Recipe
  images: EditorImage[]
  isNew: boolean
  expectedRev?: number
}

interface PreparedUpload {
  meta: RecipeImageMeta
  previousPath?: string
}

interface RecordedMetaRow {
  meta: RecipeImageMeta
  rev: number
}

export interface CloudRecipeImageServiceOptions {
  records: CloudRecordsStore
  storage: ImageStoragePort
  now?: () => number
}

export class CloudRecipeImageService {
  private readonly records: CloudRecordsStore
  private readonly storage: ImageStoragePort
  private readonly now: () => number
  private generation = 0

  constructor(options: CloudRecipeImageServiceOptions) {
    this.records = options.records
    this.storage = options.storage
    this.now = options.now ?? Date.now
  }

  /** Alle Bild-Metadaten eines Rezepts, nach Position sortiert. */
  listForRecipe(recipeId: string): RecipeImageMeta[] {
    return this.metadataRows(recipeId)
      .map((row) => row.data)
      .sort((a, b) => a.position - b.position || a.createdAt - b.createdAt)
  }

  /**
   * Speichert Rezept und Bildliste. Neue Dateien werden vor der atomaren
   * Metadaten-Transaktion hochgeladen. Ein Konflikt oder Fehler beim
   * Metadatenspeichern entfernt die neuen Dateien wieder; bereits vorhandene
   * Dateien werden dabei nie angefasst.
   */
  async saveRecipeImages(input: SaveRecipeImagesInput): Promise<ImageWriteResult> {
    if (!input.isNew && input.expectedRev === undefined) {
      throw new CloudImageError('Die Revisionsnummer für das Rezept fehlt.')
    }

    const now = this.now()
    const existingRows = this.metadataRowMap(input.recipe.id)
    const seen = new Set<string>()
    const uploads: PreparedUpload[] = []

    try {
      for (let index = 0; index < input.images.length; index += 1) {
        const image = input.images[index]
        if (!image) continue
        const id = typeof image.id === 'string' ? image.id.trim() : ''
        if (!id) throw new CloudImageError('Ein Bild hat keine gültige ID.')
        if (seen.has(id)) {
          throw new CloudImageError('Ein Bild darf nicht doppelt in einem Rezept vorkommen.')
        }
        seen.add(id)

        const previous = existingRows.get(id)
        if (!image.bytes) {
          if (!previous) {
            throw new CloudImageError(
              'Ein bereits gespeichertes Bild fehlt in den Cloud-Metadaten. Bitte das Rezept neu laden.',
            )
          }
          continue
        }

        assertUploadable(image)
        const path = previous
          ? replacementImageStoragePath(
              input.recipe.id,
              id,
              `${now}-${this.generation++}`,
            )
          : imageStoragePath(input.recipe.id, id)

        await this.storage.upload(path, image.bytes, image.mimeType)

        uploads.push({
          meta: {
            id,
            recipeId: input.recipe.id,
            position: index,
            mimeType: image.mimeType,
            size: image.bytes.byteLength,
            storagePath: path,
            createdAt: previous?.meta.createdAt ?? now,
            updatedAt: now,
          },
          previousPath: previous?.meta.storagePath,
        })
      }
    } catch (cause) {
      const cleanup = await this.removeFiles(
        uploads.map((entry) => entry.meta.storagePath),
      )
      throw withCleanupWarning(cause, cleanup)
    }

    const removedPaths: string[] = []
    try {
      await this.records.transaction(async (tx) => {
        const currentRows = this.transactionMetadataRows(tx, input.recipe.id)
        const currentById = new Map(currentRows.map((row) => [row.meta.id, row]))

        if (input.isNew) {
          tx.create('recipes', input.recipe.id, input.recipe)
        } else {
          tx.update(
            'recipes',
            input.recipe.id,
            input.recipe,
            input.expectedRev as number,
          )
        }

        for (const upload of uploads) {
          const current = currentById.get(upload.meta.id)
          if (current) {
            tx.update(IMAGES_COLLECTION, upload.meta.id, upload.meta, current.rev)
          } else {
            tx.create(IMAGES_COLLECTION, upload.meta.id, upload.meta)
          }
        }

        for (let index = 0; index < input.images.length; index += 1) {
          const image = input.images[index]
          if (!image || image.bytes) continue
          const current = currentById.get(image.id)
          if (!current) {
            throw new CloudImageError(
              'Ein Bild wurde zwischenzeitlich entfernt. Bitte das Rezept neu laden.',
            )
          }
          if (image.storagePath && image.storagePath !== current.meta.storagePath) {
            throw new CloudConflictError(
              'Ein Bild wurde zwischenzeitlich ersetzt. Bitte das Rezept neu laden.',
            )
          }
          if (current.meta.position === index) continue
          tx.update(
            IMAGES_COLLECTION,
            image.id,
            { ...current.meta, position: index, updatedAt: now },
            current.rev,
          )
        }

        for (const row of currentRows) {
          if (seen.has(row.meta.id)) continue
          tx.remove(IMAGES_COLLECTION, row.meta.id, row.rev)
          removedPaths.push(row.meta.storagePath)
        }
      })
    } catch (cause) {
      const committed = this.metadataCommitVisible(input.recipe, uploads)
      if (committed === true) {
        // Die Antwort ging verloren, die Transaktion war aber erfolgreich.
        const oldPaths = cleanupOldPaths(uploads, removedPaths)
        const cleanup = await this.removeFiles(oldPaths)
        return {
          warnings:
            cleanup.length > 0
              ? [
                  ...cleanup,
                  'Das Rezept wurde gespeichert. Eine nicht mehr benötigte Bilddatei konnte nicht aus dem Speicher entfernt werden.',
                ]
              : [],
        }
      }
      if (committed === null) {
        throw new CloudImageError(
          'Der Speicherstatus der Bilder ist unklar. Die neuen Dateien wurden vorsichtshalber nicht entfernt. Bitte die Seite neu laden.',
        )
      }
      const cleanup = await this.removeFiles(uploads.map((entry) => entry.meta.storagePath))
      throw withCleanupWarning(cause, cleanup)
    }

    const cleanup = await this.removeFiles(cleanupOldPaths(uploads, removedPaths))
    return {
      warnings:
        cleanup.length > 0
          ? [
              ...cleanup,
              'Das Rezept wurde gespeichert. Eine nicht mehr benötigte Bilddatei konnte nicht aus dem Speicher entfernt werden.',
            ]
          : [],
    }
  }

  /**
   * Löscht Rezept und Bild-Metadaten atomar und entfernt die Dateien danach.
   * Schlägt das Dateilöschen fehl, bleibt nur eine verwaiste Datei ohne
   * Metadaten-Referenz zurück; das wird als Warnung gemeldet.
   */
  async deleteRecipe(recipeId: string, expectedRev: number): Promise<ImageWriteResult> {
    if (!Number.isInteger(expectedRev) || expectedRev <= 0) {
      throw new CloudImageError('Die Revisionsnummer für das Löschen fehlt.')
    }

    let removedPaths: string[] = []
    try {
      await this.records.transaction(async (tx) => {
        const rows = this.transactionMetadataRows(tx, recipeId)
        tx.remove('recipes', recipeId, expectedRev)
        for (const row of rows) {
          tx.remove(IMAGES_COLLECTION, row.meta.id, row.rev)
        }
        removedPaths = rows.map((row) => row.meta.storagePath)
      })
    } catch (cause) {
      const committed = this.deletionCommitVisible(recipeId)
      if (committed === true) {
        const cleanup = await this.removeFiles(removedPaths)
        return {
          warnings:
            cleanup.length > 0
              ? [
                  ...cleanup,
                  'Das Rezept wurde gelöscht. Mindestens eine Bilddatei konnte nicht aus dem Speicher entfernt werden.',
                ]
              : [],
        }
      }
      if (committed === null) {
        throw new CloudImageError(
          'Der Löschstatus der Bilder ist unklar. Bitte die Seite neu laden.',
        )
      }
      throw cause
    }

    const cleanup = await this.removeFiles(removedPaths)
    return {
      warnings:
        cleanup.length > 0
          ? [
              ...cleanup,
              'Das Rezept wurde gelöscht. Mindestens eine Bilddatei konnte nicht aus dem Speicher entfernt werden.',
            ]
          : [],
    }
  }

  /* ---------------------------------------------------------------- */
  /* Intern                                                            */
  /* ---------------------------------------------------------------- */

  private metadataRows(recipeId: string): RecordRow<RecipeImageMeta>[] {
    return this.records
      .list<RecipeImageMeta>(IMAGES_COLLECTION)
      .filter((row) => row.data?.recipeId === recipeId)
      .map((row) => ({ ...row, data: parseImageMetadata(row.data) }))
  }

  private metadataRowMap(recipeId: string): Map<string, RecordedMetaRow> {
    return new Map(
      this.metadataRows(recipeId).map((row) => [row.data.id, { meta: row.data, rev: row.rev }]),
    )
  }

  private transactionMetadataRows(
    tx: RecordsTransaction,
    recipeId: string,
  ): RecordedMetaRow[] {
    return tx
      .list<RecipeImageMeta>(IMAGES_COLLECTION)
      .filter((row) => row.data?.recipeId === recipeId)
      .map((row) => ({ meta: parseImageMetadata(row.data), rev: row.rev }))
  }

  /**
   * Nach einem unklaren Fehler prüfen, ob die Metadaten trotzdem sichtbar
   * gespeichert wurden. `null` bedeutet: Der Store ist nicht geladen und die
   * Lage ist nicht sicher beurteilbar.
   */
  private metadataCommitVisible(
    recipe: Recipe,
    uploads: readonly PreparedUpload[],
  ): boolean | null {
    if (!this.records.isLoaded()) return null
    try {
      const recipeRow = this.records.get<Recipe>('recipes', recipe.id)
      if (!recipeRow || !sameJson(recipeRow.data, recipe)) return false
      for (const upload of uploads) {
        const row = this.records.get<RecipeImageMeta>(IMAGES_COLLECTION, upload.meta.id)
        if (!row || !sameJson(row.data, upload.meta)) return false
      }
      return true
    } catch {
      return null
    }
  }

  private deletionCommitVisible(recipeId: string): boolean | null {
    if (!this.records.isLoaded()) return null
    try {
      if (this.records.get('recipes', recipeId)) return false
      return !this.records
        .list<RecipeImageMeta>(IMAGES_COLLECTION)
        .some((row) => row.data?.recipeId === recipeId)
    } catch {
      return null
    }
  }

  private async removeFiles(paths: readonly string[]): Promise<string[]> {
    const unique = [...new Set(paths.filter((path) => Boolean(path?.trim())))]
    if (unique.length === 0) return []
    try {
      await this.storage.remove(unique)
      return []
    } catch (cause) {
      return [errorMessage(cause, 'Die Bilddatei konnte nicht entfernt werden.')]
    }
  }
}

/** Validiert eine Metadatenzeile aus der Cloud-Collection `images`. */
export function parseImageMetadata(value: unknown): RecipeImageMeta {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new CloudImageError('Ein Bilddatensatz in der Cloud ist ungültig.')
  }
  const row = value as Record<string, unknown>
  const id = typeof row.id === 'string' ? row.id.trim() : ''
  const recipeId = typeof row.recipeId === 'string' ? row.recipeId.trim() : ''
  const storagePath = typeof row.storagePath === 'string' ? row.storagePath.trim() : ''
  const mimeType = typeof row.mimeType === 'string' ? row.mimeType.trim() : ''
  const position = row.position
  const size = row.size
  if (!id || !recipeId) throw new CloudImageError('Ein Bilddatensatz hat keine gültige ID.')
  if (!storagePath.startsWith(`${recipeId}/`)) {
    throw new CloudImageError('Ein Bilddatensatz hat keinen gültigen Speicherpfad.')
  }
  if (!mimeType) throw new CloudImageError('Ein Bilddatensatz hat keinen MIME-Typ.')
  if (
    typeof position !== 'number' ||
    !Number.isInteger(position) ||
    position < 0
  ) {
    throw new CloudImageError('Ein Bilddatensatz hat keine gültige Position.')
  }
  if (typeof size !== 'number' || !Number.isFinite(size) || size < 0) {
    throw new CloudImageError('Ein Bilddatensatz hat keine gültige Größe.')
  }
  return {
    id,
    recipeId,
    position,
    mimeType,
    size: Math.round(size),
    storagePath,
    createdAt: finiteTimestamp(row.createdAt),
    updatedAt: finiteTimestamp(row.updatedAt),
  }
}

function finiteTimestamp(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.round(value)
    : 0
}

function assertUploadable(image: EditorImage): void {
  if (!image.mimeType || !CLOUD_RECIPE_IMAGE_MIME_TYPES.includes(image.mimeType)) {
    throw new CloudImageError(
      `„${image.name || 'Das Bild'}“ hat einen im Familienspeicher nicht erlaubten Dateityp.`,
    )
  }
  if (!image.bytes) {
    throw new CloudImageError('Dem Bild fehlen die Bilddaten.')
  }
  if (image.bytes.byteLength > MAX_RECIPE_IMAGE_BYTES) {
    throw new CloudImageError(
      `„${image.name || 'Das Bild'}“ ist größer als 10 MB.`,
    )
  }
  if (image.bytes.byteLength === 0) {
    throw new CloudImageError(`„${image.name || 'Das Bild'}“ ist leer.`)
  }
}

function cleanupOldPaths(
  uploads: readonly PreparedUpload[],
  removedPaths: readonly string[],
): string[] {
  return [
    ...removedPaths,
    ...uploads
      .map((upload) => upload.previousPath)
      .filter((path): path is string => Boolean(path)),
  ]
}

function errorMessage(cause: unknown, fallback: string): string {
  if (cause instanceof Error && cause.message.trim()) return cause.message
  return fallback
}

function sameJson(left: unknown, right: unknown): boolean {
  try {
    return canonicalJson(left) === canonicalJson(right)
  } catch {
    return false
  }
}

/**
 * Order-independent JSON comparison. PostgreSQL jsonb does not preserve object
 * key order, so a plain JSON.stringify would misjudge a successfully committed
 * transaction after a lost response.
 */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry ?? null)).join(',')}]`
  }
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>
    const entries = Object.keys(record)
      .sort()
      .filter((key) => record[key] !== undefined)
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    return `{${entries.join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

function withCleanupWarning(cause: unknown, cleanup: readonly string[]): Error {
  if (cleanup.length === 0) {
    return cause instanceof Error ? cause : new CloudImageError('Der Bildvorgang ist fehlgeschlagen.')
  }
  const message = `${errorMessage(cause, 'Der Bildvorgang ist fehlgeschlagen.')} ${cleanup.join(' ')}`
  if (cause instanceof CloudConflictError || cause instanceof RecordConflictError) {
    return new CloudConflictError(message)
  }
  return new CloudImageError(message)
}
