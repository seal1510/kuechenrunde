/*
 * openCook Web
 * Copyright (C) 2026 openCook Web contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Pure rules for the multi-list shopping model. The automatic recipe demand is
 * still derived once by `buildShoppingList`; this module only decides on which
 * shopping list each part of that demand appears. No React, Dexie or UI text
 * lives here.
 *
 * Amounts in persisted allocations are integer thousandths of the dimension's
 * base unit (g, ml, pieces). This keeps every split exact and independent from
 * binary floating point rounding.
 */

import type { ShoppingAllocationMode, ShoppingDemandAllocation, ShoppingList } from '../types'
import { addDays, dayNumber, formatWeekRange, startOfWeekOn } from './dates'
import type { ShoppingAmountPosition } from './shopping'
import type { ShoppingSettings } from '../settings/shopping'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export const STANDARD_SHOPPING_LIST_PREFIX = 'standard:'
export const AMOUNT_MILLI_FACTOR = 1000
/** Neutral product default; the user can rename it in the settings. */
export const DEFAULT_STANDARD_SHOPPING_LIST_NAME = 'Wocheneinkauf'

export interface ShoppingPeriod {
  /** First day of the period, "YYYY-MM-DD". */
  start: string
  /** Last day of the period, "YYYY-MM-DD". */
  end: string
  days: string[]
  label: string
  /** One-time shortened period created while the shopping weekday changes. */
  isTransition: boolean
}

/**
 * Regular seven-day period starting at [startDay] and containing [anchor].
 * `startDay` is 0 = Monday … 6 = Sunday and must come from the persisted
 * shopping settings; no weekday is special-cased here.
 */
export function shoppingPeriod(anchor: string, startDay: number): ShoppingPeriod {
  const start = startOfWeekOn(anchor, startDay)
  const days = Array.from({ length: 7 }, (_, index) => addDays(start, index))
  const end = days[6] ?? start
  return {
    start,
    end,
    days,
    label: formatWeekRange(start, end),
    isTransition: false,
  }
}

/**
 * Build a period from its persisted boundaries. This is the only safe way to
 * read a period that is already stored: its dates must never be recomputed
 * from a later configuration change.
 */
export function shoppingPeriodFromRange(
  start: string,
  end: string,
  isTransition = false,
): ShoppingPeriod {
  const last = dayNumber(end) >= dayNumber(start) ? end : start
  const days: string[] = []
  for (let index = 0; ; index += 1) {
    const day = addDays(start, index)
    days.push(day)
    if (day === last || index > 3660) break
  }
  return {
    start,
    end: last,
    days,
    label: formatWeekRange(start, last),
    isTransition,
  }
}

export function shoppingPeriodFromList(list: ShoppingList): ShoppingPeriod {
  const start = list.periodStart ?? list.periodEnd
  if (!start) {
    throw new Error('A standard shopping list has no persisted period.')
  }
  const end = list.periodEnd ?? addDays(start, 6)
  return shoppingPeriodFromRange(start, end, list.isTransition === true)
}

export function periodContainsDate(
  period: Pick<ShoppingPeriod, 'start' | 'end'>,
  date: string,
): boolean {
  if (!DATE_RE.test(period.start) || !DATE_RE.test(period.end) || !DATE_RE.test(date)) {
    return false
  }
  return dayNumber(date) >= dayNumber(period.start) && dayNumber(date) <= dayNumber(period.end)
}

/**
 * Resolve the period that a date/start belongs to, using persisted periods
 * first. Only when no persisted standard list covers the date is the current
 * configuration used to build a new regular period.
 */
