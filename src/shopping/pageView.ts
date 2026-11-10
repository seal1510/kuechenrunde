/*
 * openCook Web
 * Copyright (C) 2026 openCook Web contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Pure view model for the shopping page. It composes the existing demand,
 * distribution and purchase rules into the rows a shopping list shows. No
 * React, no Dexie and no second quantity calculation lives here: the recipe
 * demand is still built exactly once by `buildShoppingList`, the per-list
 * distribution by `resolveShoppingDistribution` and the open amounts by
 * `buildShoppingOpenDemand`.
 */

import { todayKey } from '../domain/dates'
import {
  buildShoppingList,
  formatShoppingAmount,
  guessShoppingCategory,
  resolveCanonicalKey,
  SHOPPING_CATEGORIES,
  shoppingItemKey,
  splitIngredientName,
  type ShoppingAmountPosition,
  type ShoppingCategoryId,
  type ShoppingListItem,
} from '../domain/shopping'
import {
  fromAmountMilli,
  resolveShoppingDistribution,
  resolveShoppingPeriodResolution,
  standardShoppingListId,
  standardShoppingListName,
  standardShoppingListRecord,
  type ShoppingDistributionResult,
  type ShoppingOpenPosition,
  type ShoppingPeriod,
} from '../domain/shoppingLists'
import {
  shoppingSettingsFromRows,
  type ShoppingSettings,
} from '../settings/shopping'
import type {
  CookSession,
  FreeDish,
  Recipe,
  SettingRecord,
  ShoppingDemandAllocation,
  ShoppingItemRule,
  ShoppingList,
  ShoppingListKind,
  ShoppingManualItem,
  ShoppingPurchase,
  ShoppingQuantityCorrection,
} from '../types'
import { isDefaultExcludedIngredient } from './defaultExclusions'
import { categoryOrderFromRows } from './service'
import {
  buildShoppingOpenDemand,
  type ShoppingListServiceConflict,
  type ShoppingOpenDemandResult,
} from './listService'

const CATEGORY_IDS = new Set<string>(SHOPPING_CATEGORIES.map((category) => category.id))

export interface ShoppingPageConflict {
  code: 'overlapping-periods'
  date: string
  listIds: string[]
}

export interface ShoppingPageList {
  id: string
  kind: ShoppingListKind
  name: string
  /** First day of the persisted period; `null` for free lists. */
  periodStart: string | null
  periodEnd: string | null
  createdAt: number
  isStandard: boolean
  openCount: number
  doneCount: number
  reviewCount: number
  requiresReview: boolean
}

/**
 * A preserved allocation or purchase that can no longer be applied to the
 * current demand. It stays visible and removable instead of becoming a warning
 * without a row.
 */
export interface ShoppingPageReviewRow {
  id: string
  listId: string
  itemKey: string
  name: string
  allocationIds: string[]
  purchaseIds: string[]
  allocationLabels: string[]
  purchaseLabels: string[]
}

export interface ShoppingPageRow {
  /** Stable within one render; used for dialogs and focus restoration. */
  id: string
  listId: string
  kind: 'automatic' | 'manual'
  itemKey: string
  name: string
  variant: string
  categoryId: ShoppingCategoryId
  requiredPositions: ShoppingAmountPosition[]
  openPositions: ShoppingAmountPosition[]
  purchasedPositions: ShoppingAmountPosition[]
  /** Unstructured amounts that cannot be checked numerically. */
  unparsedAmounts: string[]
  missingQuantity: boolean
  notes: string[]
  status: 'open' | 'done'
  /** Purchases that produced this row's done state. */
  purchaseIds: string[]
  /** Lists this automatic item is currently distributed to, by display name. */
  distributionListNames: string[]
  /** Rich automatic item metadata, re-used by the existing edit dialog. */
  richItem: ShoppingListItem | null
  manualItem: ShoppingManualItem | null
}

