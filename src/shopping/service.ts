/*
 * openCook Web
 * Copyright (C) 2026 openCook Web contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Persistence for the shopping list. Only genuinely persistent data lives
 * here: manual articles, purchased amounts, learned product corrections and
 * category order. Derived cook-session demand is never copied into the
 * database; the discontinued pantry feature has no persistence.
 */

import { db } from '../db'
import { addDays } from '../domain/dates'
import {
  CATEGORY_ORDER_SETTING_KEY,
  DEFAULT_CATEGORY_ORDER,
  normalizeCategoryOrder,
  parseCategoryOrderSetting,
  serializeCategoryOrder,
  parseShoppingQuantityPosition,
  resolveCanonicalKey,
  shoppingUnitDimension,
  type ShoppingAmountPosition,
  type ShoppingCategoryId,
} from '../domain/shopping'
import { manualItemKey, resolvePurchaseTargetForLegacyWrite } from './demand'
import { ShoppingListError } from './errors'
import { loadManualPurchaseContext } from './manualPurchases'
import {
  periodContainsDate,
  shoppingAllocationId,
  standardShoppingListRecord,
} from '../domain/shoppingLists'
import { resolveShoppingPeriod } from './cycle'
import { getShoppingSettings } from '../settings/shopping'
import { randomId } from '../lib/id'
import type {
  SettingRecord,
  ShoppingItemRule,
  ShoppingManualItem,
  ShoppingPurchase,
  ShoppingPurchasedAmount,
  ShoppingQuantityCorrection,
} from '../types'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const CATEGORY_SET = new Set<string>(DEFAULT_CATEGORY_ORDER)

export class ShoppingError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ShoppingError'
  }
}

function cleanText(value: string | null | undefined): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim()
}

function optionalText(value: string | null | undefined): string | null {
  const clean = cleanText(value)
  return clean ? clean : null
}

function categoryOrNull(value: string | null | undefined): ShoppingCategoryId | null {
  const clean = cleanText(value)
  return CATEGORY_SET.has(clean) ? (clean as ShoppingCategoryId) : null
}

function requireDate(value: string, label: string): string {
  if (!DATE_RE.test(value)) throw new ShoppingError(`${label} ist kein gültiges Datum.`)
  return value
}

/* ------------------------------------------------------------------ */
/* Category order (stored in the existing settings table)              */
/* ------------------------------------------------------------------ */

export function categoryOrderFromRows(rows: readonly SettingRecord[]): ShoppingCategoryId[] {
  const row = rows.find((entry) => entry.key === CATEGORY_ORDER_SETTING_KEY)
  return parseCategoryOrderSetting(row?.value)
}

export async function getCategoryOrder(): Promise<ShoppingCategoryId[]> {
  const row = await db.settings.get(CATEGORY_ORDER_SETTING_KEY)
  return parseCategoryOrderSetting(row?.value)
}

export async function saveCategoryOrder(
  order: readonly ShoppingCategoryId[],
): Promise<ShoppingCategoryId[]> {
  const normalized = normalizeCategoryOrder(order)
  await db.settings.put({
    key: CATEGORY_ORDER_SETTING_KEY,
    value: serializeCategoryOrder(normalized),
  })
  return normalized
}

/* ------------------------------------------------------------------ */
/* Manual articles                                                     */
/* ------------------------------------------------------------------ */

export interface ManualItemInput {
  /** Actual date; preferred for all new rows. */
  shoppingDate?: string
  /** Legacy alias for shoppingDate. */
  weekStart?: string
  /** Owning shopping list; omitted for legacy callers. */
  listId?: string | null
  name: string
  quantityText?: string | null
  unit?: string | null
  purchaseNote?: string | null
  categoryId?: string | null
}

function shoppingDateFor(input: ManualItemInput): string {
  const date = cleanText(input.shoppingDate || input.weekStart)
  return requireDate(date, 'Der Einkaufstag')
}

