/*
 * openCook Web
 * Copyright (C) 2026 openCook Web contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Versioned ZIP backup containing recipes (including raw Mela data, tags and
 * stable ids), images, the week plan, cooking events, free dishes, day flags,
 * day notes and settings. Restore is either a non-destructive merge or an
 * explicitly confirmed full replacement.
 */

import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { db } from '../db'
import { sessionMatchesEntry } from '../domain/dishSource'
import { normalizeInstructionList } from '../recipe/references'
import {
  SHOPPING_CATEGORIES,
  shoppingIdentityMappings,
  shoppingItemKey,
} from '../domain/shopping'
import {
  shoppingAllocationId,
  shoppingPeriod,
  standardShoppingListId,
  standardShoppingListRecord,
} from '../domain/shoppingLists'
import {
  DEFAULT_HOUSEHOLD_SIZE,
  type CookSession,
  type DayNote,
  type FreeDish,
  type Ingredient,
  type MealDay,
  type MealPlanEntry,
  type Recipe,
  type RecipeImage,
  type RecipeImportMeta,
  type SettingRecord,
  type ShoppingCheck,
  type ShoppingDemandAllocation,
  type ShoppingItemRule,
  type ShoppingList,
  type ShoppingManualItem,
  type ShoppingPurchase,
  type ShoppingQuantityCorrection,
} from '../types'

export const BACKUP_FORMAT = 'opencook-web-backup'
/**
 * v3 adds free day notes, v4 adds plan-only free dishes, v5 adds the shopping
 * list data, v6 turns aggregate checks into individual purchase actions and
 * dates shopping rows independently from the week start, v7 drops the
 * discontinued pantry data, v8 adds week-scoped quantity corrections, v9 adds
 * structured instruction steps with explicit ingredient references, v10 adds
 * independent shopping lists and partial demand allocations. Older v1–v9
 * backups remain importable; their pantry section is ignored, v5 checks are
 * converted exactly once, and old rows are assigned the deterministic
 * Thursday–Wednesday standard list without changing their dates.
 */
export const BACKUP_VERSION = 10
export const MAX_BACKUP_BYTES = 200 * 1024 * 1024
export const MAX_BACKUP_ENTRIES = 5_000
export const MAX_BACKUP_ENTRY_BYTES = 20 * 1024 * 1024
const ZIP64_SIZE_SENTINEL = 0xffffffff

export interface BackupManifest {
  format: typeof BACKUP_FORMAT
  version: number
  createdAt: string
  appVersion: string
  counts: {
    recipes: number
    images: number
    mealPlans: number
    mealDays: number
    settings: number
    dayNotes: number
    freeDishes: number
    shoppingManualItems: number
    shoppingChecks: number
    shoppingPurchases: number
    shoppingItemRules: number
    shoppingQuantityCorrections: number
    shoppingLists: number
    shoppingDemandAllocations: number
  }
  includes: string[]
}

export interface BackupImageMeta {
  id: string
  recipeId: string
  position: number
  mimeType: string
}

export interface BackupImage {
  meta: BackupImageMeta
  bytes: ArrayBuffer
}

export interface BackupPayload {
  manifest: BackupManifest
  recipes: Recipe[]
  images: BackupImage[]
  mealPlans: MealPlanEntry[]
  mealDays: MealDay[]
  settings: SettingRecord[]
  cookSessions: CookSession[]
  dayNotes: DayNote[]
  freeDishes: FreeDish[]
  shoppingManualItems: ShoppingManualItem[]
  shoppingChecks: ShoppingCheck[]
  shoppingPurchases: ShoppingPurchase[]
  shoppingItemRules: ShoppingItemRule[]
  shoppingQuantityCorrections: ShoppingQuantityCorrection[]
  shoppingLists: ShoppingList[]
  shoppingDemandAllocations: ShoppingDemandAllocation[]
}

export interface BackupConflicts {
  recipes: number
  mealPlans: number
  mealDays: number
  settings: number
  cookSessions: number
  dayNotes: number
  freeDishes: number
  shoppingManualItems: number
  shoppingChecks: number
  shoppingPurchases: number
  shoppingItemRules: number
  shoppingQuantityCorrections: number
  shoppingLists: number
  shoppingDemandAllocations: number
}

export interface BackupInspection {
  manifest: BackupManifest
  recipes: Recipe[]
  images: BackupImage[]
  mealPlans: MealPlanEntry[]
  mealDays: MealDay[]
  settings: SettingRecord[]
  cookSessions: CookSession[]
  dayNotes: DayNote[]
  freeDishes: FreeDish[]
  shoppingManualItems: ShoppingManualItem[]
  shoppingChecks: ShoppingCheck[]
  shoppingPurchases: ShoppingPurchase[]
  shoppingItemRules: ShoppingItemRule[]
  shoppingQuantityCorrections: ShoppingQuantityCorrection[]
  shoppingLists: ShoppingList[]
  shoppingDemandAllocations: ShoppingDemandAllocation[]
  /** Repairs/normalisations applied while reading (e.g. detached broken links). */
  warnings: string[]
  conflicts: BackupConflicts
}

export type RestoreMode = 'merge' | 'replace'

export interface RestoreResult {
  mode: RestoreMode
  addedRecipes: number
  skippedRecipes: number
  addedImages: number
  addedMealPlans: number
  skippedMealPlans: number
  addedMealDays: number
  addedSettings: number
  addedCookSessions: number
  skippedCookSessions: number
  addedDayNotes: number
  skippedDayNotes: number
  addedFreeDishes: number
  skippedFreeDishes: number
  addedShoppingManualItems: number
  skippedShoppingManualItems: number
  addedShoppingChecks: number
  skippedShoppingChecks: number
  addedShoppingPurchases: number
  skippedShoppingPurchases: number
  addedShoppingItemRules: number
  skippedShoppingItemRules: number
  addedShoppingQuantityCorrections: number
  skippedShoppingQuantityCorrections: number
  addedShoppingLists: number
  skippedShoppingLists: number
  addedShoppingDemandAllocations: number
  skippedShoppingDemandAllocations: number
  detachedMealLinks: number
}

export class BackupError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BackupError'
  }
}

function imageFile(id: string): string {
  return `images/${id}.bin`
}

function jsonFile(value: unknown): Uint8Array {
  return strToU8(JSON.stringify(value))
}