export interface ShoppingPageView {
  anchor: string
  today: string
  period: ShoppingPeriod
  conflict: ShoppingPageConflict | null
  settings: ShoppingSettings
  categoryOrder: ShoppingCategoryId[]
  standardListId: string
  lists: ShoppingPageList[]
  rowsByList: Record<string, ShoppingPageRow[]>
  reviewRowsByList: Record<string, ShoppingPageReviewRow[]>
  warnings: string[]
  requiresReview: boolean
  /** Count of rows that are preserved but not booked as bought. */
  serviceConflicts: ShoppingListServiceConflict[]
  conflictLabels: string[]
  richItems: ShoppingListItem[]
  automaticPurchases: ShoppingPurchase[]
  /** Read-only distribution used by the move/split dialog. */
  distribution: ShoppingDistributionResult | null
}

export interface ShoppingPageViewInput {
  anchor: string
  today?: string
  settingsRows: readonly SettingRecord[]
  lists: readonly ShoppingList[]
  recipes: readonly Recipe[]
  freeDishes: readonly FreeDish[]
  cookSessions: readonly CookSession[]
  manualItems: readonly ShoppingManualItem[]
  purchases: readonly ShoppingPurchase[]
  rules: readonly ShoppingItemRule[]
  quantityCorrections: readonly ShoppingQuantityCorrection[]
  allocations: readonly ShoppingDemandAllocation[]
}

function manualCategory(item: ShoppingManualItem): ShoppingCategoryId {
  if (item.categoryId && CATEGORY_IDS.has(item.categoryId)) {
    return item.categoryId as ShoppingCategoryId
  }
  const split = splitIngredientName(item.name, { unit: item.unit })
  return guessShoppingCategory([split.name, split.variant].filter(Boolean).join(' '))
}

/**
 * Only purchases that actually contributed to the open calculation belong to
 * a row. Legacy/ambiguous purchases stay visible in the review section instead
 * of silently marking a normal row as done.
 */
function purchaseIdsOnList(
  richItem: ShoppingListItem | null,
  listId: string,
  purchaseListIds: ReadonlyMap<string, string>,
): string[] {
  if (!richItem) return []
  return richItem.purchases
    .filter((purchase) => purchaseListIds.get(purchase.id) === listId)
    .map((purchase) => purchase.id)
}

function amountPosition(
  position: ShoppingOpenPosition,
  lower: number,
  upper: number,
  richItem: ShoppingListItem | null,
): ShoppingAmountPosition {
  const richPosition = richItem?.requiredPositions.find(
    (entry) => entry.dimension === position.dimension,
  )
  return {
    dimension: position.dimension,
    unit: position.unit ?? richPosition?.unit ?? null,
    lower,
    upper,
    qualifier: richPosition?.qualifier ?? '',
  }
}

function openAmounts(
  positions: readonly ShoppingOpenPosition[],
  mode: 'required' | 'open' | 'purchased',
  richItem: ShoppingListItem | null,
): ShoppingAmountPosition[] {
  const result: ShoppingAmountPosition[] = []
  for (const position of positions) {
    const lower =
      mode === 'required'
        ? position.assignedLower
        : mode === 'open'
          ? position.openLower
          : position.purchasedLower
    const upper =
      mode === 'required'
        ? position.assignedUpper
        : mode === 'open'
          ? position.openUpper
          : position.purchasedUpper
    if (mode !== 'required' && lower <= 0 && upper <= 0) continue
    result.push(amountPosition(position, lower, upper, richItem))
  }
  return result.sort((left, right) => left.dimension.localeCompare(right.dimension))
}

function distributedListNames(
  itemKey: string,
  distribution: ShoppingDistributionResult,
  listNameById: ReadonlyMap<string, string>,
): string[] {
  const names = new Set<string>()
  for (const position of distribution.positions) {
    if (position.itemKey !== itemKey) continue
    for (const amount of position.amounts) {
      if (amount.lower <= 0 && amount.upper <= 0) continue
      names.add(listNameById.get(amount.listId) ?? amount.listId)
    }
  }
  for (const placement of distribution.unquantified) {
    if (placement.itemKey !== itemKey) continue
    names.add(listNameById.get(placement.listId) ?? placement.listId)
  }
  return Array.from(names)
}

