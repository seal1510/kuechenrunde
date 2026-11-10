/*
 * Küchenrunde – ZIP-Backup der gemeinsamen Cloud-Daten
 * Copyright (C) 2026 openCook Web contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Verwendet dasselbe ZIP-Format und denselben Inspektor wie der lokale Modus.
 * Export liest den geladenen Cloud-Snapshot und lädt die Bildbytes aus dem
 * privaten Supabase-Bucket. Restore schreibt ausschließlich in einen leeren
 * Cloud-Bestand; vorhandene Familiendaten werden weder gelöscht noch
 * überschrieben.
 */

import {
  BackupError,
  createBackupArchive,
  type BackupImage,
  type BackupInspection,
  type RestoreResult,
} from '../backup/backup'
import { CLOUD_RECIPE_IMAGE_MIME_TYPES, MAX_RECIPE_IMAGE_BYTES } from '../import/image-mime'
import { parseImageMetadata } from '../data/cloudImages'
import type { CloudRecordsStore } from '../data/cloudRecords'
import {
  imageStoragePath,
  type ImageStoragePort,
} from '../data/imageStorage'
import type {
  CookSession,
  DayNote,
  FreeDish,
  MealDay,
  MealPlanEntry,
  Recipe,
  RecipeImageMeta,
  SettingRecord,
  ShoppingDemandAllocation,
  ShoppingItemRule,
  ShoppingList,
  ShoppingManualItem,
  ShoppingPurchase,
  ShoppingQuantityCorrection,
} from '../types'

function rows<T>(store: CloudRecordsStore, collection: string): T[] {
  return store.list<T>(collection).map((row) => row.data)
}

function errorMessage(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message.trim() ? cause.message : fallback
}