export async function addManualItem(input: ManualItemInput): Promise<ShoppingManualItem> {
  const name = cleanText(input.name)
  if (!name) throw new ShoppingError('Bitte einen Artikelnamen angeben.')
  const shoppingDate = shoppingDateFor(input)
  const now = Date.now()
  const item: ShoppingManualItem = {
    id: randomId(),
    shoppingDate,
    weekStart: shoppingDate,
    listId: optionalText(input.listId) ?? undefined,
    name,
    quantityText: optionalText(input.quantityText),
    unit: optionalText(input.unit),
    purchaseNote: cleanText(input.purchaseNote),
    categoryId: categoryOrNull(input.categoryId),
    createdAt: now,
    updatedAt: now,
  }
  await db.shoppingManualItems.put(item)
  return item
}

export async function updateManualItem(
  id: string,
  patch: Partial<Omit<ManualItemInput, 'weekStart'>>,
): Promise<ShoppingManualItem> {
  return db.transaction('rw', db.shoppingManualItems, async () => {
    const existing = await db.shoppingManualItems.get(id)
    if (!existing) throw new ShoppingError('Der manuelle Artikel wurde nicht gefunden.')
    const name = patch.name === undefined ? existing.name : cleanText(patch.name)
    if (!name) throw new ShoppingError('Bitte einen Artikelnamen angeben.')
    const shoppingDate =
      patch.shoppingDate === undefined
        ? existing.shoppingDate || existing.weekStart || ''
        : requireDate(cleanText(patch.shoppingDate), 'Der Einkaufstag')
    const next: ShoppingManualItem = {
      ...existing,
      shoppingDate,
      listId:
        patch.listId === undefined
          ? existing.listId
          : (optionalText(patch.listId) ?? undefined),
      name,
      quantityText:
        patch.quantityText === undefined
          ? existing.quantityText
          : optionalText(patch.quantityText),
      unit: patch.unit === undefined ? existing.unit : optionalText(patch.unit),
      purchaseNote:
        patch.purchaseNote === undefined ? existing.purchaseNote : cleanText(patch.purchaseNote),
      categoryId:
        patch.categoryId === undefined ? existing.categoryId : categoryOrNull(patch.categoryId),
      updatedAt: Date.now(),
    }
    await db.shoppingManualItems.put(next)
    return next
  })
}

export async function removeManualItem(id: string): Promise<void> {
  const item = await db.shoppingManualItems.get(id)
  if (!item) return
  const context = await loadManualPurchaseContext(item)
  if (context.ambiguous) {
    throw new ShoppingListError(
      'purchase-conflict',
      'Vorhandene Käufe sind nicht eindeutig diesem manuellen Artikel zuzuordnen.',
      {
        manualItemId: item.id,
        itemKey: manualItemKey(item),
        purchaseIds: context.candidatePurchases.map((purchase) => purchase.id),
      },
    )
  }
  await db.transaction('rw', [db.shoppingManualItems, db.shoppingPurchases], async () => {
    const linked = await db.shoppingPurchases.where('manualItemId').equals(id).toArray()
    for (const purchase of linked) await db.shoppingPurchases.delete(purchase.id)
    if (context.adoptablePurchase) {
      const candidate = await db.shoppingPurchases.get(context.adoptablePurchase.id)
      // Never delete a row that was linked to another article in the meantime.
      if (candidate && !candidate.manualItemId) {
        await db.shoppingPurchases.delete(candidate.id)
      }
    }
    await db.shoppingManualItems.delete(id)
  })
}

export async function restoreManualItem(item: ShoppingManualItem): Promise<void> {
  await db.shoppingManualItems.put(item)
}

/* ------------------------------------------------------------------ */
/* Learned product corrections and identities                          */
/* ------------------------------------------------------------------ */

export interface ItemRuleInput {
  displayName?: string
  categoryId?: string | null
  purchaseNote?: string
  purchaseNoteOverride?: boolean
  hiddenPurchaseNotes?: string[]
}

