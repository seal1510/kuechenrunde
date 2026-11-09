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
  guessShoppingCategory,
  SHOPPING_CATEGORIES,
  shoppingItemKey,
  splitIngredientName,
  type ShoppingAmountPosition,
  type ShoppingCategoryId,
  type ShoppingListItem,
} from '../domain/shopping'
import {
  periodContainsDate,
  resolveShoppingDistribution,
  resolveShoppingPeriodResolution,
  standardShoppingListId,
  standardShoppingListName,
  standardShoppingListRecord,
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
  requiresReview: boolean
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
  warnings: string[]
  requiresReview: boolean
  /** Count of rows that are preserved but not booked as bought. */
  serviceConflicts: ShoppingListServiceConflict[]
  conflictLabels: string[]
  richItems: ShoppingListItem[]
  automaticPurchases: ShoppingPurchase[]
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
  return guessShoppingCategory(item.name)
}

function purchaseOnList(
  purchase: ShoppingPurchase,
  listId: string,
  standardListIdValue: string,
  period: ShoppingPeriod,
): boolean {
  if (purchase.listId) return purchase.listId === listId
  return (
    listId === standardListIdValue && periodContainsDate(period, purchase.shoppingDate)
  )
}

function qualitativePurchaseIds(
  richItem: ShoppingListItem | null,
  listId: string,
  standardListIdValue: string,
  period: ShoppingPeriod,
): string[] {
  if (!richItem) return []
  return richItem.purchases
    .filter(
      (purchase) =>
        purchaseOnList(purchase, listId, standardListIdValue, period) &&
        (purchase.qualitative || purchase.amounts.length === 0),
    )
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

function buildRows(
  open: ShoppingOpenDemandResult,
  richItems: readonly ShoppingListItem[],
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
    const qualitativeIds = qualitativePurchaseIds(
      richItem,
      group.listId,
      open.standardListId,
      open.period,
    )
    const purchaseIds = Array.from(
      new Set([
        ...group.positions.flatMap((position) => position.purchaseIds),
        ...qualitativeIds,
      ]),
    )
    const unparsedAmounts = placement ? [...placement.unparsedAmounts] : []
    const missingQuantity = placement?.missingQuantity === true
    const hasUnquantified = unparsedAmounts.length > 0 || missingQuantity
    const hasPurchase =
      purchaseIds.length > 0 ||
      group.positions.some(
        (position) => position.purchasedLower > 0 || position.purchasedUpper > 0,
      )
    const status: ShoppingPageRow['status'] =
      openPositions.length > 0
        ? 'open'
        : hasUnquantified && !hasPurchase
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
      richItem,
      manualItem: null,
    })
  }

  for (const placement of open.automaticUnquantified) {
    const key = `${placement.listId}\u0000${placement.itemKey}`
    if (positionsByItem.has(key)) continue
    const richItem = richByKey.get(placement.itemKey) ?? null
    const qualitativeIds = qualitativePurchaseIds(
      richItem,
      placement.listId,
      open.standardListId,
      open.period,
    )
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
      status: qualitativeIds.length > 0 ? 'done' : 'open',
      purchaseIds: qualitativeIds,
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
      itemKey: shoppingItemKey(splitIngredientName(item.name).identityName) || item.name,
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
      warnings: [],
      requiresReview: true,
      serviceConflicts: [],
      conflictLabels: [],
      richItems: [],
      automaticPurchases: [],
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

  const rawRows = buildRows(openDemand, richList.items)
  const rowsByList: Record<string, ShoppingPageRow[]> = {}
  for (const [listId, rows] of Object.entries(rawRows)) {
    rowsByList[listId] = sortRows(rows, categoryOrder)
  }

  const summaryById = new Map(
    openDemand.lists.map((summary) => [summary.listId, summary]),
  )
  const lists: ShoppingPageList[] = [standardList, ...freeLists]
    .filter((list, index, all) => all.findIndex((entry) => entry.id === list.id) === index)
    .map((list) => {
      const rows = rowsByList[list.id] ?? []
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
        requiresReview: summaryById.get(list.id)?.requiresReview ?? false,
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
          return richByKey.get(conflict.itemKey)?.name ?? conflict.itemKey
        }),
        ...openDemand.conflicts.map((conflict) => {
          if (!conflict.itemKey) return ''
          return richByKey.get(conflict.itemKey)?.name ?? conflict.itemKey
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
    warnings: richList.warnings,
    requiresReview: openDemand.requiresReview,
    serviceConflicts: openDemand.serviceConflicts,
    conflictLabels,
    richItems: richList.items,
    automaticPurchases,
  }
}