export function resolveShoppingPeriodFromData(
  anchor: string,
  settings: Pick<ShoppingSettings, 'periodStartDay'>,
  lists: readonly ShoppingList[],
): ShoppingPeriod {
  const exact = lists.find(
    (list) => list.kind === 'standard' && list.periodStart === anchor,
  )
  if (exact) return shoppingPeriodFromList(exact)

  const containing = lists
    .filter(
      (list) =>
        list.kind === 'standard' &&
        list.periodStart !== null &&
        list.periodEnd !== null &&
        periodContainsDate({ start: list.periodStart, end: list.periodEnd }, anchor),
    )
    .sort((a, b) => (b.periodStart ?? '').localeCompare(a.periodStart ?? ''))
  const hit = containing[0]
  if (hit) return shoppingPeriodFromList(hit)

  return shoppingPeriod(anchor, settings.periodStartDay)
}

/** Stable, name-independent identity of the standard list for one period. */
export function standardShoppingListId(periodStart: string): string {
  return `${STANDARD_SHOPPING_LIST_PREFIX}${periodStart}`
}

export function isStandardShoppingListId(id: string): boolean {
  return id.startsWith(STANDARD_SHOPPING_LIST_PREFIX)
}

export function standardShoppingListName(baseName: string, period: ShoppingPeriod): string {
  const clean =
    baseName.replace(/\s+/g, ' ').trim() || DEFAULT_STANDARD_SHOPPING_LIST_NAME
  return `${clean} · ${period.label}`
}

export function standardShoppingListRecord(
  period: ShoppingPeriod,
  baseName: string,
  now = 0,
) {
  return {
    id: standardShoppingListId(period.start),
    kind: 'standard' as const,
    name: standardShoppingListName(baseName, period),
    periodStart: period.start,
    periodEnd: period.end,
    ...(period.isTransition ? { isTransition: true } : {}),
    createdAt: now,
    updatedAt: now,
  }
}


/** Deterministic allocation identity; repeated writes cannot duplicate rows. */
export function shoppingAllocationId(
  periodStart: string,
  itemKey: string,
  dimension: string,
  listId: string,
): string {
  return `${periodStart}|${itemKey}|${dimension}|${listId}`
}

export function toAmountMilli(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.round(value * AMOUNT_MILLI_FACTOR)
}

export function fromAmountMilli(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.round(value) / AMOUNT_MILLI_FACTOR
}

/* ------------------------------------------------------------------ */
/* Distribution of derived demand                                      */
/* ------------------------------------------------------------------ */

export interface ShoppingDemandItemInput {
  key: string
  name: string
  /** Numeric positions after week-scoped quantity corrections. */
  positions: readonly ShoppingAmountPosition[]
  unparsedAmounts: readonly string[]
  missingQuantity: boolean
}

export interface ShoppingDistributionInput {
  periodStart: string
  /** Persisted period boundaries. When omitted, a regular seven-day period is assumed. */
  period?: ShoppingPeriod
  standardListId?: string
  demand: readonly ShoppingDemandItemInput[]
  allocations: readonly ShoppingDemandAllocation[]
  /**
   * Existing list ids. When supplied, allocations referencing any other list
   * are reported and not applied. When omitted, all references are trusted
   * (useful for pure unit tests).
   */
  listIds?: readonly string[]
}

export interface ShoppingResolvedAllocation {
  allocation: ShoppingDemandAllocation
  listId: string
  /** Requested amount in milli-units; `null` for a completely moved position. */
  requestedMilli: number | null
  effectiveLower: number
  effectiveUpper: number
  /** The current demand was too small for the requested subset. */
  clamped: boolean
  /** The referenced item/dimension no longer exists in the current demand. */
  orphaned: boolean
  /** A full assignment of the same position takes precedence. */
  shadowed: boolean
  /** The allocation could not be applied at all (unknown list, invalid data). */
  blocked: boolean
}

export interface ShoppingDistributionAmount {
  listId: string
  lower: number
  upper: number
  /** True when at least one explicit user allocation produced this amount. */
  explicit: boolean
}