export async function saveItemRule(
  key: string,
  patch: ItemRuleInput,
): Promise<ShoppingItemRule | null> {
  const cleanKey = cleanText(key)
  if (!cleanKey) throw new ShoppingError('Der Artikel konnte nicht zugeordnet werden.')
  const existing = await db.shoppingItemRules.get(cleanKey)
  const displayName = cleanText(patch.displayName ?? existing?.displayName ?? '')
  const purchaseNote = cleanText(patch.purchaseNote ?? existing?.purchaseNote ?? '')
  const categoryId =
    patch.categoryId === undefined ? (existing?.categoryId ?? null) : categoryOrNull(patch.categoryId)
  const purchaseNoteOverride =
    patch.purchaseNoteOverride === undefined
      ? existing?.purchaseNoteOverride === true
      : patch.purchaseNoteOverride === true
  const hiddenPurchaseNotes = Array.from(
    new Set(
      (patch.hiddenPurchaseNotes ?? existing?.hiddenPurchaseNotes ?? [])
        .map((note) => cleanText(note))
        .filter(Boolean),
    ),
  )
  const canonicalKey = cleanText(existing?.canonicalKey ?? cleanKey) || cleanKey

  if (
    !displayName &&
    !purchaseNote &&
    !categoryId &&
    !purchaseNoteOverride &&
    hiddenPurchaseNotes.length === 0 &&
    !existing?.legacyQuantityText &&
    !existing?.legacyUnit &&
    !existing?.legacyAmbiguous &&
    canonicalKey === cleanKey
  ) {
    if (existing) await db.shoppingItemRules.delete(cleanKey)
    return null
  }
  const rule: ShoppingItemRule = {
    key: cleanKey,
    canonicalKey,
    displayName,
    categoryId,
    purchaseNote,
    purchaseNoteOverride,
    hiddenPurchaseNotes,
    legacyQuantityText: existing?.legacyQuantityText ?? '',
    legacyUnit: existing?.legacyUnit ?? '',
    legacyAmbiguous: existing?.legacyAmbiguous,
    updatedAt: Date.now(),
  }
  await db.shoppingItemRules.put(rule)
  return rule
}

async function transactionMergeRules(
  sourceKey: string,
  targetKey: string,
): Promise<string> {
  const rules = await db.shoppingItemRules.toArray()
  const finalTarget = resolveCanonicalKey(targetKey, rules)
  if (finalTarget === sourceKey) {
    throw new ShoppingError('Diese beiden Artikel können nicht so zusammengeführt werden.')
  }
  const source = rules.find((rule) => rule.key === sourceKey)
  const target = rules.find((rule) => rule.key === finalTarget)
  const now = Date.now()
  await db.shoppingItemRules.put({
    key: sourceKey,
    canonicalKey: finalTarget,
    displayName: source?.displayName ?? '',
    categoryId: source?.categoryId ?? null,
    purchaseNote: source?.purchaseNote ?? '',
    purchaseNoteOverride: source?.purchaseNoteOverride === true,
    hiddenPurchaseNotes: source?.hiddenPurchaseNotes ?? [],
    legacyQuantityText: source?.legacyQuantityText ?? '',
    legacyUnit: source?.legacyUnit ?? '',
    legacyAmbiguous: source?.legacyAmbiguous,
    updatedAt: now,
  })
  if (
    !target ||
    !target.categoryId ||
    !target.purchaseNote
  ) {
    await db.shoppingItemRules.put({
      key: finalTarget,
      canonicalKey: finalTarget,
      displayName: target?.displayName ?? '',
      categoryId: target?.categoryId ?? source?.categoryId ?? null,
      purchaseNote: target?.purchaseNote || source?.purchaseNote || '',
      purchaseNoteOverride:
        target?.purchaseNoteOverride === true || source?.purchaseNoteOverride === true,
      hiddenPurchaseNotes: target?.hiddenPurchaseNotes ?? source?.hiddenPurchaseNotes ?? [],
      legacyQuantityText:
        target?.legacyQuantityText || source?.legacyQuantityText || '',
      legacyUnit: target?.legacyUnit || source?.legacyUnit || '',
      legacyAmbiguous: target?.legacyAmbiguous ?? source?.legacyAmbiguous,
      updatedAt: now,
    })
  }
  return finalTarget
}

/**
 * Product merges must not silently decide between competing list decisions.
 * Two full assignments, or a full assignment and any subset/full decision for
 * the same dimension, are not mergeable without user confirmation.
 */