export async function exportBackup(): Promise<{ bytes: Uint8Array; manifest: BackupManifest }> {
  const [
    recipes,
    images,
    mealPlans,
    mealDays,
    settings,
    cookSessions,
    dayNotes,
    freeDishes,
    shoppingManualItems,
    shoppingChecks,
    shoppingPurchases,
    shoppingItemRules,
    shoppingQuantityCorrections,
    shoppingLists,
    shoppingDemandAllocations,
  ] = await Promise.all([
    db.recipes.toArray(),
    db.images.toArray(),
    db.mealPlans.toArray(),
    db.mealDays.toArray(),
    db.settings.toArray(),
    db.cookSessions.toArray(),
    db.dayNotes.toArray(),
    db.freeDishes.toArray(),
    db.shoppingManualItems.toArray(),
    db.shoppingChecks.toArray(),
    db.shoppingPurchases.toArray(),
    db.shoppingItemRules.toArray(),
    db.shoppingQuantityCorrections.toArray(),
    db.shoppingLists.toArray(),
    db.shoppingDemandAllocations.toArray(),
  ])

  const manifest: BackupManifest = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    createdAt: new Date().toISOString(),
    appVersion: '0.4.0',
    counts: {
      recipes: recipes.length,
      images: images.length,
      mealPlans: mealPlans.length,
      mealDays: mealDays.length,
      settings: settings.length,
      dayNotes: dayNotes.length,
      freeDishes: freeDishes.length,
      shoppingManualItems: shoppingManualItems.length,
      shoppingChecks: shoppingChecks.length,
      shoppingPurchases: shoppingPurchases.length,
      shoppingItemRules: shoppingItemRules.length,
      shoppingQuantityCorrections: shoppingQuantityCorrections.length,
      shoppingLists: shoppingLists.length,
      shoppingDemandAllocations: shoppingDemandAllocations.length,
    },
    includes: [
      'recipes',
      'images',
      'mealPlans',
      'mealDays',
      'settings',
      'cookSessions',
      'dayNotes',
      'freeDishes',
      'rawMelaData',
      'tags',
      'ingredientNotes',
      'structuredInstructions',
      'ingredientReferences',
      'importMetadata',
      'portionLinks',
      'shoppingList',
      'shoppingLists',
      'shoppingDemandAllocations',
      'quantityCorrections',
    ],
  }

  const files: Record<string, Uint8Array> = {
    'manifest.json': jsonFile(manifest),
    'recipes.json': jsonFile({ version: BACKUP_VERSION, recipes }),
    'images.json': jsonFile({
      version: BACKUP_VERSION,
      images: images.map(({ id, recipeId, position, mimeType }) => ({
        id,
        recipeId,
        position,
        mimeType,
      })),
    }),
    'mealplan.json': jsonFile({
      version: BACKUP_VERSION,
      mealPlans,
      mealDays,
      settings,
      cookSessions,
      dayNotes,
      freeDishes,
    }),
    'shopping.json': jsonFile({
      version: BACKUP_VERSION,
      shoppingManualItems,
      shoppingChecks,
      shoppingPurchases,
      shoppingItemRules,
      shoppingQuantityCorrections,
      shoppingLists,
      shoppingDemandAllocations,
    }),
  }

  for (const image of images) {
    files[imageFile(image.id)] = new Uint8Array(image.bytes)
  }

  const bytes = zipSync(files, { level: 6 })
  if (bytes.byteLength > MAX_BACKUP_BYTES) {
    throw new BackupError(
      `Das Backup ist größer als ${MAX_BACKUP_BYTES / 1024 / 1024} MB. Bitte Bilder reduzieren.`,
    )
  }
  return { bytes, manifest }
}