function buildRows(
  open: ShoppingOpenDemandResult,
  richItems: readonly ShoppingListItem[],
  distribution: ShoppingDistributionResult,
  listNameById: ReadonlyMap<string, string>,
): Record<string, ShoppingPageRow[]> {
  const rowsByList: Record<string, ShoppingPageRow[]> = {}
  const push = (row: ShoppingPageRow) => {
    const rows = rowsByList[row.listId] ?? []
    rows.push(row)
    rowsByList[row.listId] = rows
  }

  const richByKey = new Map(richItems.map((item) => [item.key, item]))
  const positionsByItem = new Map<
    string,
    { listId: string; itemKey: string; positions: ShoppingOpenPosition[] }
  >()
  for (const position of open.positions) {
    const key = `${position.listId}\u0000${position.itemKey}`
    const group = positionsByItem.get(key) ?? {
      listId: position.listId,
      itemKey: position.itemKey,
      positions: [],
    }
    group.positions.push(position)
    positionsByItem.set(key, group)
  }

  // Automatic unquantified placements are only attached to the list they were
  // actually assigned to. A moved item must not reappear on the standard list.
  const unquantifiedByItem = new Map<
    string,
    (typeof open.automaticUnquantified)[number]
  >()
  for (const placement of open.automaticUnquantified) {
    unquantifiedByItem.set(`${placement.listId}\u0000${placement.itemKey}`, placement)
  }

  for (const [key, group] of positionsByItem) {
    const richItem = richByKey.get(group.itemKey) ?? null
    const placement = unquantifiedByItem.get(key)
    const openPositions = openAmounts(group.positions, 'open', richItem)
    const requiredPositions = openAmounts(group.positions, 'required', richItem)
    const purchasedPositions = openAmounts(group.positions, 'purchased', richItem)
    const purchaseIds = Array.from(
      new Set([
        ...group.positions.flatMap((position) => position.purchaseIds),
        ...purchaseIdsOnList(richItem, group.listId, open.purchaseListIds),
      ]),
    )
    const unparsedAmounts = placement ? [...placement.unparsedAmounts] : []
    const missingQuantity = placement?.missingQuantity === true
    const hasUnquantified = unparsedAmounts.length > 0 || missingQuantity
    const status: ShoppingPageRow['status'] =
      openPositions.length > 0
        ? 'open'
        : hasUnquantified && purchaseIds.length === 0
          ? 'open'
          : 'done'
    const name = richItem?.name || group.positions[0]?.name || ''
    push({
      id: `auto:${group.listId}:${group.itemKey}`,
      listId: group.listId,
      kind: 'automatic',
      itemKey: group.itemKey,
      name,
      variant: richItem?.variant ?? '',
      categoryId: richItem?.categoryId ?? guessShoppingCategory(name),
      requiredPositions,
      openPositions,
      purchasedPositions,
      unparsedAmounts,
      missingQuantity,
      notes: richItem?.purchaseNotes ?? [],
      status,
      purchaseIds,
      distributionListNames: distributedListNames(
        group.itemKey,
        distribution,
        listNameById,
      ),
      richItem,
      manualItem: null,
    })
  }

  for (const placement of open.automaticUnquantified) {
    const key = `${placement.listId}\u0000${placement.itemKey}`
    if (positionsByItem.has(key)) continue
    const richItem = richByKey.get(placement.itemKey) ?? null
    const purchaseIds = purchaseIdsOnList(richItem, placement.listId, open.purchaseListIds)
    const name = richItem?.name || placement.name
    push({
      id: `auto:${placement.listId}:${placement.itemKey}:unquantified`,
      listId: placement.listId,
      kind: 'automatic',
      itemKey: placement.itemKey,
      name,
      variant: richItem?.variant ?? '',
      categoryId: richItem?.categoryId ?? guessShoppingCategory(name),
      requiredPositions: [],
      openPositions: [],
      purchasedPositions: [],
      unparsedAmounts: [...placement.unparsedAmounts],
      missingQuantity: placement.missingQuantity,
      notes: richItem?.purchaseNotes ?? [],
      status: purchaseIds.length > 0 ? 'done' : 'open',
      purchaseIds,
      distributionListNames: distributedListNames(
        placement.itemKey,
        distribution,
        listNameById,
      ),
      richItem,
      manualItem: null,
    })
  }

  for (const manual of open.manualItems) {
    const item = manual.manualItem
    const position = manual.position
    const openPositions: ShoppingAmountPosition[] =
      position && (manual.openLower > 0 || manual.openUpper > 0)
        ? [
            {
              dimension: position.dimension,
              unit: position.unit,
              lower: manual.openLower,
              upper: manual.openUpper,
              qualifier: position.qualifier,
            },
          ]
        : []
    const purchasedPositions: ShoppingAmountPosition[] =
      position && (manual.purchasedLower > 0 || manual.purchasedUpper > 0)
        ? [
            {
              dimension: position.dimension,
              unit: position.unit,
              lower: manual.purchasedLower,
              upper: manual.purchasedUpper,
              qualifier: position.qualifier,
            },
          ]
        : []
    const requiredPositions: ShoppingAmountPosition[] = position
      ? [
          {
            dimension: position.dimension,
            unit: position.unit,
            lower: manual.assignedLower,
            upper: manual.assignedUpper,
            qualifier: position.qualifier,
          },
        ]
      : []
    push({
      id: `manual:${item.id}`,
      listId: manual.listId,
      kind: 'manual',
      itemKey:
        shoppingItemKey(splitIngredientName(item.name, { unit: item.unit }).identityName) ||
        item.name,
      name: item.name,
      variant: '',
      categoryId: manualCategory(item),
      requiredPositions,
      openPositions,
      purchasedPositions,
      unparsedAmounts: position ? [] : item.quantityText ? [item.quantityText] : [],
      missingQuantity: position ? false : !item.quantityText,
      notes: item.purchaseNote ? [item.purchaseNote] : [],
      status: manual.done ? 'done' : 'open',
      purchaseIds: [],
      distributionListNames: [],
      richItem: null,
      manualItem: item,
    })
  }

  return rowsByList
}