async function assertMergeAllocationsCompatible(
  sourceKey: string,
  targetKey: string,
): Promise<void> {
  const [sourceAllocations, targetAllocations] = await Promise.all([
    db.shoppingDemandAllocations.where('itemKey').equals(sourceKey).toArray(),
    db.shoppingDemandAllocations.where('itemKey').equals(targetKey).toArray(),
  ])
  if (sourceAllocations.length === 0 || targetAllocations.length === 0) return

  const targetByPeriod = new Map<string, typeof targetAllocations>()
  for (const allocation of targetAllocations) {
    const rows = targetByPeriod.get(allocation.periodStart) ?? []
    rows.push(allocation)
    targetByPeriod.set(allocation.periodStart, rows)
  }
  const sourceByPeriod = new Map<string, typeof sourceAllocations>()
  for (const allocation of sourceAllocations) {
    const rows = sourceByPeriod.get(allocation.periodStart) ?? []
    rows.push(allocation)
    sourceByPeriod.set(allocation.periodStart, rows)
  }

  const conflict = (periodStart: string, dimension: string, listId: string | null): never => {
    throw new ShoppingListError(
      'allocation-merge-conflict',
      'Zwei Einkaufsverteilungen lassen sich nach der Produktzusammenführung nicht eindeutig vereinigen.',
      { sourceKey, targetKey, periodStart, dimension, listId },
    )
  }

  for (const [periodStart, sourceRows] of sourceByPeriod) {
    const targetRows = targetByPeriod.get(periodStart)
    if (!targetRows || targetRows.length === 0) continue

    const sourceFull = sourceRows.find((allocation) => allocation.dimension === '*')
    const targetFull = targetRows.find((allocation) => allocation.dimension === '*')
    if (sourceFull) conflict(periodStart, '*', sourceFull.listId)
    if (targetFull) conflict(periodStart, '*', targetFull.listId)

    const dimensions = new Set(
      [...sourceRows, ...targetRows]
        .map((allocation) => allocation.dimension)
        .filter((dimension) => dimension !== '*'),
    )
    for (const dimension of dimensions) {
      const sourceDimension = sourceRows.filter(
        (allocation) => allocation.dimension === dimension,
      )
      const targetDimension = targetRows.filter(
        (allocation) => allocation.dimension === dimension,
      )
      if (sourceDimension.length === 0 || targetDimension.length === 0) continue
      if (
        sourceDimension.some((allocation) => allocation.mode === 'full') ||
        targetDimension.some((allocation) => allocation.mode === 'full')
      ) {
        conflict(
          periodStart,
          dimension,
          sourceDimension[0]?.listId ?? targetDimension[0]?.listId ?? null,
        )
      }
    }
  }
}

/**
 * Merge one identity into another. Purchase actions keep their individual
 * rows; only their product key changes, so amounts are neither lost nor
 * counted twice.
 */