export interface ShoppingDistributionPosition {
  itemKey: string
  name: string
  dimension: string
  unit: string | null
  qualifier: string
  totalLower: number
  totalUpper: number
  /** Amount that stays on / returns to the period's standard list. */
  standardLower: number
  standardUpper: number
  amounts: ShoppingDistributionAmount[]
  allocations: ShoppingResolvedAllocation[]
}

export interface ShoppingUnquantifiedPlacement {
  itemKey: string
  name: string
  listId: string
  /** True when this is the default standard-list placement, not a full move. */
  standard: boolean
  explicit: boolean
  unparsedAmounts: string[]
  missingQuantity: boolean
}

export type ShoppingDistributionConflictCode =
  | 'over-allocated'
  | 'multiple-full-allocations'
  | 'allocation-shadowed'
  | 'orphaned-allocation'
  | 'unknown-list'
  | 'invalid-allocation'
  | 'ambiguous-range'

export interface ShoppingDistributionConflict {
  code: ShoppingDistributionConflictCode
  itemKey: string
  dimension: string | null
  listId: string | null
  requestedMilli?: number
  availableMilli?: number
}

export interface ShoppingDistributionResult {
  period: ShoppingPeriod
  standardListId: string
  positions: ShoppingDistributionPosition[]
  unquantified: ShoppingUnquantifiedPlacement[]
  itemListIds: Array<{ itemKey: string; listIds: string[] }>
  orphanedAllocations: ShoppingDemandAllocation[]
  conflicts: ShoppingDistributionConflict[]
  requiresReview: boolean
}

function compareAllocations(
  left: ShoppingDemandAllocation,
  right: ShoppingDemandAllocation,
): number {
  // Stable, database-order independent priority: oldest user decision first,
  // then the stable list id, then the deterministic allocation id.
  return (
    left.createdAt - right.createdAt ||
    left.listId.localeCompare(right.listId) ||
    left.id.localeCompare(right.id)
  )
}

function addAmount(
  amounts: Map<string, ShoppingDistributionAmount>,
  listId: string,
  lower: number,
  upper: number,
  explicit: boolean,
): void {
  if (lower <= 0 && upper <= 0) return
  const existing = amounts.get(listId)
  if (!existing) {
    amounts.set(listId, { listId, lower, upper, explicit })
    return
  }
  existing.lower = fromAmountMilli(toAmountMilli(existing.lower) + toAmountMilli(lower))
  existing.upper = fromAmountMilli(toAmountMilli(existing.upper) + toAmountMilli(upper))
  existing.explicit = existing.explicit || explicit
}

function sortAmounts(amounts: Map<string, ShoppingDistributionAmount>) {
  return Array.from(amounts.values()).sort((a, b) => a.listId.localeCompare(b.listId))
}

function blockedView(
  allocation: ShoppingDemandAllocation,
  requestedMilli: number | null,
  flags: Partial<Pick<ShoppingResolvedAllocation, 'clamped' | 'orphaned' | 'shadowed' | 'blocked'>>,
): ShoppingResolvedAllocation {
  return {
    allocation,
    listId: allocation.listId,
    requestedMilli,
    effectiveLower: 0,
    effectiveUpper: 0,
    clamped: flags.clamped === true,
    orphaned: flags.orphaned === true,
    shadowed: flags.shadowed === true,
    blocked: flags.blocked === true,
  }
}

/**
 * Resolve the current automatic demand against persisted allocations.
 *
 * Conflict handling when demand shrinks:
 * 1. The automatically remaining standard-list share is reduced to zero first; it is
 *    calculated as `total − effective user allocations`.
 * 2. If fixed subsets still exceed the demand, they are applied in the stable
 *    order `createdAt`, `listId`, `id` until the demand is exhausted. Later
 *    subsets become zero. The stored user decision is never deleted.
 * 3. A full assignment always keeps the complete position; multiple competing
 *    full assignments are resolved by the same stable order and reported.
 */