function sortRows(
  rows: readonly ShoppingPageRow[],
  order: readonly ShoppingCategoryId[],
): ShoppingPageRow[] {
  const rank = new Map(order.map((category, index) => [category, index]))
  return rows.slice().sort((left, right) => {
    const leftRank = rank.get(left.categoryId) ?? order.length
    const rightRank = rank.get(right.categoryId) ?? order.length
    return (
      leftRank - rightRank ||
      left.name.localeCompare(right.name, 'de') ||
      left.id.localeCompare(right.id)
    )
  })
}

function buildItemNameMap(input: ShoppingPageViewInput): Map<string, string> {
  const rules = input.rules
  const names = new Map<string, string>()
  for (const rule of rules) {
    const display = rule.displayName.trim()
    if (!display) continue
    const key = resolveCanonicalKey(rule.key, rules)
    if (!names.has(key)) names.set(key, display)
  }
  const addName = (rawName: string, unit?: string | null) => {
    const split = splitIngredientName(rawName, { unit })
    const rawKey = shoppingItemKey(split.identityName)
    if (!rawKey) return
    const key = resolveCanonicalKey(rawKey, rules)
    const label = split.name.trim() || rawName.trim()
    if (label && !names.has(key)) names.set(key, label)
  }
  for (const recipe of input.recipes) {
    for (const ingredient of recipe.ingredients) addName(ingredient.name, ingredient.unit)
  }
  for (const freeDish of input.freeDishes) {
    for (const ingredient of freeDish.ingredients) addName(ingredient.name, ingredient.unit)
  }
  for (const manual of input.manualItems) addName(manual.name, manual.unit)
  return names
}