export async function mergeShoppingProducts(
  sourceKey: string,
  targetKey: string,
): Promise<string> {
  const source = cleanText(sourceKey)
  const target = cleanText(targetKey)
  if (!source || !target || source === target) return source
  return db.transaction(
    'rw',
    [
      db.shoppingItemRules,
      db.shoppingPurchases,
      db.shoppingChecks,
      db.shoppingQuantityCorrections,
      db.shoppingDemandAllocations,
      db.shoppingLists,
    ],
    async () => {
      const rules = await db.shoppingItemRules.toArray()
      const resolvedTarget = resolveCanonicalKey(target, rules)
      if (resolvedTarget === source) {
        throw new ShoppingError('Diese beiden Artikel können nicht so zusammengeführt werden.')
      }
      await assertMergeAllocationsCompatible(source, resolvedTarget)
      const finalTarget = await transactionMergeRules(source, target)
      const now = Date.now()

      // Product identity changes must not orphan existing list decisions.
      // A collision is ambiguous and aborts the whole transaction; quantities
      // are never silently added or a full assignment silently preferred.
      const sourceAllocations = await db.shoppingDemandAllocations
        .where('itemKey')
        .equals(source)
        .toArray()
      const remappedAllocations = sourceAllocations.map((allocation) => ({
        source: allocation,
        targetId: shoppingAllocationId(
          allocation.periodStart,
          finalTarget,
          allocation.dimension,
          allocation.listId,
        ),
      }))
      for (const entry of remappedAllocations) {
        const conflict = await db.shoppingDemandAllocations.get(entry.targetId)
        if (conflict) {
          throw new ShoppingListError(
            'allocation-merge-conflict',
            'Zwei Einkaufsverteilungen lassen sich nach der Produktzusammenführung nicht eindeutig vereinigen.',
            {
              sourceKey: source,
              targetKey: finalTarget,
              periodStart: entry.source.periodStart,
              dimension: entry.source.dimension,
              listId: entry.source.listId,
              sourceAllocationId: entry.source.id,
              targetAllocationId: conflict.id,
            },
          )
        }
      }
      for (const entry of remappedAllocations) {
        await db.shoppingDemandAllocations.delete(entry.source.id)
        await db.shoppingDemandAllocations.put({
          ...entry.source,
          id: entry.targetId,
          itemKey: finalTarget,
          updatedAt: now,
        })
      }

      await db.shoppingPurchases
        .where('itemKey')
        .equals(source)
        .modify((purchase: ShoppingPurchase) => {
          purchase.itemKey = finalTarget
          purchase.updatedAt = now
        })
      const sourceCorrections = await db.shoppingQuantityCorrections
        .where('itemKey')
        .equals(source)
        .toArray()
      for (const correction of sourceCorrections) {
        const nextId = quantityCorrectionId(
          finalTarget,
          correction.shoppingDate,
          correction.dimension,
        )
        const conflict = await db.shoppingQuantityCorrections.get(nextId)
        if (conflict) {
          // The target already owns a correction for this week/dimension.
          // Keep the target and drop the now redundant source row.
          await db.shoppingQuantityCorrections.delete(correction.id)
        } else {
          await db.shoppingQuantityCorrections.delete(correction.id)
          await db.shoppingQuantityCorrections.put({
            ...correction,
            id: nextId,
            itemKey: finalTarget,
            updatedAt: now,
          })
        }
      }
      // Legacy checks are only relevant if a backup/database still contains
      // them; migrating them here prevents a later double conversion.
      await db.shoppingChecks
        .where('itemKey')
        .equals(source)
        .modify((check) => {
          check.itemKey = finalTarget
          check.updatedAt = now
        })
      await refreshConfirmedTotals(finalTarget)
      return finalTarget
    },
  )
}

/** Explicitly resolve an ambiguous legacy rule to one visible variant. */
export async function resolveAmbiguousRule(
  ruleKey: string,
  targetKey: string,
): Promise<void> {
  const source = cleanText(ruleKey)
  const target = cleanText(targetKey)
  if (!source || !target) return
  await mergeShoppingProducts(source, target)
  const rule = await db.shoppingItemRules.get(source)
  if (!rule) return
  await db.shoppingItemRules.put({
    ...rule,
    canonicalKey: target,
    legacyAmbiguous: false,
    updatedAt: Date.now(),
  })
}

function purchasePeriodStartOf(
  purchase: ShoppingPurchase,
  lists: readonly { id: string; kind: string; periodStart?: string | null; periodEnd?: string | null }[],
): string | null {
  if (purchase.listId?.startsWith('standard:')) {
    return purchase.listId.slice('standard:'.length)
  }
  const containing = lists.find(
    (list) =>
      list.kind === 'standard' &&
      typeof list.periodStart === 'string' &&
      typeof list.periodEnd === 'string' &&
      periodContainsDate({ start: list.periodStart, end: list.periodEnd }, purchase.shoppingDate),
  )
  return containing?.periodStart ?? null
}

async function refreshConfirmedTotals(itemKey: string): Promise<void> {
  const purchases = await db.shoppingPurchases.where('itemKey').equals(itemKey).toArray()
  const lists = await db.shoppingLists.toArray()
  const byPeriod = new Map<string, ShoppingPurchase[]>()
  for (const purchase of purchases) {
    const periodStart = purchasePeriodStartOf(purchase, lists)
    if (!periodStart) continue
    const list = byPeriod.get(periodStart) ?? []
    list.push(purchase)
    byPeriod.set(periodStart, list)
  }
  for (const [periodStart, rows] of byPeriod) {
    rows.sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))
    const latest = rows[rows.length - 1]
    if (!latest) continue
    await db.shoppingPurchases.put({
      ...latest,
      confirmedTotal: confirmedTotals(rows.slice(0, -1), latest.amounts),
      updatedAt: Date.now(),
    })
  }
}