export async function inspectBackup(buffer: ArrayBuffer): Promise<BackupInspection> {
  if (buffer.byteLength === 0) throw new BackupError('Die Backup-Datei ist leer.')
  if (buffer.byteLength > MAX_BACKUP_BYTES) {
    throw new BackupError('Die Backup-Datei ist zu groß.')
  }

  let unsafe: string | null = null
  let tooLarge = false
  let tooMany = false
  let entryCount = 0
  let total = 0

  let entries: Record<string, Uint8Array>
  try {
    entries = unzipSync(new Uint8Array(buffer), {
      filter: (file) => {
        entryCount += 1
        if (entryCount > MAX_BACKUP_ENTRIES) {
          tooMany = true
          return false
        }
        const name = file.name.replace(/\\/g, '/')
        if (name.startsWith('/') || name.includes('..') || file.name.includes('\\')) {
          unsafe = file.name
          return false
        }
        if (name.endsWith('/')) return false
        if (name.startsWith('__MACOSX/') || name.endsWith('.DS_Store')) return false
        // ZIP64 stores 0xFFFFFFFF in the classic size field; fflate exposes that
        // sentinel in filter(). Treat it as unknown and enforce the cap on the
        // decompressed bytes below instead of rejecting every entry.
        if (file.originalSize !== ZIP64_SIZE_SENTINEL) {
          if (file.originalSize > MAX_BACKUP_ENTRY_BYTES) {
            tooLarge = true
            return false
          }
          total += file.originalSize
          if (total > MAX_BACKUP_BYTES) {
            tooLarge = true
            return false
          }
        }
        return true
      },
    })
  } catch (error) {
    throw new BackupError(`ZIP konnte nicht gelesen werden: ${(error as Error).message}`)
  }

  if (unsafe) throw new BackupError(`Unsicherer Pfad im Backup: ${unsafe}`)
  if (tooMany) throw new BackupError('Das Backup enthält zu viele Einträge.')
  if (tooLarge) throw new BackupError('Das Backup ist entpackt zu groß.')

  let actualTotal = 0
  for (const data of Object.values(entries)) {
    if (data.byteLength > MAX_BACKUP_ENTRY_BYTES) {
      throw new BackupError('Ein Eintrag im Backup ist zu groß.')
    }
    actualTotal += data.byteLength
    if (actualTotal > MAX_BACKUP_BYTES) {
      throw new BackupError('Das Backup ist entpackt zu groß.')
    }
  }

  function readJson<T>(name: string): T {
    const data = entries[name]
    if (!data) throw new BackupError(`Eintrag fehlt: ${name}`)
    try {
      return JSON.parse(strFromU8(data)) as T
    } catch (error) {
      throw new BackupError(`Ungültiges JSON in ${name}: ${(error as Error).message}`)
    }
  }

  const manifest = readJson<BackupManifest>('manifest.json')
  if (manifest.format !== BACKUP_FORMAT) throw new BackupError('Das ist kein openCook-Web-Backup.')
  if (!Number.isInteger(manifest.version) || manifest.version < 1) {
    throw new BackupError('Unbekannte Backup-Version.')
  }
  if (manifest.version > BACKUP_VERSION) {
    throw new BackupError('Das Backup stammt aus einer neueren App-Version.')
  }

  const recipeFile = readJson<{ recipes?: unknown }>('recipes.json')
  if (!Array.isArray(recipeFile.recipes)) throw new BackupError('recipes.json enthält keine Rezeptliste.')
  const recipes: Recipe[] = recipeFile.recipes.map((entry, index) => normalizeRecipe(entry, index))

  const imageFileData = readJson<{ images?: unknown }>('images.json')
  if (!Array.isArray(imageFileData.images)) throw new BackupError('images.json enthält keine Bildliste.')
  const images: BackupImage[] = []
  for (const rawMeta of imageFileData.images) {
    if (!isRecord(rawMeta)) throw new BackupError('Ungültige Bildmetadaten.')
    const id = asString(rawMeta.id)
    if (!/^[A-Za-z0-9._-]+$/.test(id)) throw new BackupError('Ungültige Bild-ID im Backup.')
    const data = entries[imageFile(id)]
    if (!data) throw new BackupError(`Bilddatei fehlt: ${id}`)
    images.push({
      meta: {
        id,
        recipeId: asString(rawMeta.recipeId),
        position: Number(rawMeta.position) || 0,
        mimeType: asString(rawMeta.mimeType) || 'image/jpeg',
      },
      bytes: data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer,
    })
  }

  const planFile = readJson<{
    mealPlans?: unknown
    mealDays?: unknown
    settings?: unknown
    cookSessions?: unknown
    dayNotes?: unknown
    freeDishes?: unknown
  }>('mealplan.json')
  const settings = Array.isArray(planFile.settings) ? (planFile.settings as SettingRecord[]) : []
  const householdSetting = settings.find((setting) => setting.key === 'householdSize')
  const householdSize =
    typeof householdSetting?.value === 'number' && householdSetting.value >= 1
      ? Math.round(householdSetting.value)
      : DEFAULT_HOUSEHOLD_SIZE

  const warnings: string[] = []
  const freeDishes: FreeDish[] = []
  const seenFreeDishIds = new Set<string>()
  if (Array.isArray(planFile.freeDishes)) {
    planFile.freeDishes.forEach((value, index) => {
      const freeDish = normalizeFreeDish(value, index)
      if (!freeDish) {
        warnings.push(`Freies Gericht ${index + 1} war unvollständig und wurde ignoriert.`)
        return
      }
      if (seenFreeDishIds.has(freeDish.id)) {
        warnings.push(`Doppeltes freies Gericht ${freeDish.id} wurde nur einmal übernommen.`)
        return
      }
      seenFreeDishIds.add(freeDish.id)
      freeDishes.push(freeDish)
    })
  }
  const freeDishById = new Map(freeDishes.map((freeDish) => [freeDish.id, freeDish]))

  const cookSessions: CookSession[] = []
  const seenSessionIds = new Set<string>()
  if (Array.isArray(planFile.cookSessions)) {
    planFile.cookSessions.forEach((value, index) => {
      const session = normalizeCookSession(value, index)
      if (!session) {
        warnings.push(`Kochvorgang ${index + 1} war unvollständig und wurde ignoriert.`)
        return
      }
      if (seenSessionIds.has(session.id)) {
        warnings.push(`Doppelter Kochvorgang ${session.id} wurde nur einmal übernommen.`)
        return
      }
      if (session.freeDishId && !freeDishById.has(session.freeDishId)) {
        warnings.push(
          `Kochvorgang ${session.id} verweist auf ein fehlendes freies Gericht und wurde ignoriert.`,
        )
        return
      }
      seenSessionIds.add(session.id)
      cookSessions.push(session)
    })
  }
  const sessionById = new Map(cookSessions.map((session) => [session.id, session]))

  const mealPlans: MealPlanEntry[] = []
  if (Array.isArray(planFile.mealPlans)) {
    planFile.mealPlans.forEach((value, index) => {
      const plan = normalizeMealPlan(value, index, householdSize)
      if (!plan) {
        warnings.push(`Essenstermin ${index + 1} war unvollständig und wurde ignoriert.`)
        return
      }
      if (plan.cookSessionId) {
        const session = sessionById.get(plan.cookSessionId)
        if (!session || !sessionMatchesEntry(session, plan)) {
          // Never keep a link that would silently consume portions of the wrong
          // cooking event. The meal itself is preserved without the link.
          plan.cookSessionId = null
          plan.leftover = false
          warnings.push(
            `Verknüpfung des Essenstermins ${plan.id} wurde gelöst, weil der passende Kochvorgang im Backup fehlt.`,
          )
        }
      }
      mealPlans.push(plan)
    })
  }
  const mealDays = Array.isArray(planFile.mealDays) ? (planFile.mealDays as MealDay[]) : []

  const dayNotes: DayNote[] = []
  const seenNoteDates = new Set<string>()
  if (Array.isArray(planFile.dayNotes)) {
    planFile.dayNotes.forEach((value, index) => {
      const note = normalizeDayNote(value, index)
      if (!note) {
        warnings.push(`Tagesnotiz ${index + 1} war unvollständig und wurde ignoriert.`)
        return
      }
      if (seenNoteDates.has(note.date)) {
        warnings.push(`Doppelte Tagesnotiz für ${note.date} wurde nur einmal übernommen.`)
        return
      }
      seenNoteDates.add(note.date)
      dayNotes.push(note)
    })
  }

  // Shopping data was introduced with backup v5. v1–v4 simply have no file;
  // every section is optional and normalised conservatively.
  const shoppingFile = entries['shopping.json']
    ? readJson<{
        shoppingManualItems?: unknown
        shoppingChecks?: unknown
        shoppingPurchases?: unknown
        shoppingItemRules?: unknown
        shoppingQuantityCorrections?: unknown
        shoppingLists?: unknown
        shoppingDemandAllocations?: unknown
      }>('shopping.json')
    : {}

  // Shopping lists were added in backup v10. Older backups have no list
  // section; their dated rows are attached to the deterministic Thursday list
  // below without changing any date.
  const importNow = Date.now()
  const shoppingLists: ShoppingList[] = []
  const seenListIds = new Set<string>()
  const listIdRemap = new Map<string, string>()
  if (Array.isArray(shoppingFile.shoppingLists)) {
    shoppingFile.shoppingLists.forEach((value, index) => {
      const list = normalizeShoppingList(value, index)
      if (!list) {
        warnings.push(`Einkaufsliste ${index + 1} war unvollständig und wurde ignoriert.`)
        return
      }
      if (seenListIds.has(list.id)) {
        warnings.push(`Doppelte Einkaufsliste ${list.id} wurde nur einmal übernommen.`)
        return
      }
      const rawId = isRecord(value) ? asString(value.id) : ''
      if (rawId && rawId !== list.id) listIdRemap.set(rawId, list.id)
      seenListIds.add(list.id)
      shoppingLists.push(list)
    })
  }

  const shoppingManualItems: ShoppingManualItem[] = []
  const seenManualIds = new Set<string>()
  if (Array.isArray(shoppingFile.shoppingManualItems)) {
    shoppingFile.shoppingManualItems.forEach((value, index) => {
      const item = normalizeShoppingManualItem(value, index)
      if (!item) {
        warnings.push(`Manueller Einkaufsartikel ${index + 1} war unvollständig und wurde ignoriert.`)
        return
      }
      if (seenManualIds.has(item.id)) {
        warnings.push(`Doppelter manueller Einkaufsartikel ${item.id} wurde nur einmal übernommen.`)
        return
      }
      seenManualIds.add(item.id)
      shoppingManualItems.push(item)
    })
  }
  const shoppingChecks: ShoppingCheck[] = []
  const seenCheckIds = new Set<string>()
  if (Array.isArray(shoppingFile.shoppingChecks)) {
    shoppingFile.shoppingChecks.forEach((value, index) => {
      const check = normalizeShoppingCheck(value, index)
      if (!check) {
        warnings.push(`Einkaufsstatus ${index + 1} war unvollständig und wurde ignoriert.`)
        return
      }
      if (seenCheckIds.has(check.id)) {
        warnings.push(`Doppelter Einkaufsstatus ${check.id} wurde nur einmal übernommen.`)
        return
      }
      seenCheckIds.add(check.id)
      shoppingChecks.push(check)
    })
  }
  const shoppingPurchases: ShoppingPurchase[] = []
  const seenPurchaseIds = new Set<string>()
  if (Array.isArray(shoppingFile.shoppingPurchases)) {
    shoppingFile.shoppingPurchases.forEach((value, index) => {
      const purchase = normalizeShoppingPurchase(value, index)
      if (!purchase) {
        warnings.push(`Einkauf ${index + 1} war unvollständig und wurde ignoriert.`)
        return
      }
      if (seenPurchaseIds.has(purchase.id)) {
        warnings.push(`Doppelter Einkauf ${purchase.id} wurde nur einmal übernommen.`)
        return
      }
      seenPurchaseIds.add(purchase.id)
      shoppingPurchases.push(purchase)
    })
  } else {
    // v5 and older stored only aggregate checks. Convert each checked row into
    // exactly one historical purchase with the stored amount, never invented
    // individual events.
    for (const check of shoppingChecks) {
      if (!check.checked || seenPurchaseIds.has(`legacy-${check.id}`)) continue
      seenPurchaseIds.add(`legacy-${check.id}`)
      shoppingPurchases.push({
        id: `legacy-${check.id}`,
        shoppingDate: check.shoppingDate || check.weekStart,
        itemKey: check.itemKey,
        amounts: check.purchased,
        confirmedTotal: check.purchased,
        snapshot: [],
        qualitative: check.purchased.length === 0,
        createdAt: check.updatedAt,
        updatedAt: check.updatedAt,
      })
    }
  }
  const listById = new Map(shoppingLists.map((list) => [list.id, list]))
  const ensureStandardList = (periodStart: string): ShoppingList => {
    const period = shoppingPeriod(periodStart)
    const id = standardShoppingListId(period.start)
    const existing = listById.get(id)
    if (existing) return existing
    const record = standardShoppingListRecord(period.start, importNow)
    shoppingLists.push(record)
    listById.set(id, record)
    return record
  }
  const repairListId = (
    rawListId: string | undefined,
    date: string,
    label: string,
  ): string => {
    let period: ReturnType<typeof shoppingPeriod>
    try {
      period = shoppingPeriod(date)
    } catch {
      return rawListId ?? ''
    }
    const mapped = rawListId ? (listIdRemap.get(rawListId) ?? rawListId) : ''
    if (!mapped) return ensureStandardList(period.start).id
    const list = listById.get(mapped)
    if (!list) {
      warnings.push(
        `${label} verweist auf eine fehlende Einkaufsliste und wurde dem Donnerstags-Einkauf zugeordnet.`,
      )
      return ensureStandardList(period.start).id
    }
    if (list.kind === 'standard' && list.periodStart !== period.start) {
      warnings.push(
        `${label} verweist auf einen Standardzettel eines anderen Zeitraums und wurde dem passenden Donnerstags-Einkauf zugeordnet.`,
      )
      return ensureStandardList(period.start).id
    }
    return list.id
  }

  for (const item of shoppingManualItems) {
    const date = item.shoppingDate || item.weekStart || ''
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue
    const repaired = repairListId(item.listId, date, `Manueller Einkaufsartikel ${item.id}`)
    if (repaired) item.listId = repaired
  }
  for (const purchase of shoppingPurchases) {
    const repaired = repairListId(
      purchase.listId,
      purchase.shoppingDate,
      `Einkauf ${purchase.id}`,
    )
    if (repaired) purchase.listId = repaired
  }

  const shoppingDemandAllocations: ShoppingDemandAllocation[] = []
  const seenAllocationIds = new Set<string>()
  if (Array.isArray(shoppingFile.shoppingDemandAllocations)) {
    shoppingFile.shoppingDemandAllocations.forEach((value, index) => {
      const allocation = normalizeShoppingDemandAllocation(value, index)
      if (!allocation) {
        warnings.push(`Einkaufszuweisung ${index + 1} war unvollständig und wurde ignoriert.`)
        return
      }
      const period = shoppingPeriod(allocation.periodStart)
      let listId: string
      if (allocation.listId.startsWith('standard:')) {
        listId = ensureStandardList(period.start).id
      } else {
        listId = listIdRemap.get(allocation.listId) ?? allocation.listId
        if (!listById.has(listId)) {
          warnings.push(
            `Einkaufszuweisung ${allocation.id} verweist auf eine fehlende Einkaufsliste und wurde ignoriert.`,
          )
          return
        }
      }
      const id = shoppingAllocationId(
        period.start,
        allocation.itemKey,
        allocation.dimension,
        listId,
      )
      if (seenAllocationIds.has(id)) {
        warnings.push(`Doppelte Einkaufszuweisung ${id} wurde nur einmal übernommen.`)
        return
      }
      seenAllocationIds.add(id)
      shoppingDemandAllocations.push({
        ...allocation,
        id,
        periodStart: period.start,
        listId,
      })
    })
  }

  const shoppingItemRules: ShoppingItemRule[] = []
  const seenRuleKeys = new Set<string>()
  if (Array.isArray(shoppingFile.shoppingItemRules)) {
    shoppingFile.shoppingItemRules.forEach((value, index) => {
      const rule = normalizeShoppingItemRule(value, index)
      if (!rule) {
        warnings.push(`Artikelkorrektur ${index + 1} war unvollständig und wurde ignoriert.`)
        return
      }
      if (seenRuleKeys.has(rule.key)) {
        warnings.push(`Doppelte Artikelkorrektur ${rule.key} wurde nur einmal übernommen.`)
        return
      }
      seenRuleKeys.add(rule.key)
      shoppingItemRules.push(rule)
    })
  }
  // Apply the same conservative identity mapping as the Dexie migration when
  // an older backup is imported into a current database.
  const identityNames: string[] = []
  for (const recipeRow of recipes) {
    for (const ingredient of recipeRow.ingredients ?? []) {
      if (ingredient.name?.trim()) identityNames.push(ingredient.name)
    }
  }
  for (const freeDish of freeDishes) {
    for (const ingredient of freeDish.ingredients ?? []) {
      if (ingredient.name?.trim()) identityNames.push(ingredient.name)
    }
  }
  for (const manual of shoppingManualItems) {
    if (manual.name.trim()) identityNames.push(manual.name)
  }
  const identityMigration = shoppingIdentityMappings(identityNames)
  if (identityMigration.unique.size > 0 || identityMigration.ambiguous.size > 0) {
    for (let index = 0; index < shoppingItemRules.length; index += 1) {
      const rule = shoppingItemRules[index]
      if (!rule) continue
      if (identityMigration.ambiguous.has(rule.key)) {
        shoppingItemRules[index] = { ...rule, legacyAmbiguous: true }
      } else if (
        identityMigration.unique.has(rule.key) &&
        (!rule.canonicalKey || rule.canonicalKey === rule.key)
      ) {
        shoppingItemRules[index] = {
          ...rule,
          canonicalKey: identityMigration.unique.get(rule.key),
          legacyAmbiguous: false,
        }
      }
    }
    const knownRuleKeys = new Set(shoppingItemRules.map((rule) => rule.key))
    for (const purchase of shoppingPurchases) {
      const target = identityMigration.unique.get(purchase.itemKey)
      if (!target || knownRuleKeys.has(purchase.itemKey)) continue
      knownRuleKeys.add(purchase.itemKey)
      shoppingItemRules.push({
        key: purchase.itemKey,
        canonicalKey: target,
        displayName: '',
        categoryId: null,
        purchaseNote: '',
        updatedAt: purchase.updatedAt,
      })
    }
  }

  const shoppingQuantityCorrections: ShoppingQuantityCorrection[] = []
  const seenCorrectionIds = new Set<string>()
  if (Array.isArray(shoppingFile.shoppingQuantityCorrections)) {
    shoppingFile.shoppingQuantityCorrections.forEach((value, index) => {
      const correction = normalizeQuantityCorrection(value, index)
      if (!correction) {
        warnings.push(`Mengenkorrektur ${index + 1} war unvollständig und wurde ignoriert.`)
        return
      }
      if (seenCorrectionIds.has(correction.id)) {
        warnings.push(`Doppelte Mengenkorrektur ${correction.id} wurde nur einmal übernommen.`)
        return
      }
      seenCorrectionIds.add(correction.id)
      shoppingQuantityCorrections.push(correction)
    })
  }

  const [
    existingRecipes,
    existingPlans,
    existingDays,
    existingSessions,
    existingNotes,
    existingFreeDishes,
    existingManualItems,
    existingChecks,
    existingPurchases,
    existingRules,
    existingCorrections,
    existingLists,
    existingAllocations,
  ] = await Promise.all([
    db.recipes.toArray(),
    db.mealPlans.toArray(),
    db.mealDays.toArray(),
    db.cookSessions.toArray(),
    db.dayNotes.toArray(),
    db.freeDishes.toArray(),
    db.shoppingManualItems.toArray(),
    db.shoppingChecks.toArray(),
    db.shoppingPurchases.toArray(),
    db.shoppingItemRules.toArray(),
    db.shoppingQuantityCorrections.toArray(),
    db.shoppingLists.toArray(),
    db.shoppingDemandAllocations.toArray(),
  ])
  const existingIds = new Set(existingRecipes.map((recipe) => recipe.id))
  const existingImportIds = new Set(existingRecipes.map((recipe) => recipe.importId))
  const existingPlanIds = new Set(existingPlans.map((plan) => plan.id))
  const existingDayDates = new Set(existingDays.map((day) => day.date))
  const existingSettings = new Set((await db.settings.toArray()).map((setting) => setting.key))
  const existingSessionIds = new Set(existingSessions.map((session) => session.id))
  const existingNoteDates = new Set(existingNotes.map((note) => note.date))
  const existingFreeDishIds = new Set(existingFreeDishes.map((freeDish) => freeDish.id))
  const existingManualIds = new Set(existingManualItems.map((item) => item.id))
  const existingCheckIds = new Set(existingChecks.map((check) => check.id))
  const existingPurchaseIds = new Set(existingPurchases.map((purchase) => purchase.id))
  const existingRuleKeys = new Set(existingRules.map((rule) => rule.key))
  const existingCorrectionIds = new Set(existingCorrections.map((entry) => entry.id))
  const existingListIds = new Set(existingLists.map((entry) => entry.id))
  const existingAllocationIds = new Set(existingAllocations.map((entry) => entry.id))

  const conflicts: BackupConflicts = {
    recipes: recipes.filter(
      (recipe) => existingIds.has(recipe.id) || existingImportIds.has(recipe.importId),
    ).length,
    mealPlans: mealPlans.filter((plan) => existingPlanIds.has(plan.id)).length,
    mealDays: mealDays.filter((day) => existingDayDates.has(day.date)).length,
    settings: settings.filter((setting) => existingSettings.has(setting.key)).length,
    cookSessions: cookSessions.filter((session) => existingSessionIds.has(session.id)).length,
    dayNotes: dayNotes.filter((note) => existingNoteDates.has(note.date)).length,
    freeDishes: freeDishes.filter((freeDish) => existingFreeDishIds.has(freeDish.id)).length,
    shoppingManualItems: shoppingManualItems.filter((item) => existingManualIds.has(item.id)).length,
    shoppingChecks: shoppingChecks.filter((check) => existingCheckIds.has(check.id)).length,
    shoppingPurchases: shoppingPurchases.filter((purchase) => existingPurchaseIds.has(purchase.id))
      .length,
    shoppingItemRules: shoppingItemRules.filter((rule) => existingRuleKeys.has(rule.key)).length,
    shoppingQuantityCorrections: shoppingQuantityCorrections.filter((entry) =>
      existingCorrectionIds.has(entry.id),
    ).length,
    shoppingLists: shoppingLists.filter((entry) => existingListIds.has(entry.id)).length,
    shoppingDemandAllocations: shoppingDemandAllocations.filter((entry) =>
      existingAllocationIds.has(entry.id),
    ).length,
  }

  return {
    manifest,
    recipes,
    images,
    mealPlans,
    mealDays,
    settings,
    cookSessions,
    dayNotes,
    freeDishes,
    shoppingManualItems,
    shoppingChecks,
    shoppingPurchases,
    shoppingItemRules,
    shoppingQuantityCorrections,
    shoppingLists,
    shoppingDemandAllocations,
    warnings,
    conflicts,
  }
}