function allocationLabel(allocation: ShoppingDemandAllocation): string {
  if (allocation.mode === 'full') {
    return allocation.dimension === '*' ? 'Gesamte Zutat' : 'Gesamte Menge'
  }
  const amount = fromAmountMilli(allocation.quantityMilli ?? 0)
  return formatShoppingAmount({
    dimension: allocation.dimension,
    unit: allocation.dimension === 'count' ? 'Stück' : null,
    lower: amount,
    upper: amount,
    qualifier: '',
  })
}

function purchaseLabel(purchase: ShoppingPurchase): string {
  if (purchase.amounts.length === 0) return 'ohne Mengenangabe'
  return purchase.amounts
    .map((amount) =>
      formatShoppingAmount({
        dimension: amount.dimension,
        unit: amount.dimension === 'count' ? 'Stück' : null,
        lower: amount.lower,
        upper: amount.upper,
        qualifier: '',
      }),
    )
    .join(' · ')
}

interface MutableReviewRow {
  listId: string
  itemKey: string
  allocationIds: Set<string>
  purchaseIds: Set<string>
  allocationLabels: Set<string>
  purchaseLabels: Set<string>
}

function buildReviewRows(
  input: ShoppingPageViewInput,
  distribution: ShoppingDistributionResult,
  serviceConflicts: readonly ShoppingListServiceConflict[],
  itemNames: ReadonlyMap<string, string>,
): Record<string, ShoppingPageReviewRow[]> {
  const standardId = standardShoppingListId(distribution.period.start)
  const listIds = new Set<string>([
    ...input.lists.map((list) => list.id),
    standardId,
  ])
  const rows = new Map<string, MutableReviewRow>()
  const seenAllocations = new Set<string>()
  const ensure = (listId: string, itemKey: string): MutableReviewRow => {
    const key = `${listId}\u0000${itemKey}`
    const existing = rows.get(key)
    if (existing) return existing
    const created: MutableReviewRow = {
      listId,
      itemKey,
      allocationIds: new Set(),
      purchaseIds: new Set(),
      allocationLabels: new Set(),
      purchaseLabels: new Set(),
    }
    rows.set(key, created)
    return created
  }
  const addAllocation = (allocation: ShoppingDemandAllocation) => {
    if (seenAllocations.has(allocation.id)) return
    seenAllocations.add(allocation.id)
    const reviewListId = listIds.has(allocation.listId)
      ? allocation.listId
      : standardId
    const entry = ensure(reviewListId, allocation.itemKey)
    entry.allocationIds.add(allocation.id)
    entry.allocationLabels.add(allocationLabel(allocation))
  }

  for (const allocation of distribution.orphanedAllocations) {
    addAllocation(allocation)
  }
  for (const position of distribution.positions) {
    for (const resolved of position.allocations) {
      if (!resolved.allocation.listId) continue
      const notApplied =
        resolved.blocked ||
        (resolved.effectiveLower <= 0 && resolved.effectiveUpper <= 0)
      if (notApplied) addAllocation(resolved.allocation)
    }
  }
  for (const conflict of serviceConflicts) {
    if (conflict.code !== 'unmatched-purchase') continue
    if (!conflict.purchaseId) continue
    const purchase = input.purchases.find(
      (entry) => entry.id === conflict.purchaseId,
    )
    if (!purchase) continue
    const reviewListId =
      conflict.listId && listIds.has(conflict.listId)
        ? conflict.listId
        : standardId
    const itemKey = resolveCanonicalKey(purchase.itemKey, input.rules)
    const entry = ensure(reviewListId, itemKey)
    entry.purchaseIds.add(purchase.id)
    entry.purchaseLabels.add(purchaseLabel(purchase))
  }

  const byList: Record<string, ShoppingPageReviewRow[]> = {}
  for (const entry of rows.values()) {
    if (entry.allocationIds.size === 0 && entry.purchaseIds.size === 0) continue
    const row: ShoppingPageReviewRow = {
      id: `review:${entry.listId}:${entry.itemKey}`,
      listId: entry.listId,
      itemKey: entry.itemKey,
      name: itemNames.get(entry.itemKey) ?? entry.itemKey,
      allocationIds: Array.from(entry.allocationIds).sort(),
      purchaseIds: Array.from(entry.purchaseIds).sort(),
      allocationLabels: Array.from(entry.allocationLabels),
      purchaseLabels: Array.from(entry.purchaseLabels),
    }
    const list = byList[entry.listId] ?? []
    list.push(row)
    byList[entry.listId] = list
  }
  for (const list of Object.values(byList)) {
    list.sort((left, right) => left.name.localeCompare(right.name, 'de'))
  }
  return byList
}