/** Remove an explicit merge. Purchased rows stay with the old target. */
export async function splitShoppingProduct(aliasKey: string): Promise<void> {
  const key = cleanText(aliasKey)
  if (!key) return
  await db.transaction('rw', db.shoppingItemRules, db.shoppingDemandAllocations, async () => {
    const existing = await db.shoppingItemRules.get(key)
    if (!existing) return
    const canonical = cleanText(existing.canonicalKey ?? key)
    if (canonical && canonical !== key) {
      const allocationCount = await db.shoppingDemandAllocations
        .where('itemKey')
        .equals(canonical)
        .count()
      if (allocationCount > 0) {
        throw new ShoppingListError(
          'allocation-merge-conflict',
          'Die Produktzusammenführung kann nicht getrennt werden, solange Einkaufsverteilungen bestehen.',
          { aliasKey: key, canonicalKey: canonical, allocationCount },
        )
      }
    }
    const next: ShoppingItemRule = { ...existing, canonicalKey: key, updatedAt: Date.now() }
    if (
      !next.displayName &&
      !next.categoryId &&
      !next.purchaseNote &&
      !next.purchaseNoteOverride &&
      (next.hiddenPurchaseNotes?.length ?? 0) === 0
    ) {
      await db.shoppingItemRules.delete(key)
    } else {
      await db.shoppingItemRules.put(next)
    }
  })
}

/* ------------------------------------------------------------------ */
/* Week-scoped quantity corrections                                    */
/* ------------------------------------------------------------------ */

export interface QuantityCorrectionInput {
  shoppingDate: string
  itemKey: string
  dimension: string
  quantityText: string
  unit?: string | null
  sourceSignature: string
}

/** Stable id keeps repeated merge/import operations idempotent. */
export function quantityCorrectionId(
  itemKey: string,
  shoppingDate: string,
  dimension: string,
): string {
  return `${itemKey}::${shoppingDate}::${dimension}`
}

export async function saveQuantityCorrection(
  input: QuantityCorrectionInput,
): Promise<ShoppingQuantityCorrection> {
  const shoppingDate = requireDate(cleanText(input.shoppingDate), 'Der Einkaufstag')
  const itemKey = cleanText(input.itemKey)
  if (!itemKey) throw new ShoppingError('Der Artikel konnte nicht zugeordnet werden.')
  const dimension = cleanText(input.dimension)
  if (!dimension) throw new ShoppingError('Die Mengenposition konnte nicht zugeordnet werden.')
  const quantityText = cleanText(input.quantityText)
  if (!quantityText) throw new ShoppingError('Bitte eine korrigierte Menge angeben.')
  const unit = optionalText(input.unit)
  const parsed = parseShoppingQuantityPosition(quantityText, unit)
  if (!parsed) throw new ShoppingError('Die korrigierte Menge konnte nicht gelesen werden.')
  if (parsed.dimension !== dimension) {
    throw new ShoppingError('Die Einheit passt nicht zur gewählten Mengenposition.')
  }
  if (!shoppingUnitDimension(unit) && unit) {
    throw new ShoppingError('Die Einheit konnte nicht zugeordnet werden.')
  }
  const id = quantityCorrectionId(itemKey, shoppingDate, dimension)
  return db.transaction('rw', db.shoppingQuantityCorrections, async () => {
    const existing = await db.shoppingQuantityCorrections.get(id)
    const now = Date.now()
    const correction: ShoppingQuantityCorrection = {
      id,
      shoppingDate,
      itemKey,
      dimension,
      quantityText,
      unit,
      sourceSignature: cleanText(input.sourceSignature),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    }
    await db.shoppingQuantityCorrections.put(correction)
    return correction
  })
}

export async function removeQuantityCorrection(id: string): Promise<void> {
  await db.shoppingQuantityCorrections.delete(id)
}