export function resolveShoppingDistribution(
  input: ShoppingDistributionInput,
): ShoppingDistributionResult {
  const period =
    input.period ??
    shoppingPeriodFromRange(input.periodStart, addDays(input.periodStart, 6))
  const standardListId = input.standardListId ?? standardShoppingListId(period.start)
  const knownLists =
    input.listIds === undefined
      ? null
      : new Set<string>([standardListId, ...input.listIds])
  const conflicts: ShoppingDistributionConflict[] = []
  const positions: ShoppingDistributionPosition[] = []
  const unquantified: ShoppingUnquantifiedPlacement[] = []
  const itemListIds = new Map<string, Set<string>>()
  const orphanedAllocations: ShoppingDemandAllocation[] = []

  const allocationsByItem = new Map<string, ShoppingDemandAllocation[]>()
  for (const allocation of input.allocations) {
    if (
      !allocation.id ||
      !allocation.periodStart ||
      !allocation.itemKey ||
      !allocation.dimension ||
      !allocation.listId
    ) {
      conflicts.push({
        code: 'invalid-allocation',
        itemKey: allocation.itemKey ?? '',
        dimension: allocation.dimension ?? null,
        listId: allocation.listId ?? null,
      })
      continue
    }
    if (allocation.periodStart !== period.start) continue
    const list = allocationsByItem.get(allocation.itemKey) ?? []
    list.push(allocation)
    allocationsByItem.set(allocation.itemKey, list)
  }

  const demandKeys = new Set(input.demand.map((item) => item.key))

  for (const item of input.demand) {
    const itemAllocations = (allocationsByItem.get(item.key) ?? []).slice()
    const usedAllocationIds = new Set<string>()
    const lists = new Set<string>()

    const unknownList = (allocation: ShoppingDemandAllocation): boolean => {
      if (knownLists === null) return false
      if (knownLists.has(allocation.listId)) return false
      conflicts.push({
        code: 'unknown-list',
        itemKey: item.key,
        dimension: allocation.dimension,
        listId: allocation.listId,
      })
      usedAllocationIds.add(allocation.id)
      return true
    }

    const fullItemAllocations = itemAllocations
      .filter((allocation) => allocation.dimension === '*')
      .sort(compareAllocations)

    const validFull: ShoppingDemandAllocation[] = []
    for (const allocation of fullItemAllocations) {
      if (allocation.mode !== 'full') {
        conflicts.push({
          code: 'invalid-allocation',
          itemKey: item.key,
          dimension: allocation.dimension,
          listId: allocation.listId,
        })
        usedAllocationIds.add(allocation.id)
        continue
      }
      if (unknownList(allocation)) {
        usedAllocationIds.add(allocation.id)
        continue
      }
      validFull.push(allocation)
    }
    if (validFull.length > 0) {
      if (validFull.length > 1) {
        conflicts.push({
          code: 'multiple-full-allocations',
          itemKey: item.key,
          dimension: '*',
          listId: null,
        })
      }
      const winner = validFull[0] ?? null
      const targetListId = winner?.listId ?? standardListId
      for (const allocation of itemAllocations) {
        if (allocation === winner) {
          usedAllocationIds.add(allocation.id)
          continue
        }
        if (usedAllocationIds.has(allocation.id)) continue
        usedAllocationIds.add(allocation.id)
        conflicts.push({
          code: 'allocation-shadowed',
          itemKey: item.key,
          dimension: allocation.dimension,
          listId: allocation.listId,
        })
      }

      const resolvedViews: ShoppingResolvedAllocation[] = []
      for (const allocation of itemAllocations) {
        if (allocation === winner) {
          const totalLower = item.positions.reduce((sum, position) => sum + position.lower, 0)
          const totalUpper = item.positions.reduce((sum, position) => sum + position.upper, 0)
          resolvedViews.push({
            allocation,
            listId: allocation.listId,
            requestedMilli: null,
            effectiveLower: totalLower,
            effectiveUpper: totalUpper,
            clamped: false,
            orphaned: false,
            shadowed: false,
            blocked: false,
          })
        } else {
          const unknown = knownLists !== null && !knownLists.has(allocation.listId)
          resolvedViews.push(
            blockedView(allocation, allocation.quantityMilli ?? null, {
              shadowed: true,
              blocked: unknown || allocation.mode !== 'full',
            }),
          )
        }
      }

      for (const position of item.positions) {
        const amounts = new Map<string, ShoppingDistributionAmount>()
        addAmount(amounts, targetListId, position.lower, position.upper, true)
        lists.add(targetListId)
        positions.push({
          itemKey: item.key,
          name: item.name,
          dimension: position.dimension,
          unit: position.unit,
          qualifier: position.qualifier,
          totalLower: position.lower,
          totalUpper: position.upper,
          standardLower: targetListId === standardListId ? position.lower : 0,
          standardUpper: targetListId === standardListId ? position.upper : 0,
          amounts: sortAmounts(amounts),
          allocations: resolvedViews.filter(
            (view) =>
              view.allocation.dimension === '*' || position.dimension === view.allocation.dimension,
          ),
        })
      }
      if (item.unparsedAmounts.length > 0 || item.missingQuantity) {
        unquantified.push({
          itemKey: item.key,
          name: item.name,
          listId: targetListId,
          standard: targetListId === standardListId,
          explicit: winner !== null,
          unparsedAmounts: [...item.unparsedAmounts],
          missingQuantity: item.missingQuantity,
        })
      }
      lists.add(targetListId)
      itemListIds.set(item.key, lists)
      continue
    }

    const dimensionAllocations = new Map<string, ShoppingDemandAllocation[]>()
    for (const allocation of itemAllocations) {
      if (allocation.dimension === '*') continue
      const list = dimensionAllocations.get(allocation.dimension) ?? []
      list.push(allocation)
      dimensionAllocations.set(allocation.dimension, list)
    }

    const positionsByDimension = new Map(item.positions.map((position) => [position.dimension, position]))
    for (const position of item.positions) {
      const matching = (dimensionAllocations.get(position.dimension) ?? []).slice()
      for (const allocation of matching) {
        if (allocation.mode !== 'partial' && allocation.mode !== 'full') {
          conflicts.push({
            code: 'invalid-allocation',
            itemKey: item.key,
            dimension: position.dimension,
            listId: allocation.listId,
          })
          usedAllocationIds.add(allocation.id)
        }
        if (unknownList(allocation)) usedAllocationIds.add(allocation.id)
      }
      const usable = matching.filter(
        (allocation) => !usedAllocationIds.has(allocation.id),
      )
      const fullAllocations = usable
        .filter((allocation) => allocation.mode === 'full')
        .sort(compareAllocations)
      const partialAllocations = usable
        .filter((allocation) => allocation.mode === 'partial')
        .sort(compareAllocations)

      const amounts = new Map<string, ShoppingDistributionAmount>()
      const views: ShoppingResolvedAllocation[] = []
      const exact = position.lower === position.upper
      const totalLower = position.lower
      const totalUpper = position.upper

      if (fullAllocations.length > 0) {
        const winner = fullAllocations[0]
        if (!winner) continue
        if (fullAllocations.length > 1) {
          conflicts.push({
            code: 'multiple-full-allocations',
            itemKey: item.key,
            dimension: position.dimension,
            listId: null,
          })
        }
        addAmount(amounts, winner.listId, totalLower, totalUpper, true)
        lists.add(winner.listId)
        views.push({
          allocation: winner,
          listId: winner.listId,
          requestedMilli: null,
          effectiveLower: totalLower,
          effectiveUpper: totalUpper,
          clamped: false,
          orphaned: false,
          shadowed: false,
          blocked: false,
        })
        for (const allocation of fullAllocations.slice(1)) {
          conflicts.push({
            code: 'allocation-shadowed',
            itemKey: item.key,
            dimension: position.dimension,
            listId: allocation.listId,
          })
          views.push(blockedView(allocation, null, { shadowed: true, blocked: true }))
        }
        for (const allocation of partialAllocations) {
          conflicts.push({
            code: 'allocation-shadowed',
            itemKey: item.key,
            dimension: position.dimension,
            listId: allocation.listId,
          })
          views.push(
            blockedView(allocation, allocation.quantityMilli ?? null, {
              shadowed: true,
              blocked: true,
            }),
          )
        }
        const standardLower = winner.listId === standardListId ? totalLower : 0
        const standardUpper = winner.listId === standardListId ? totalUpper : 0
        positions.push({
          itemKey: item.key,
          name: item.name,
          dimension: position.dimension,
          unit: position.unit,
          qualifier: position.qualifier,
          totalLower,
          totalUpper,
          standardLower,
          standardUpper,
          amounts: sortAmounts(amounts),
          allocations: views,
        })
        usedAllocationIds.add(winner.id)
        for (const allocation of fullAllocations.slice(1)) usedAllocationIds.add(allocation.id)
        for (const allocation of partialAllocations) usedAllocationIds.add(allocation.id)
        continue
      }

      if (!exact && partialAllocations.length > 0) {
        // A range must never be silently turned into one number. Keep the whole
        // range on the period's standard list and report the blocked decision.
        conflicts.push({
          code: 'ambiguous-range',
          itemKey: item.key,
          dimension: position.dimension,
          listId: null,
        })
        for (const allocation of partialAllocations) {
          views.push(
            blockedView(allocation, allocation.quantityMilli ?? null, { blocked: true }),
          )
          usedAllocationIds.add(allocation.id)
        }
        addAmount(amounts, standardListId, totalLower, totalUpper, false)
        lists.add(standardListId)
        positions.push({
          itemKey: item.key,
          name: item.name,
          dimension: position.dimension,
          unit: position.unit,
          qualifier: position.qualifier,
          totalLower,
          totalUpper,
          standardLower: totalLower,
          standardUpper: totalUpper,
          amounts: sortAmounts(amounts),
          allocations: views,
        })
        continue
      }

      const availableMilli = toAmountMilli(totalLower)
      let requestedTotalMilli = 0
      for (const allocation of partialAllocations) {
        requestedTotalMilli += Math.max(0, allocation.quantityMilli ?? 0)
      }
      const overAllocated = exact && requestedTotalMilli > availableMilli
      let remainingMilli = availableMilli
      for (const allocation of partialAllocations) {
        const requestedMilli = Math.max(0, allocation.quantityMilli ?? 0)
        const effectiveMilli = overAllocated
          ? Math.min(requestedMilli, remainingMilli)
          : requestedMilli
        if (overAllocated) remainingMilli -= effectiveMilli
        const effective = fromAmountMilli(effectiveMilli)
        const clamped = overAllocated && effectiveMilli < requestedMilli
        addAmount(amounts, allocation.listId, effective, effective, true)
        if (effective > 0) lists.add(allocation.listId)
        views.push({
          allocation,
          listId: allocation.listId,
          requestedMilli,
          effectiveLower: effective,
          effectiveUpper: effective,
          clamped,
          orphaned: false,
          shadowed: false,
          blocked: false,
        })
        usedAllocationIds.add(allocation.id)
      }
      if (overAllocated) {
        conflicts.push({
          code: 'over-allocated',
          itemKey: item.key,
          dimension: position.dimension,
          listId: null,
          requestedMilli: requestedTotalMilli,
          availableMilli,
        })
      }
      const assignedMilli = fromAmountMilli(
        Array.from(amounts.values()).reduce(
          (sum, amount) => sum + toAmountMilli(amount.lower),
          0,
        ),
      )
      const remainderLower = Math.max(0, fromAmountMilli(toAmountMilli(totalLower) - toAmountMilli(assignedMilli)))
      const remainderUpper = Math.max(0, totalUpper - assignedMilli)
      addAmount(amounts, standardListId, remainderLower, remainderUpper, false)
      if (remainderLower > 0 || remainderUpper > 0) lists.add(standardListId)
      const standardAmount = amounts.get(standardListId)
      positions.push({
        itemKey: item.key,
        name: item.name,
        dimension: position.dimension,
        unit: position.unit,
        qualifier: position.qualifier,
        totalLower,
        totalUpper,
        standardLower: standardAmount?.lower ?? 0,
        standardUpper: standardAmount?.upper ?? 0,
        amounts: sortAmounts(amounts),
        allocations: views,
      })
    }

    // Allocations for dimensions that no longer exist are retained but never
    // turned into artificial demand.
    for (const allocation of itemAllocations) {
      if (usedAllocationIds.has(allocation.id)) continue
      if (allocation.dimension === '*') continue
      if (positionsByDimension.has(allocation.dimension)) continue
      conflicts.push({
        code: 'orphaned-allocation',
        itemKey: item.key,
        dimension: allocation.dimension,
        listId: allocation.listId,
      })
      orphanedAllocations.push(allocation)
    }

    if (item.unparsedAmounts.length > 0 || item.missingQuantity) {
      unquantified.push({
        itemKey: item.key,
        name: item.name,
        listId: standardListId,
        standard: true,
        explicit: false,
        unparsedAmounts: [...item.unparsedAmounts],
        missingQuantity: item.missingQuantity,
      })
      lists.add(standardListId)
    }
    itemListIds.set(item.key, lists)
  }

  for (const [itemKey, allocations] of allocationsByItem) {
    if (demandKeys.has(itemKey)) continue
    for (const allocation of allocations) {
      conflicts.push({
        code: 'orphaned-allocation',
        itemKey,
        dimension: allocation.dimension,
        listId: allocation.listId,
      })
      orphanedAllocations.push(allocation)
    }
  }

  positions.sort(
    (a, b) =>
      a.itemKey.localeCompare(b.itemKey) ||
      a.dimension.localeCompare(b.dimension) ||
      a.name.localeCompare(b.name, 'de'),
  )

  const reviewCodes = new Set<ShoppingDistributionConflictCode>([
    'over-allocated',
    'multiple-full-allocations',
    'orphaned-allocation',
    'unknown-list',
    'invalid-allocation',
    'ambiguous-range',
  ])

  return {
    period,
    standardListId,
    positions,
    unquantified,
    itemListIds: Array.from(itemListIds, ([itemKey, listIds]) => ({
      itemKey,
      listIds: Array.from(listIds).sort(),
    })).sort((a, b) => a.itemKey.localeCompare(b.itemKey)),
    orphanedAllocations,
    conflicts,
    requiresReview: conflicts.some((conflict) => reviewCodes.has(conflict.code)),
  }
}