function normalizeFreeDish(value: unknown, index: number): FreeDish | null {
  if (!isRecord(value)) return null
  const id = asString(value.id)
  const name = asString(value.name).replace(/\s+/g, ' ').trim()
  const referenceServings = Number(value.referenceServings)
  if (!id || !name || !Number.isFinite(referenceServings) || referenceServings <= 0) {
    return null
  }
  return {
    id,
    name,
    referenceServings: Math.round(referenceServings * 10) / 10,
    ingredients: Array.isArray(value.ingredients)
      ? value.ingredients.map((ingredient, ingredientIndex) =>
          normalizeIngredient(ingredient, ingredientIndex),
        )
      : [],
    createdAt: typeof value.createdAt === 'number' ? value.createdAt : index,
    updatedAt: typeof value.updatedAt === 'number' ? value.updatedAt : index,
  }
}

function normalizeCookSession(value: unknown, index: number): CookSession | null {
  if (!isRecord(value)) return null
  const id = asString(value.id)
  const recipeId = asString(value.recipeId) || null
  const freeDishId = asString(value.freeDishId) || null
  const date = asString(value.date)
  if (!id || (!recipeId && !freeDishId) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null
  const servings = Number(value.servings)
  if (!Number.isFinite(servings) || servings <= 0) return null
  const shared = {
    id,
    date,
    servings: Math.round(servings * 10) / 10,
    status: value.status === 'cooked' ? ('cooked' as const) : ('planned' as const),
    auto: value.auto === true,
    createdAt: typeof value.createdAt === 'number' ? value.createdAt : index,
    updatedAt: typeof value.updatedAt === 'number' ? value.updatedAt : index,
  }
  return freeDishId
    ? { ...shared, recipeId: null, freeDishId }
    : { ...shared, recipeId: recipeId! }
}

function normalizeMealPlan(
  value: unknown,
  index: number,
  householdSize: number,
): MealPlanEntry | null {
  if (!isRecord(value)) return null
  const id = asString(value.id)
  const date = asString(value.date)
  const slot = asString(value.slot)
  const recipeId = asString(value.recipeId) || null
  const freeDishId = asString(value.freeDishId) || null
  if (
    !id ||
    (!recipeId && !freeDishId) ||
    !slot ||
    !/^\d{4}-\d{2}-\d{2}$/.test(date)
  ) {
    return null
  }
  const servingsValue = Number(value.servings)
  const servings =
    Number.isFinite(servingsValue) && servingsValue > 0 ? servingsValue : householdSize
  const positionValue = Number(value.position)
  const status: MealPlanEntry['status'] =
    value.status === 'eaten' || value.cooked === true ? 'eaten' : 'planned'
  const shared = {
    id,
    date,
    slot,
    servings,
    position: Number.isFinite(positionValue) && positionValue >= 0 ? positionValue : index,
    cookSessionId: asString(value.cookSessionId) || null,
    status,
    auto: value.auto === true,
    pinned: value.pinned === true,
    leftover: value.leftover === true,
    cooked: value.cooked === true || status === 'eaten',
    reasons: Array.isArray(value.reasons) ? (value.reasons as MealPlanEntry['reasons']) : [],
    createdAt: typeof value.createdAt === 'number' ? value.createdAt : index,
    updatedAt: typeof value.updatedAt === 'number' ? value.updatedAt : index,
  }
  return freeDishId
    ? { ...shared, recipeId: null, freeDishId }
    : { ...shared, recipeId: recipeId! }
}

function normalizeDayNote(value: unknown, index: number): DayNote | null {
  if (!isRecord(value)) return null
  const date = asString(value.date)
  const text = asString(value.text).replace(/\r\n?/g, '\n').trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !text) return null
  return {
    date,
    text,
    createdAt: typeof value.createdAt === 'number' ? value.createdAt : index,
    updatedAt: typeof value.updatedAt === 'number' ? value.updatedAt : index,
  }
}