/** Explicitly discard a legacy product-wide correction after the user decided. */
export async function clearLegacyQuantity(key: string): Promise<void> {
  const cleanKey = cleanText(key)
  if (!cleanKey) return
  await db.transaction('rw', db.shoppingItemRules, async () => {
    const existing = await db.shoppingItemRules.get(cleanKey)
    if (!existing) return
    const next: ShoppingItemRule = {
      ...existing,
      legacyQuantityText: '',
      legacyUnit: '',
      updatedAt: Date.now(),
    }
    if (
      !next.displayName &&
      !next.categoryId &&
      !next.purchaseNote &&
      !next.purchaseNoteOverride &&
      (next.hiddenPurchaseNotes?.length ?? 0) === 0 &&
      next.legacyAmbiguous !== true &&
      (next.canonicalKey ?? cleanKey) === cleanKey
    ) {
      await db.shoppingItemRules.delete(cleanKey)
    } else {
      await db.shoppingItemRules.put(next)
    }
  })
}

/* ------------------------------------------------------------------ */
/* Individual purchase actions                                         */
/* ------------------------------------------------------------------ */

function toPurchasedAmounts(
  positions: readonly ShoppingAmountPosition[],
): ShoppingPurchasedAmount[] {
  return positions
    .filter((position) => position.lower > 0 || position.upper > 0)
    .map((position) => ({
      dimension: position.dimension,
      lower: Math.max(0, position.lower),
      upper: Math.max(0, position.upper),
    }))
}

function confirmedTotals(
  previous: readonly ShoppingPurchase[],
  added: readonly ShoppingPurchasedAmount[],
): ShoppingPurchasedAmount[] {
  const byDimension = new Map<string, ShoppingPurchasedAmount>()
  const add = (entry: ShoppingPurchasedAmount) => {
    if (!Number.isFinite(entry.lower) || !Number.isFinite(entry.upper)) return
    const existing = byDimension.get(entry.dimension)
    if (!existing) {
      byDimension.set(entry.dimension, {
        dimension: entry.dimension,
        lower: Math.max(0, entry.lower),
        upper: Math.max(0, entry.upper),
      })
    } else {
      existing.lower = Math.round((existing.lower + Math.max(0, entry.lower)) * 1000) / 1000
      existing.upper = Math.round((existing.upper + Math.max(0, entry.upper)) * 1000) / 1000
    }
  }
  for (const purchase of previous) {
    for (const entry of purchase.amounts) add(entry)
  }
  for (const entry of added) add(entry)
  return Array.from(byDimension.values())
}

function purchaseBelongsToPeriod(
  purchase: ShoppingPurchase,
  periodStart: string,
): boolean {
  if (purchase.listId?.startsWith('standard:')) {
    return purchase.listId.slice('standard:'.length) === periodStart
  }
  if (purchase.listId) return false
  // Legacy rows without a list reference carry no reliable period identity.
  // Use the historical regular seven-day window only as a conservative match;
  // it never re-dates or rewrites the row.
  const end = addDays(periodStart, 6)
  return purchase.shoppingDate >= periodStart && purchase.shoppingDate <= end
}

export interface PurchaseInput {
  shoppingDate: string
  itemKey: string
  /** Resolved period the purchase belongs to; used for cumulative totals. */
  periodStart?: string
  /** Optional deterministic id for idempotent writes. */
  id?: string
  /** Owning shopping list; omitted for legacy callers. */
  listId?: string
  /** Set only when this purchase belongs to one explicit manual article. */
  manualItemId?: string
  /** Confirmed quantities, one fixed amount per dimension. */
  amounts: readonly ShoppingPurchasedAmount[]
  /** Full required demand at confirmation time (stored for range settling). */
  snapshot: readonly ShoppingAmountPosition[]
  /** Optional cumulative total after this action (computed by the caller). */
  confirmedTotal?: readonly ShoppingPurchasedAmount[]
  qualitative?: boolean
}

/**
 * Write one purchase row. Callers that already own a Dexie transaction may use
 * this helper directly; it never opens a nested transaction itself.
 */