/* ------------------------------------------------------------------ */
/* Purchases and open amounts per list                                 */
/* ------------------------------------------------------------------ */

export interface ShoppingPurchaseContribution {
  id: string
  listId: string
  itemKey: string
  /** `null` for a qualitative "done" purchase without a numeric amount. */
  dimension: string | null
  lower: number
  upper: number
  qualitative: boolean
}

export interface ShoppingOpenPosition {
  listId: string
  itemKey: string
  name: string
  dimension: string
  unit: string | null
  assignedLower: number
  assignedUpper: number
  purchasedLower: number
  purchasedUpper: number
  openLower: number
  openUpper: number
  done: boolean
}

export type ShoppingUnmatchedPurchaseReason = 'no-demand' | 'non-numeric'

export interface ShoppingUnmatchedPurchase {
  purchaseId: string
  listId: string
  itemKey: string
  dimension: string | null
  lower: number
  upper: number
  qualitative: boolean
  reason: ShoppingUnmatchedPurchaseReason
}

export interface ShoppingOpenResult {
  positions: ShoppingOpenPosition[]
  unmatchedPurchases: ShoppingUnmatchedPurchase[]
}

function purchaseKey(listId: string, itemKey: string, dimension: string): string {
  return `${listId}\u0000${itemKey}\u0000${dimension}`
}