function normalizeRecipe(value: unknown, index: number): Recipe {
  if (!isRecord(value)) throw new BackupError(`Rezept ${index + 1} ist kein Objekt.`)
  const id = asString(value.id)
  const title = asString(value.title)
  if (!id || !title) {
    throw new BackupError(`Rezept ${index + 1} hat keine ID oder keinen Titel.`)
  }
  return {
    id,
    importId: asString(value.importId) || `backup-${id}`,
    importSource:
      value.importSource === 'manual'
        ? 'manual'
        : value.importSource === 'url'
          ? 'url'
          : 'mela',
    title,
    description: asString(value.description),
    ingredientGroups: Array.isArray(value.ingredientGroups)
      ? (value.ingredientGroups as Recipe['ingredientGroups'])
      : [],
    ingredients: Array.isArray(value.ingredients)
      ? value.ingredients.map((ingredient, ingredientIndex) =>
          normalizeIngredient(ingredient, ingredientIndex),
        )
      : [],
    instructions: normalizeInstructionList(value.instructions),
    servingsText: asString(value.servingsText),
    servingsNumber: typeof value.servingsNumber === 'number' ? value.servingsNumber : null,
    prepTime: asString(value.prepTime),
    cookTime: asString(value.cookTime),
    totalTime: asString(value.totalTime),
    categories: Array.isArray(value.categories) ? (value.categories as string[]) : [],
    cuisine: Array.isArray(value.cuisine) ? (value.cuisine as string[]) : [],
    dishType: Array.isArray(value.dishType) ? (value.dishType as string[]) : [],
    effort: asString(value.effort),
    tags: Array.isArray(value.tags) ? (value.tags as string[]) : [],
    notes: asString(value.notes),
    nutrition: asString(value.nutrition),
    sourceUrl: asString(value.sourceUrl),
    importUrl: asString(value.importUrl),
    importMeta: normalizeImportMeta(value.importMeta),
    favorite: value.favorite === true,
    wantToCook: value.wantToCook === true,
    melaDate: typeof value.melaDate === 'number' ? value.melaDate : null,
    raw: isRecord(value.raw) ? value.raw : {},
    createdAt: typeof value.createdAt === 'number' ? value.createdAt : 0,
    updatedAt: typeof value.updatedAt === 'number' ? value.updatedAt : 0,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Keep URL import metadata through backup/restore, including image warnings. */
function normalizeImportMeta(value: unknown): RecipeImportMeta | undefined {
  if (!isRecord(value)) return undefined
  return {
    source: 'url',
    originalUrl: asString(value.originalUrl),
    finalUrl: asString(value.finalUrl),
    candidateKey: asString(value.candidateKey),
    fetchedAt: typeof value.fetchedAt === 'number' ? value.fetchedAt : 0,
    imageSourceUrls: Array.isArray(value.imageSourceUrls)
      ? value.imageSourceUrls.filter((entry): entry is string => typeof entry === 'string')
      : [],
    imageWarnings: Array.isArray(value.imageWarnings)
      ? value.imageWarnings.filter((entry): entry is string => typeof entry === 'string')
      : [],
  }
}

/**
 * Keep old backups importable: ingredients from before the note fields simply
 * get empty strings. Unknown extra fields are preserved via the spread.
 */
function normalizeIngredient(value: unknown, index: number): Ingredient {
  const data = isRecord(value) ? value : {}
  return {
    ...(data as Partial<Ingredient>),
    id: asString(data.id) || `ing-${index + 1}`,
    groupId: typeof data.groupId === 'string' ? data.groupId : null,
    position: typeof data.position === 'number' && Number.isFinite(data.position) ? data.position : index,
    raw: asString(data.raw),
    name: asString(data.name),
    quantity: typeof data.quantity === 'number' && Number.isFinite(data.quantity) ? data.quantity : null,
    quantityText: typeof data.quantityText === 'string' ? data.quantityText : null,
    unit: typeof data.unit === 'string' ? data.unit : null,
    purchaseNote: asString(data.purchaseNote),
    preparationNote: asString(data.preparationNote),
    parseStatus: data.parseStatus === 'plain' ? 'plain' : 'parsed',
    links: Array.isArray(data.links) ? (data.links as Ingredient['links']) : [],
  }
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function normalizeShoppingCategory(value: unknown): ShoppingManualItem['categoryId'] {
  const id = asString(value)
  const known = SHOPPING_CATEGORIES.some((category) => category.id === id)
  return known ? (id as NonNullable<ShoppingManualItem['categoryId']>) : null
}

function normalizeShoppingManualItem(value: unknown, index: number): ShoppingManualItem | null {
  if (!isRecord(value)) return null
  const id = asString(value.id)
  const weekStart = asString(value.weekStart)
  const shoppingDate = asString(value.shoppingDate) || weekStart
  const name = asString(value.name).replace(/\s+/g, ' ').trim()
  if (!id || !name || !/^\d{4}-\d{2}-\d{2}$/.test(shoppingDate)) return null
  return {
    id,
    shoppingDate,
    weekStart: weekStart || shoppingDate,
    listId: asString(value.listId).trim() || undefined,
    legacyWeekAmbiguous: value.legacyWeekAmbiguous === true ? true : undefined,
    name,
    quantityText: typeof value.quantityText === 'string' ? value.quantityText : null,
    unit: typeof value.unit === 'string' ? value.unit : null,
    purchaseNote: asString(value.purchaseNote),
    categoryId: normalizeShoppingCategory(value.categoryId),
    createdAt: typeof value.createdAt === 'number' ? value.createdAt : index,
    updatedAt: typeof value.updatedAt === 'number' ? value.updatedAt : index,
  }
}

function normalizeShoppingCheck(value: unknown, index: number): ShoppingCheck | null {
  if (!isRecord(value)) return null
  const weekStart = asString(value.weekStart)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) return null
  const rawId = asString(value.id)
  const fromId = rawId.includes('|') ? rawId.slice(rawId.indexOf('|') + 1) : ''
  const itemKey = asString(value.itemKey).trim() || fromId
  if (!itemKey) return null
  const purchased: ShoppingCheck['purchased'] = []
  if (Array.isArray(value.purchased)) {
    for (const entry of value.purchased) {
      if (!isRecord(entry)) continue
      const dimension = asString(entry.dimension)
      const lower = Number(entry.lower)
      const upper = Number(entry.upper)
      if (!dimension || !Number.isFinite(lower) || !Number.isFinite(upper)) continue
      if (lower < 0 || upper < 0) continue
      purchased.push({
        dimension,
        lower: Math.round(lower * 1000) / 1000,
        upper: Math.round(upper * 1000) / 1000,
      })
    }
  }
  return {
    id: `${weekStart}|${itemKey}`,
    weekStart,
    itemKey,
    checked: value.checked === true,
    purchased,
    shoppingDate: asString(value.shoppingDate) || weekStart,
    updatedAt: typeof value.updatedAt === 'number' ? value.updatedAt : index,
  }
}

function normalizePurchasedAmounts(value: unknown): ShoppingPurchase['amounts'] {
  if (!Array.isArray(value)) return []
  const result: ShoppingPurchase['amounts'] = []
  for (const entry of value) {
    if (!isRecord(entry)) continue
    const dimension = asString(entry.dimension)
    const lower = Number(entry.lower)
    const upper = Number(entry.upper)
    if (!dimension || !Number.isFinite(lower) || !Number.isFinite(upper)) continue
    if (lower < 0 || upper < 0) continue
    result.push({
      dimension,
      lower: Math.round(lower * 1000) / 1000,
      upper: Math.round(upper * 1000) / 1000,
    })
  }
  return result
}

function normalizeShoppingPurchase(value: unknown, index: number): ShoppingPurchase | null {
  if (!isRecord(value)) return null
  const id = asString(value.id)
  const shoppingDate = asString(value.shoppingDate)
  const itemKey = asString(value.itemKey).trim()
  if (!id || !itemKey || !/^\d{4}-\d{2}-\d{2}$/.test(shoppingDate)) return null
  return {
    id,
    shoppingDate,
    itemKey,
    listId: asString(value.listId).trim() || undefined,
    manualItemId: asString(value.manualItemId).trim() || undefined,
    legacyWeekAmbiguous: value.legacyWeekAmbiguous === true ? true : undefined,
    amounts: normalizePurchasedAmounts(value.amounts),
    confirmedTotal: normalizePurchasedAmounts(value.confirmedTotal),
    snapshot: normalizePurchasedAmounts(value.snapshot),
    qualitative: value.qualitative === true,
    createdAt: typeof value.createdAt === 'number' ? value.createdAt : index,
    updatedAt: typeof value.updatedAt === 'number' ? value.updatedAt : index,
  }
}

function normalizeShoppingItemRule(value: unknown, index: number): ShoppingItemRule | null {
  if (!isRecord(value)) return null
  const key = asString(value.key).trim()
  if (!key) return null
  return {
    key,
    canonicalKey: asString(value.canonicalKey) || key,
    displayName: asString(value.displayName),
    categoryId: normalizeShoppingCategory(value.categoryId),
    purchaseNote: asString(value.purchaseNote),
    purchaseNoteOverride: value.purchaseNoteOverride === true,
    hiddenPurchaseNotes: Array.isArray(value.hiddenPurchaseNotes)
      ? value.hiddenPurchaseNotes.filter((entry): entry is string => typeof entry === 'string')
      : [],
    legacyQuantityText:
      asString(value.legacyQuantityText) || asString(value.quantityOverrideText),
    legacyUnit: asString(value.legacyUnit) || asString(value.unitOverride),
    legacyAmbiguous: value.legacyAmbiguous === true,
    updatedAt: typeof value.updatedAt === 'number' ? value.updatedAt : index,
  }
}

function normalizeQuantityCorrection(
  value: unknown,
  index: number,
): ShoppingQuantityCorrection | null {
  if (!isRecord(value)) return null
  const shoppingDate = asString(value.shoppingDate)
  const itemKey = asString(value.itemKey).trim()
  const dimension = asString(value.dimension).trim()
  const quantityText = asString(value.quantityText).trim()
  if (!itemKey || !dimension || !quantityText) return null
  if (!/^\d{4}-\d{2}-\d{2}$/.test(shoppingDate)) return null
  return {
    // Canonical id: repeated imports/merges cannot create duplicate rows for
    // the same week and dimension.
    id: `${itemKey}::${shoppingDate}::${dimension}`,
    shoppingDate,
    itemKey,
    dimension,
    quantityText,
    unit: typeof value.unit === 'string' && value.unit.trim() ? value.unit.trim() : null,
    sourceSignature: asString(value.sourceSignature),
    createdAt: typeof value.createdAt === 'number' ? value.createdAt : index,
    updatedAt: typeof value.updatedAt === 'number' ? value.updatedAt : index,
  }
}

function normalizeShoppingList(value: unknown, index: number): ShoppingList | null {
  if (!isRecord(value)) return null
  const kind = value.kind === 'free' ? 'free' : value.kind === 'standard' ? 'standard' : null
  if (!kind) return null
  const createdAt = typeof value.createdAt === 'number' ? value.createdAt : index
  const updatedAt = typeof value.updatedAt === 'number' ? value.updatedAt : createdAt
  if (kind === 'free') {
    const id = asString(value.id).trim()
    const name = asString(value.name).replace(/\s+/g, ' ').trim() || 'Einkauf'
    if (!id) return null
    return {
      id,
      kind,
      name,
      periodStart: null,
      periodEnd: null,
      createdAt,
      updatedAt,
    }
  }
  const periodStart = asString(value.periodStart)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(periodStart)) return null
  let period: ReturnType<typeof shoppingPeriod>
  try {
    period = shoppingPeriod(periodStart)
  } catch {
    return null
  }
  return {
    ...standardShoppingListRecord(period.start, createdAt),
    updatedAt,
  }
}

function normalizeShoppingDemandAllocation(
  value: unknown,
  index: number,
): ShoppingDemandAllocation | null {
  if (!isRecord(value)) return null
  const periodStart = asString(value.periodStart)
  const itemKey = asString(value.itemKey).trim()
  const dimension = asString(value.dimension).trim()
  const listId = asString(value.listId).trim()
  const mode = value.mode === 'full' ? 'full' : value.mode === 'partial' ? 'partial' : null
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(periodStart) ||
    !itemKey ||
    !dimension ||
    !listId ||
    !mode
  ) {
    return null
  }
  let period: ReturnType<typeof shoppingPeriod>
  try {
    period = shoppingPeriod(periodStart)
  } catch {
    return null
  }
  let quantityMilli: number | undefined
  if (mode === 'partial') {
    const rawMilli = Number(value.quantityMilli)
    if (Number.isFinite(rawMilli) && rawMilli > 0) {
      quantityMilli = Math.round(rawMilli)
    } else {
      const legacyLower = Number(value.lower)
      if (!Number.isFinite(legacyLower) || legacyLower <= 0) return null
      quantityMilli = Math.round(legacyLower * 1000)
    }
  }
  return {
    id: shoppingAllocationId(period.start, itemKey, dimension, listId),
    periodStart: period.start,
    itemKey,
    dimension,
    listId,
    mode,
    ...(quantityMilli !== undefined ? { quantityMilli } : {}),
    createdAt: typeof value.createdAt === 'number' ? value.createdAt : index,
    updatedAt: typeof value.updatedAt === 'number' ? value.updatedAt : index,
  }
}