function sameJson(left: unknown, right: unknown): boolean {
  try {
    return canonicalJson(left) === canonicalJson(right)
  } catch {
    return false
  }
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry ?? null)).join(',')}]`
  }
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record)
      .sort()
      .filter((key) => record[key] !== undefined)
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

/** Export all shared Cloud collections and image bytes as a normal ZIP backup. */
export async function exportCloudBackup(
  store: CloudRecordsStore,
  storage: ImageStoragePort,
): Promise<{ bytes: Uint8Array; manifest: ReturnType<typeof createBackupArchive>['manifest'] }> {
  if (!store.isLoaded()) {
    throw new BackupError('Die Cloud-Daten sind nicht geladen.')
  }

  const imageRows = rows<RecipeImageMeta>(store, 'images').map((value) =>
    parseImageMetadata(value),
  )
  const images: BackupImage[] = []
  for (const meta of imageRows) {
    const bytes = await storage.download(meta.storagePath)
    images.push({
      meta: {
        id: meta.id,
        recipeId: meta.recipeId,
        position: meta.position,
        mimeType: meta.mimeType,
      },
      bytes,
    })
  }

  return createBackupArchive({
    recipes: rows<Recipe>(store, 'recipes'),
    images,
    mealPlans: rows<MealPlanEntry>(store, 'mealPlans'),
    mealDays: rows<MealDay>(store, 'mealDays'),
    settings: rows<SettingRecord>(store, 'settings'),
    cookSessions: rows<CookSession>(store, 'cookSessions'),
    dayNotes: rows<DayNote>(store, 'dayNotes'),
    freeDishes: rows<FreeDish>(store, 'freeDishes'),
    shoppingManualItems: rows<ShoppingManualItem>(store, 'shoppingManualItems'),
    shoppingChecks: rows(store, 'shoppingChecks'),
    shoppingPurchases: rows<ShoppingPurchase>(store, 'shoppingPurchases'),
    shoppingItemRules: rows<ShoppingItemRule>(store, 'shoppingItemRules'),
    shoppingQuantityCorrections: rows<ShoppingQuantityCorrection>(
      store,
      'shoppingQuantityCorrections',
    ),
    shoppingLists: rows<ShoppingList>(store, 'shoppingLists'),
    shoppingDemandAllocations: rows<ShoppingDemandAllocation>(
      store,
      'shoppingDemandAllocations',
    ),
  })
}

function assertEmptyCloud(store: CloudRecordsStore): void {
  if (!store.isLoaded()) {
    throw new BackupError('Die Cloud-Daten sind nicht geladen.')
  }
  const collections = store.collections()
  if (collections.length > 0) {
    throw new BackupError(
      'Die Familien-Cloud enthält bereits Daten. Eine Wiederherstellung ist nur in einen leeren Cloud-Bestand möglich; vorhandene Familiendaten werden nicht überschrieben.',
    )
  }
}

function assertUnique<T>(
  items: readonly T[],
  key: (item: T) => string,
  label: string,
): void {
  const seen = new Set<string>()
  for (const item of items) {
    const value = key(item)
    if (seen.has(value)) {
      throw new BackupError(`Das Backup enthält ${label} doppelt (${value}).`)
    }
    seen.add(value)
  }
}

interface PreparedImage {
  meta: RecipeImageMeta
  bytes: ArrayBuffer
  path: string
}

function validateAndPrepare(
  inspection: BackupInspection,
  now: number,
): {
  images: PreparedImage[]
  entries: Array<{ collection: string; id: string; data: unknown }>
  result: RestoreResult
} {
  if (inspection.conflicts.overlappingStandardPeriods > 0) {
    throw new BackupError(
      'Das Backup enthält überlappende Standard-Einkaufsperioden und kann nicht wiederhergestellt werden.',
    )
  }

  assertUnique(inspection.recipes, (entry) => entry.id, 'Rezept-IDs')
  assertUnique(inspection.recipes, (entry) => entry.importId, 'Mela/Import-IDs')
  assertUnique(inspection.images, (entry) => entry.meta.id, 'Bild-IDs')
  assertUnique(inspection.mealPlans, (entry) => entry.id, 'Essenstermin-IDs')
  assertUnique(inspection.mealDays, (entry) => entry.date, 'Tagesflags')
  assertUnique(inspection.settings, (entry) => entry.key, 'Einstellungen')
  assertUnique(inspection.cookSessions, (entry) => entry.id, 'Kochvorgangs-IDs')
  assertUnique(inspection.dayNotes, (entry) => entry.date, 'Tagesnotizen')
  assertUnique(inspection.freeDishes, (entry) => entry.id, 'freie-Gericht-IDs')
  assertUnique(inspection.shoppingManualItems, (entry) => entry.id, 'Einkaufsartikel-IDs')
  assertUnique(inspection.shoppingPurchases, (entry) => entry.id, 'Kauf-IDs')
  assertUnique(inspection.shoppingItemRules, (entry) => entry.key, 'Einkaufsregel-IDs')
  assertUnique(
    inspection.shoppingQuantityCorrections,
    (entry) => entry.id,
    'Mengenkorrektur-IDs',
  )
  assertUnique(inspection.shoppingLists, (entry) => entry.id, 'Einkaufslisten-IDs')
  assertUnique(
    inspection.shoppingDemandAllocations,
    (entry) => entry.id,
    'Einkaufszuordnungs-IDs',
  )

  const recipeIds = new Set(inspection.recipes.map((entry) => entry.id))
  const freeDishIds = new Set(inspection.freeDishes.map((entry) => entry.id))
  const sessionIds = new Set(inspection.cookSessions.map((entry) => entry.id))
  const listIds = new Set(inspection.shoppingLists.map((entry) => entry.id))

  for (const plan of inspection.mealPlans) {
    if (plan.recipeId && !recipeIds.has(plan.recipeId)) {
      throw new BackupError(
        `Der Essenstermin ${plan.id} verweist auf ein Rezept, das im Backup fehlt.`,
      )
    }
    if (plan.freeDishId && !freeDishIds.has(plan.freeDishId)) {
      throw new BackupError(
        `Der Essenstermin ${plan.id} verweist auf ein freies Gericht, das im Backup fehlt.`,
      )
    }
    if (plan.cookSessionId && !sessionIds.has(plan.cookSessionId)) {
      throw new BackupError(
        `Der Essenstermin ${plan.id} verweist auf einen Kochvorgang, der im Backup fehlt.`,
      )
    }
  }
  for (const session of inspection.cookSessions) {
    if (session.recipeId && !recipeIds.has(session.recipeId)) {
      throw new BackupError(
        `Der Kochvorgang ${session.id} verweist auf ein Rezept, das im Backup fehlt.`,
      )
    }
    if (session.freeDishId && !freeDishIds.has(session.freeDishId)) {
      throw new BackupError(
        `Der Kochvorgang ${session.id} verweist auf ein freies Gericht, das im Backup fehlt.`,
      )
    }
  }
  for (const allocation of inspection.shoppingDemandAllocations) {
    if (!listIds.has(allocation.listId)) {
      throw new BackupError(
        `Eine Einkaufszuordnung verweist auf eine Einkaufsliste, die im Backup fehlt.`,
      )
    }
  }

  const images: PreparedImage[] = []
  for (const image of inspection.images) {
    if (!recipeIds.has(image.meta.recipeId)) {
      throw new BackupError(
        `Das Bild ${image.meta.id} verweist auf ein Rezept, das im Backup fehlt.`,
      )
    }
    if (!CLOUD_RECIPE_IMAGE_MIME_TYPES.includes(image.meta.mimeType)) {
      throw new BackupError(
        `Das Bild ${image.meta.id} hat ein im Familienspeicher nicht erlaubtes Format (${image.meta.mimeType}).`,
      )
    }
    if (image.bytes.byteLength === 0) {
      throw new BackupError(`Das Bild ${image.meta.id} ist leer.`)
    }
    if (image.bytes.byteLength > MAX_RECIPE_IMAGE_BYTES) {
      throw new BackupError(`Das Bild ${image.meta.id} ist größer als 10 MB.`)
    }
    let path: string
    try {
      path = imageStoragePath(image.meta.recipeId, image.meta.id)
    } catch (cause) {
      throw new BackupError(
        `Das Bild ${image.meta.id} hat keinen gültigen Speicherpfad: ${errorMessage(cause, 'ungültig')}`,
      )
    }
    images.push({
      meta: {
        id: image.meta.id,
        recipeId: image.meta.recipeId,
        position: image.meta.position,
        mimeType: image.meta.mimeType,
        size: image.bytes.byteLength,
        storagePath: path,
        createdAt: now,
        updatedAt: now,
      },
      bytes: image.bytes,
      path,
    })
  }

  const entries: Array<{ collection: string; id: string; data: unknown }> = []
  for (const recipe of inspection.recipes) {
    entries.push({ collection: 'recipes', id: recipe.id, data: recipe })
  }
  for (const image of images) {
    entries.push({ collection: 'images', id: image.meta.id, data: image.meta })
  }
  for (const freeDish of inspection.freeDishes) {
    entries.push({ collection: 'freeDishes', id: freeDish.id, data: freeDish })
  }
  for (const session of inspection.cookSessions) {
    entries.push({ collection: 'cookSessions', id: session.id, data: session })
  }
  for (const plan of inspection.mealPlans) {
    entries.push({ collection: 'mealPlans', id: plan.id, data: plan })
  }
  for (const day of inspection.mealDays) {
    entries.push({ collection: 'mealDays', id: day.date, data: day })
  }
  for (const setting of inspection.settings) {
    entries.push({ collection: 'settings', id: setting.key, data: setting })
  }
  for (const note of inspection.dayNotes) {
    entries.push({ collection: 'dayNotes', id: note.date, data: note })
  }
  for (const list of inspection.shoppingLists) {
    entries.push({ collection: 'shoppingLists', id: list.id, data: list })
  }
  for (const item of inspection.shoppingManualItems) {
    entries.push({ collection: 'shoppingManualItems', id: item.id, data: item })
  }
  for (const purchase of inspection.shoppingPurchases) {
    entries.push({ collection: 'shoppingPurchases', id: purchase.id, data: purchase })
  }
  for (const rule of inspection.shoppingItemRules) {
    entries.push({ collection: 'shoppingItemRules', id: rule.key, data: rule })
  }
  for (const correction of inspection.shoppingQuantityCorrections) {
    entries.push({
      collection: 'shoppingQuantityCorrections',
      id: correction.id,
      data: correction,
    })
  }
  for (const allocation of inspection.shoppingDemandAllocations) {
    entries.push({
      collection: 'shoppingDemandAllocations',
      id: allocation.id,
      data: allocation,
    })
  }

  const result: RestoreResult = {
    mode: 'replace',
    addedRecipes: inspection.recipes.length,
    skippedRecipes: 0,
    addedImages: inspection.images.length,
    addedMealPlans: inspection.mealPlans.length,
    skippedMealPlans: 0,
    addedMealDays: inspection.mealDays.length,
    addedSettings: inspection.settings.length,
    addedCookSessions: inspection.cookSessions.length,
    skippedCookSessions: 0,
    addedDayNotes: inspection.dayNotes.length,
    skippedDayNotes: 0,
    addedFreeDishes: inspection.freeDishes.length,
    skippedFreeDishes: 0,
    addedShoppingManualItems: inspection.shoppingManualItems.length,
    skippedShoppingManualItems: 0,
    addedShoppingChecks: 0,
    skippedShoppingChecks: 0,
    addedShoppingPurchases: inspection.shoppingPurchases.length,
    skippedShoppingPurchases: 0,
    addedShoppingItemRules: inspection.shoppingItemRules.length,
    skippedShoppingItemRules: 0,
    addedShoppingQuantityCorrections: inspection.shoppingQuantityCorrections.length,
    skippedShoppingQuantityCorrections: 0,
    addedShoppingLists: inspection.shoppingLists.length,
    skippedShoppingLists: 0,
    addedShoppingDemandAllocations: inspection.shoppingDemandAllocations.length,
    skippedShoppingDemandAllocations: 0,
    orphanedManualPurchaseReferences: inspection.conflicts.orphanedManualPurchaseReferences,
    detachedMealLinks: 0,
  }

  return { images, entries, result }
}

async function cleanupImages(
  storage: ImageStoragePort,
  paths: readonly string[],
): Promise<string> {
  const unique = [...new Set(paths.filter(Boolean))]
  if (unique.length === 0) return ''
  try {
    await storage.remove(unique)
    return ''
  } catch (cause) {
    return ` Mindestens eine bereits hochgeladene Bilddatei konnte nicht entfernt werden: ${errorMessage(
      cause,
      'unbekannter Fehler',
    )}`
  }
}

function commitVisible(
  store: CloudRecordsStore,
  entries: ReadonlyArray<{ collection: string; id: string; data: unknown }>,
): boolean | null {
  if (!store.isLoaded()) return null
  try {
    let present = 0
    for (const entry of entries) {
      const row = store.get(entry.collection, entry.id)
      if (row && sameJson(row.data, entry.data)) present += 1
    }
    if (present === entries.length) return true
    if (present === 0) return false
    return null
  } catch {
    return null
  }
}

/**
 * Restore a checked backup into an empty Cloud dataset. The records are written
 * in one atomic apply_ops transaction. Images are uploaded before the metadata;
 * a failed metadata write removes only the files uploaded by this attempt.
 */
export async function restoreCloudBackup(
  inspection: BackupInspection,
  store: CloudRecordsStore,
  storage: ImageStoragePort,
): Promise<RestoreResult> {
  assertEmptyCloud(store)
  const prepared = validateAndPrepare(inspection, Date.now())
  const paths = prepared.images.map((image) => image.path)

  // Clear leftovers from an interrupted earlier attempt. Because the Cloud
  // dataset is empty, no existing metadata can reference these paths.
  if (paths.length > 0) {
    try {
      await storage.remove(paths)
    } catch (cause) {
      throw new BackupError(
        `Die Wiederherstellung konnte nicht vorbereitet werden: ${errorMessage(
          cause,
          'Bildspeicher nicht erreichbar',
        )}`,
      )
    }
  }

  const uploaded: string[] = []
  try {
    for (const image of prepared.images) {
      await storage.upload(image.path, image.bytes, image.meta.mimeType)
      uploaded.push(image.path)
    }
  } catch (cause) {
    const cleanup = await cleanupImages(storage, uploaded)
    throw new BackupError(
      `Die Wiederherstellung ist beim Hochladen eines Bildes fehlgeschlagen: ${errorMessage(
        cause,
        'unbekannter Fehler',
      )}.${cleanup}`,
    )
  }

  try {
    await store.transaction(async (tx) => {
      for (const entry of prepared.entries) {
        tx.create(entry.collection, entry.id, entry.data)
      }
    })
    return prepared.result
  } catch (cause) {
    const committed = commitVisible(store, prepared.entries)
    if (committed === true) return prepared.result
    if (committed === false) {
      const cleanup = await cleanupImages(storage, uploaded)
      throw new BackupError(
        `Die Wiederherstellung ist fehlgeschlagen: ${errorMessage(
          cause,
          'unbekannter Fehler',
        )}.${cleanup}`,
      )
    }
    throw new BackupError(
      'Der Speicherstatus der Wiederherstellung ist unklar. Die hochgeladenen Bilddateien wurden vorsichtshalber nicht entfernt. Bitte die Seite neu laden und den Cloud-Bestand prüfen.',
    )
  }
}