export async function addShoppingPurchaseRecord(
  input: PurchaseInput,
): Promise<ShoppingPurchase> {
  const shoppingDate = requireDate(cleanText(input.shoppingDate), 'Der Einkaufstag')
  const itemKey = cleanText(input.itemKey)
  if (!itemKey) throw new ShoppingError('Der Artikel konnte nicht zugeordnet werden.')
  const previous = await db.shoppingPurchases.where('itemKey').equals(itemKey).toArray()
  const latest = previous.reduce((max, entry) => Math.max(max, entry.createdAt), 0)
  // Monotonic timestamps make "last purchase" unambiguous even inside the
  // same millisecond.
  const now = Math.max(Date.now(), latest + 1)
  const listId = optionalText(input.listId) ?? undefined
  const periodStart =
    optionalText(input.periodStart) ??
    (listId?.startsWith('standard:') ? listId.slice('standard:'.length) : null)
  const previousInPeriod = periodStart
    ? previous.filter((entry) => purchaseBelongsToPeriod(entry, periodStart))
    : []
  const purchase: ShoppingPurchase = {
    id: optionalText(input.id) ?? randomId(),
    shoppingDate,
    itemKey,
    listId,
    manualItemId: optionalText(input.manualItemId) ?? undefined,
    provenance: 'recorded',
    confirmedTotal: input.confirmedTotal
      ? confirmedTotals([], input.confirmedTotal)
      : confirmedTotals(previousInPeriod, input.amounts),
    amounts: toPurchasedAmounts(
      input.amounts.map((entry) => ({
        dimension: entry.dimension,
        unit: null,
        lower: entry.lower,
        upper: entry.upper,
        qualifier: '',
      })),
    ),
    snapshot: toPurchasedAmounts(input.snapshot),
    qualitative: input.qualitative === true || input.amounts.length === 0,
    createdAt: now,
    updatedAt: now,
  }
  await db.shoppingPurchases.put(purchase)
  return purchase
}

export async function addShoppingPurchase(input: PurchaseInput): Promise<ShoppingPurchase> {
  const shoppingDate = requireDate(cleanText(input.shoppingDate), 'Der Einkaufstag')
  const itemKey = cleanText(input.itemKey)
  if (!itemKey) throw new ShoppingError('Der Artikel konnte nicht zugeordnet werden.')
  let listId: string | undefined = optionalText(input.listId) ?? undefined
  let manualItemId: string | undefined = optionalText(input.manualItemId) ?? undefined
  if (!listId && !manualItemId) {
    // The legacy page has no list concept. A new purchase is only accepted
    // when the current distribution has exactly one target list.
    const target = await resolvePurchaseTargetForLegacyWrite({ shoppingDate, itemKey })
    listId = target.listId
    manualItemId = target.manualItemId
  }
  const [period, settings] = await Promise.all([
    resolveShoppingPeriod(
      listId?.startsWith('standard:')
        ? listId.slice('standard:'.length)
        : shoppingDate,
    ),
    getShoppingSettings(),
  ])
  return db.transaction('rw', [db.shoppingPurchases, db.shoppingLists], async () => {
    if (listId?.startsWith('standard:')) {
      const existing = await db.shoppingLists.get(listId)
      if (!existing) {
        await db.shoppingLists.put(
          standardShoppingListRecord(period, settings.standardListName, Date.now()),
        )
      }
    }
    return addShoppingPurchaseRecord({
      ...input,
      shoppingDate,
      itemKey,
      listId,
      manualItemId,
      periodStart: period.start,
    })
  })
}

export async function removeShoppingPurchase(id: string): Promise<void> {
  await db.shoppingPurchases.delete(id)
}

/** Removes exactly the newest action for one product and week. */
export async function removeLastShoppingPurchase(
  shoppingDate: string,
  itemKey: string,
): Promise<void> {
  const date = requireDate(cleanText(shoppingDate), 'Der Einkaufstag')
  const key = cleanText(itemKey)
  const rows = await db.shoppingPurchases.where('itemKey').equals(key).toArray()
  const sameWeek = rows.filter(
    (row) =>
      requireDate(row.shoppingDate, 'Der Einkaufstag').slice(0, 10) === date.slice(0, 10),
  )
  // The caller passes the week start, not necessarily the action date. Use the
  // latest action of that product; the page always passes the visible item.
  const candidates = sameWeek.length > 0 ? sameWeek : rows
  const latest = candidates.sort(
    (a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id),
  )[0]
  if (latest) await db.shoppingPurchases.delete(latest.id)
}