export async function restoreBackup(
  inspection: BackupInspection,
  mode: RestoreMode,
): Promise<RestoreResult> {
  const result: RestoreResult = {
    mode,
    addedRecipes: 0,
    skippedRecipes: 0,
    addedImages: 0,
    addedMealPlans: 0,
    skippedMealPlans: 0,
    addedMealDays: 0,
    addedSettings: 0,
    addedCookSessions: 0,
    skippedCookSessions: 0,
    addedDayNotes: 0,
    skippedDayNotes: 0,
    addedFreeDishes: 0,
    skippedFreeDishes: 0,
    addedShoppingManualItems: 0,
    skippedShoppingManualItems: 0,
    addedShoppingChecks: 0,
    skippedShoppingChecks: 0,
    addedShoppingPurchases: 0,
    skippedShoppingPurchases: 0,
    addedShoppingItemRules: 0,
    skippedShoppingItemRules: 0,
    addedShoppingQuantityCorrections: 0,
    skippedShoppingQuantityCorrections: 0,
    addedShoppingLists: 0,
    skippedShoppingLists: 0,
    addedShoppingDemandAllocations: 0,
    skippedShoppingDemandAllocations: 0,
    detachedMealLinks: 0,
  }

  await db.transaction(
    'rw',
    [
      db.recipes,
      db.images,
      db.mealPlans,
      db.mealDays,
      db.settings,
      db.cookSessions,
      db.cookProgress,
      db.dayNotes,
      db.freeDishes,
      db.shoppingManualItems,
      db.shoppingChecks,
      db.shoppingPurchases,
      db.shoppingItemRules,
      db.shoppingQuantityCorrections,
      db.shoppingLists,
      db.shoppingDemandAllocations,
    ],
    async () => {
      if (mode === 'replace') {
        await Promise.all([
          db.recipes.clear(),
          db.images.clear(),
          db.cookSessions.clear(),
          db.cookProgress.clear(),
          db.mealPlans.clear(),
          db.mealDays.clear(),
          db.settings.clear(),
          db.dayNotes.clear(),
          db.freeDishes.clear(),
          db.shoppingManualItems.clear(),
          db.shoppingChecks.clear(),
          db.shoppingPurchases.clear(),
          db.shoppingItemRules.clear(),
          db.shoppingQuantityCorrections.clear(),
          db.shoppingLists.clear(),
          db.shoppingDemandAllocations.clear(),
        ])
        if (inspection.recipes.length > 0) await db.recipes.bulkPut(inspection.recipes)
        if (inspection.images.length > 0) {
          await db.images.bulkPut(
            inspection.images.map(({ meta, bytes }) => ({
              ...meta,
              bytes,
            })),
          )
        }
        if (inspection.freeDishes.length > 0) {
          await db.freeDishes.bulkPut(inspection.freeDishes)
        }
        if (inspection.cookSessions.length > 0) {
          await db.cookSessions.bulkPut(inspection.cookSessions)
        }
        if (inspection.mealPlans.length > 0) await db.mealPlans.bulkPut(inspection.mealPlans)
        if (inspection.mealDays.length > 0) await db.mealDays.bulkPut(inspection.mealDays)
        if (inspection.settings.length > 0) await db.settings.bulkPut(inspection.settings)
        if (inspection.dayNotes.length > 0) await db.dayNotes.bulkPut(inspection.dayNotes)
        if (inspection.shoppingLists.length > 0) {
          await db.shoppingLists.bulkPut(inspection.shoppingLists)
        }
        if (inspection.shoppingManualItems.length > 0) {
          await db.shoppingManualItems.bulkPut(inspection.shoppingManualItems)
        }
        if (inspection.shoppingPurchases.length > 0) {
          await db.shoppingPurchases.bulkPut(inspection.shoppingPurchases)
        }
        if (inspection.shoppingItemRules.length > 0) {
          await db.shoppingItemRules.bulkPut(inspection.shoppingItemRules)
        }
        if (inspection.shoppingQuantityCorrections.length > 0) {
          await db.shoppingQuantityCorrections.bulkPut(
            inspection.shoppingQuantityCorrections,
          )
        }
        if (inspection.shoppingDemandAllocations.length > 0) {
          await db.shoppingDemandAllocations.bulkPut(
            inspection.shoppingDemandAllocations,
          )
        }
        result.addedRecipes = inspection.recipes.length
        result.addedImages = inspection.images.length
        result.addedMealPlans = inspection.mealPlans.length
        result.addedMealDays = inspection.mealDays.length
        result.addedSettings = inspection.settings.length
        result.addedCookSessions = inspection.cookSessions.length
        result.addedDayNotes = inspection.dayNotes.length
        result.addedFreeDishes = inspection.freeDishes.length
        result.addedShoppingManualItems = inspection.shoppingManualItems.length
        result.addedShoppingChecks = 0
        result.addedShoppingPurchases = inspection.shoppingPurchases.length
        result.addedShoppingItemRules = inspection.shoppingItemRules.length
        result.addedShoppingQuantityCorrections =
          inspection.shoppingQuantityCorrections.length
        result.addedShoppingLists = inspection.shoppingLists.length
        result.addedShoppingDemandAllocations =
          inspection.shoppingDemandAllocations.length
        return
      }

    const existingRecipes = await db.recipes.toArray()
    const existingIds = new Set(existingRecipes.map((recipe) => recipe.id))
    const existingImportIds = new Set(existingRecipes.map((recipe) => recipe.importId))
    const addedRecipeIds = new Set<string>()

    for (const recipe of inspection.recipes) {
      if (existingIds.has(recipe.id) || existingImportIds.has(recipe.importId)) {
        result.skippedRecipes += 1
        continue
      }
      await db.recipes.put(recipe)
      existingIds.add(recipe.id)
      existingImportIds.add(recipe.importId)
      addedRecipeIds.add(recipe.id)
      result.addedRecipes += 1
    }

    const existingImageIds = new Set((await db.images.toArray()).map((image) => image.id))
    for (const image of inspection.images) {
      if (!addedRecipeIds.has(image.meta.recipeId) || existingImageIds.has(image.meta.id)) continue
      await db.images.put({ ...image.meta, bytes: image.bytes })
      existingImageIds.add(image.meta.id)
      result.addedImages += 1
    }

    // Free dishes are merged before cooking events so a restored session can
    // always resolve its snapshot. Existing local snapshots win unchanged.
    const existingFreeDishIds = new Set(
      (await db.freeDishes.toArray()).map((freeDish) => freeDish.id),
    )
    for (const freeDish of inspection.freeDishes) {
      if (existingFreeDishIds.has(freeDish.id)) {
        result.skippedFreeDishes += 1
        continue
      }
      await db.freeDishes.put(freeDish)
      existingFreeDishIds.add(freeDish.id)
      result.addedFreeDishes += 1
    }

    const localSessions = await db.cookSessions.toArray()
    const sessionById = new Map(localSessions.map((session) => [session.id, session]))
    for (const session of inspection.cookSessions) {
      if (sessionById.has(session.id)) {
        result.skippedCookSessions += 1
        continue
      }
      await db.cookSessions.put(session)
      sessionById.set(session.id, session)
      result.addedCookSessions += 1
    }

    const existingPlans = await db.mealPlans.toArray()
    const existingPlanIds = new Set(existingPlans.map((plan) => plan.id))
    const assignedBySession = new Map<string, number>()
    for (const plan of existingPlans) {
      if (!plan.cookSessionId) continue
      assignedBySession.set(
        plan.cookSessionId,
        (assignedBySession.get(plan.cookSessionId) ?? 0) + (plan.servings ?? 0),
      )
    }
    for (const original of inspection.mealPlans) {
      if (existingPlanIds.has(original.id)) {
        result.skippedMealPlans += 1
        continue
      }
      const plan = { ...original }
      if (plan.cookSessionId) {
        const session = sessionById.get(plan.cookSessionId)
        const alreadyAssigned = assignedBySession.get(plan.cookSessionId) ?? 0
        if (
          !session ||
          !sessionMatchesEntry(session, plan) ||
          alreadyAssigned + (plan.servings ?? 0) > session.servings
        ) {
          // A merge never creates a silent negative portion balance: the meal is
          // kept, but the unusable link is removed instead.
          plan.cookSessionId = null
          plan.leftover = false
          result.detachedMealLinks += 1
        } else {
          assignedBySession.set(plan.cookSessionId, alreadyAssigned + (plan.servings ?? 0))
        }
      }
      await db.mealPlans.put(plan)
      existingPlanIds.add(plan.id)
      result.addedMealPlans += 1
    }

    const existingDays = new Set((await db.mealDays.toArray()).map((day) => day.date))
    for (const day of inspection.mealDays) {
      if (existingDays.has(day.date)) continue
      await db.mealDays.put(day)
      existingDays.add(day.date)
      result.addedMealDays += 1
    }

    const existingSettings = new Set((await db.settings.toArray()).map((setting) => setting.key))
    for (const setting of inspection.settings) {
      if (existingSettings.has(setting.key)) continue
      await db.settings.put(setting)
      existingSettings.add(setting.key)
      result.addedSettings += 1
    }

    const existingNotes = new Set((await db.dayNotes.toArray()).map((note) => note.date))
    for (const note of inspection.dayNotes) {
      if (existingNotes.has(note.date)) {
        // Merge is non-destructive: the local note for that date wins.
        result.skippedDayNotes += 1
        continue
      }
      await db.dayNotes.put(note)
      existingNotes.add(note.date)
      result.addedDayNotes += 1
    }

    // Shopping data is merged only when its key does not exist locally. The
    // local row always wins, matching the non-destructive merge contract.
    const existingListIds = new Set((await db.shoppingLists.toArray()).map((list) => list.id))
    for (const list of inspection.shoppingLists) {
      if (existingListIds.has(list.id)) {
        result.skippedShoppingLists += 1
        continue
      }
      await db.shoppingLists.put(list)
      existingListIds.add(list.id)
      result.addedShoppingLists += 1
    }

    const existingManualIds = new Set(
      (await db.shoppingManualItems.toArray()).map((item) => item.id),
    )
    for (const item of inspection.shoppingManualItems) {
      if (existingManualIds.has(item.id)) {
        result.skippedShoppingManualItems += 1
        continue
      }
      await db.shoppingManualItems.put(item)
      existingManualIds.add(item.id)
      result.addedShoppingManualItems += 1
    }

    // Checks are a legacy aggregate representation. Restores always write the
    // individual purchase actions; writing both would double-count purchases.
    const existingPurchaseIds = new Set(
      (await db.shoppingPurchases.toArray()).map((purchase) => purchase.id),
    )
    for (const purchase of inspection.shoppingPurchases) {
      if (existingPurchaseIds.has(purchase.id)) {
        result.skippedShoppingPurchases += 1
        continue
      }
      await db.shoppingPurchases.put(purchase)
      existingPurchaseIds.add(purchase.id)
      result.addedShoppingPurchases += 1
    }

    const existingRuleKeys = new Set((await db.shoppingItemRules.toArray()).map((rule) => rule.key))
    for (const rule of inspection.shoppingItemRules) {
      if (existingRuleKeys.has(rule.key)) {
        result.skippedShoppingItemRules += 1
        continue
      }
      await db.shoppingItemRules.put(rule)
      existingRuleKeys.add(rule.key)
      result.addedShoppingItemRules += 1
    }

    const existingCorrectionIds = new Set(
      (await db.shoppingQuantityCorrections.toArray()).map((entry) => entry.id),
    )
    for (const correction of inspection.shoppingQuantityCorrections) {
      if (existingCorrectionIds.has(correction.id)) {
        result.skippedShoppingQuantityCorrections += 1
        continue
      }
      await db.shoppingQuantityCorrections.put(correction)
      existingCorrectionIds.add(correction.id)
      result.addedShoppingQuantityCorrections += 1
    }

    // Allocations are merged last so a target list always exists locally.
    // Unknown list references are dropped instead of orphaning a row.
    const existingAllocationIds = new Set(
      (await db.shoppingDemandAllocations.toArray()).map((entry) => entry.id),
    )
    const mergedListIds = new Set((await db.shoppingLists.toArray()).map((list) => list.id))
    for (const allocation of inspection.shoppingDemandAllocations) {
      if (existingAllocationIds.has(allocation.id)) {
        result.skippedShoppingDemandAllocations += 1
        continue
      }
      if (!mergedListIds.has(allocation.listId)) {
        result.skippedShoppingDemandAllocations += 1
        continue
      }
      await db.shoppingDemandAllocations.put(allocation)
      existingAllocationIds.add(allocation.id)
      result.addedShoppingDemandAllocations += 1
    }

  })

  return result
}