export function buildShoppingPageView(input: ShoppingPageViewInput): ShoppingPageView {
  const today = input.today ?? todayKey()
  const settings = shoppingSettingsFromRows(input.settingsRows)
  const categoryOrder = categoryOrderFromRows(input.settingsRows)
  const resolution = resolveShoppingPeriodResolution(input.anchor, settings, input.lists)
  const period = resolution.period
  const standardListIdValue = standardShoppingListId(period.start)
  const persistedStandard = input.lists.find((list) => list.id === standardListIdValue)
  const standardList =
    persistedStandard ??
    standardShoppingListRecord(period, settings.standardListName, 0)
  const standardName = standardShoppingListName(settings.standardListName, period)
  const freeLists = input.lists
    .filter((list) => list.kind === 'free')
    .slice()
    .sort(
      (left, right) =>
        left.createdAt - right.createdAt || left.name.localeCompare(right.name, 'de'),
    )

  if (resolution.conflict) {
    const overview: ShoppingPageList[] = [standardList, ...freeLists]
      .filter((list, index, all) => all.findIndex((entry) => entry.id === list.id) === index)
      .map((list) => ({
        id: list.id,
        kind: list.kind,
        name: list.id === standardListIdValue ? standardName : list.name,
        periodStart: list.periodStart,
        periodEnd: list.periodEnd,
        createdAt: list.createdAt,
        isStandard: list.kind === 'standard',
        openCount: 0,
        doneCount: 0,
        reviewCount: 0,
        requiresReview: true,
      }))
    return {
      anchor: input.anchor,
      today,
      period,
      conflict: resolution.conflict,
      settings,
      categoryOrder,
      standardListId: standardListIdValue,
      lists: overview,
      rowsByList: {},
      reviewRowsByList: {},
      warnings: [],
      requiresReview: true,
      serviceConflicts: [],
      conflictLabels: [],
      richItems: [],
      automaticPurchases: [],
      distribution: null,
    }
  }

  const automaticPurchases = input.purchases.filter(
    (purchase) => !purchase.manualItemId,
  )

  // Exactly one build of the automatic demand. `manualItems` stays empty on
  // purpose: manual articles are independent rows on their own list, even when
  // their name matches a recipe ingredient.
  const richList = buildShoppingList({
    anchor: period.start,
    periodStart: period.start,
    periodEnd: period.end,
    recipes: input.recipes,
    freeDishes: input.freeDishes,
    cookSessions: input.cookSessions,
    manualItems: [],
    purchases: automaticPurchases,
    rules: input.rules,
    quantityCorrections: input.quantityCorrections,
    today,
  })

  const distribution = resolveShoppingDistribution({
    periodStart: period.start,
    period,
    standardListId: standardListIdValue,
    demand: richList.items.map((item) => ({
      key: item.key,
      name: item.name,
      positions: item.requiredPositions,
      unparsedAmounts: item.unparsedAmounts,
      missingQuantity: item.missingQuantity,
    })),
    allocations: input.allocations,
    listIds: input.lists
      .filter(
        (list) =>
          list.kind === 'free' || list.periodStart === period.start,
      )
      .map((list) => list.id),
  })

  const openDemand = buildShoppingOpenDemand({
    period,
    standardListId: standardListIdValue,
    standardList,
    lists: input.lists,
    distribution,
    purchases: input.purchases,
    rules: input.rules,
    manualItems: input.manualItems,
  })

  const listNameById = new Map<string, string>([
    [standardListIdValue, standardName],
    ...freeLists.map((list) => [list.id, list.name] as const),
  ])
  const rawRows = buildRows(
    openDemand,
    richList.items,
    distribution,
    listNameById,
  )
  // Hide only automatically derived staple rows, and do it after the demand
  // and distribution have been calculated. This keeps existing allocations
  // and purchases valid, avoids new review conflicts, and lets all displayed
  // counters below count exactly the visible rows. Manual articles are always
  // kept, even when their name is on the deny-list.
  const rowsByList: Record<string, ShoppingPageRow[]> = {}
  for (const [listId, rows] of Object.entries(rawRows)) {
    rowsByList[listId] = sortRows(
      rows.filter(
        (row) =>
          row.kind === 'manual' ||
          !isDefaultExcludedIngredient(row.name, row.variant),
      ),
      categoryOrder,
    )
  }

  const itemNames = buildItemNameMap(input)
  const reviewRowsByList = buildReviewRows(
    input,
    distribution,
    openDemand.serviceConflicts,
    itemNames,
  )
  const summaryById = new Map(
    openDemand.lists.map((summary) => [summary.listId, summary]),
  )
  const lists: ShoppingPageList[] = [standardList, ...freeLists]
    .filter((list, index, all) => all.findIndex((entry) => entry.id === list.id) === index)
    .map((list) => {
      const rows = rowsByList[list.id] ?? []
      const reviewCount = reviewRowsByList[list.id]?.length ?? 0
      return {
        id: list.id,
        kind: list.kind,
        name: list.id === standardListIdValue ? standardName : list.name,
        periodStart: list.periodStart,
        periodEnd: list.periodEnd,
        createdAt: list.createdAt,
        isStandard: list.kind === 'standard',
        openCount: rows.filter((row) => row.status === 'open').length,
        doneCount: rows.filter((row) => row.status === 'done').length,
        reviewCount,
        requiresReview:
          (summaryById.get(list.id)?.requiresReview ?? false) || reviewCount > 0,
      }
    })

  const richByKey = new Map(richList.items.map((item) => [item.key, item]))
  const manualById = new Map(input.manualItems.map((item) => [item.id, item]))
  const conflictLabels = Array.from(
    new Set(
      [
        ...openDemand.serviceConflicts.map((conflict) => {
          if (conflict.manualItemId) {
            return manualById.get(conflict.manualItemId)?.name ?? ''
          }
          if (!conflict.itemKey) return ''
          return (
            richByKey.get(conflict.itemKey)?.name ??
            itemNames.get(conflict.itemKey) ??
            conflict.itemKey
          )
        }),
        ...openDemand.conflicts.map((conflict) => {
          if (!conflict.itemKey) return ''
          return (
            richByKey.get(conflict.itemKey)?.name ??
            itemNames.get(conflict.itemKey) ??
            conflict.itemKey
          )
        }),
      ]
        .map((label) => label.trim())
        .filter(Boolean),
    ),
  )

  return {
    anchor: input.anchor,
    today,
    period,
    conflict: null,
    settings,
    categoryOrder,
    standardListId: standardListIdValue,
    lists,
    rowsByList,
    reviewRowsByList,
    warnings: richList.warnings,
    requiresReview: openDemand.requiresReview,
    serviceConflicts: openDemand.serviceConflicts,
    conflictLabels,
    richItems: richList.items,
    automaticPurchases,
    distribution,
  }
}