/**
 * Subtract purchases per list exactly once. Purchases stay on the list where
 * they were recorded; a moved allocation never silently moves a purchase.
 */
export function resolveOpenShoppingAmounts(
  distribution: Pick<ShoppingDistributionResult, 'positions'>,
  purchases: readonly ShoppingPurchaseContribution[],
): ShoppingOpenResult {
  const purchased = new Map<string, { lower: number; upper: number }>()
  for (const purchase of purchases) {
    if (!purchase.dimension) continue
    const key = purchaseKey(purchase.listId, purchase.itemKey, purchase.dimension)
    const existing = purchased.get(key) ?? { lower: 0, upper: 0 }
    existing.lower = fromAmountMilli(
      toAmountMilli(existing.lower) + toAmountMilli(Math.max(0, purchase.lower)),
    )
    existing.upper = fromAmountMilli(
      toAmountMilli(existing.upper) + toAmountMilli(Math.max(0, purchase.upper)),
    )
    purchased.set(key, existing)
  }

  const matched = new Set<string>()
  const positions: ShoppingOpenPosition[] = []
  for (const position of distribution.positions) {
    for (const amount of position.amounts) {
      if (amount.lower <= 0 && amount.upper <= 0) continue
      const key = purchaseKey(amount.listId, position.itemKey, position.dimension)
      matched.add(key)
      const bought = purchased.get(key) ?? { lower: 0, upper: 0 }
      const openLower = Math.max(
        0,
        fromAmountMilli(toAmountMilli(amount.lower) - toAmountMilli(bought.lower)),
      )
      const openUpper = Math.max(
        0,
        fromAmountMilli(toAmountMilli(amount.upper) - toAmountMilli(bought.upper)),
      )
      positions.push({
        listId: amount.listId,
        itemKey: position.itemKey,
        name: position.name,
        dimension: position.dimension,
        unit: position.unit,
        assignedLower: amount.lower,
        assignedUpper: amount.upper,
        purchasedLower: bought.lower,
        purchasedUpper: bought.upper,
        openLower,
        openUpper,
        done: openLower === 0 && openUpper === 0,
      })
    }
  }

  const unmatchedPurchases: ShoppingUnmatchedPurchase[] = []
  for (const purchase of purchases) {
    if (!purchase.dimension) {
      unmatchedPurchases.push({
        purchaseId: purchase.id,
        listId: purchase.listId,
        itemKey: purchase.itemKey,
        dimension: null,
        lower: purchase.lower,
        upper: purchase.upper,
        qualitative: purchase.qualitative,
        reason: 'non-numeric',
      })
      continue
    }
    const key = purchaseKey(purchase.listId, purchase.itemKey, purchase.dimension)
    if (matched.has(key)) continue
    unmatchedPurchases.push({
      purchaseId: purchase.id,
      listId: purchase.listId,
      itemKey: purchase.itemKey,
      dimension: purchase.dimension,
      lower: purchase.lower,
      upper: purchase.upper,
      qualitative: purchase.qualitative,
      reason: 'no-demand',
    })
  }

  return { positions, unmatchedPurchases }
}

/** Open amount for one assigned quantity, clamped at zero. */
export function openAmount(
  assigned: { lower: number; upper: number },
  purchased: { lower: number; upper: number },
): { lower: number; upper: number } {
  return {
    lower: Math.max(
      0,
      fromAmountMilli(toAmountMilli(assigned.lower) - toAmountMilli(purchased.lower)),
    ),
    upper: Math.max(
      0,
      fromAmountMilli(toAmountMilli(assigned.upper) - toAmountMilli(purchased.upper)),
    ),
  }
}

export function allocationModeOf(allocation: ShoppingDemandAllocation): ShoppingAllocationMode {
  return allocation.mode
}
