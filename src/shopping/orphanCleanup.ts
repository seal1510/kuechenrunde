/*
 * openCook Web
 * Copyright (C) 2026 openCook Web contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Application service for shopping cleanup during regular deletion flows. It
 * loads the existing data once, resolves the persisted shopping periods through
 * the shared period rules and delegates the actual decisions to the pure helper
 * in `deletionCleanup.ts`.
 *
 * The single exported function is used inside the deletion transactions of
 * planned dishes and recipes. There is no automatic cleanup at app start.
 */

import { db } from '../db'
import {
  resolveShoppingPeriodResolution,
  type ShoppingPeriod,
} from '../domain/shoppingLists'
import { shoppingSettingsFromRows, type ShoppingSettings } from '../settings/shopping'
import type {
  CookSession,
  FreeDish,
  Recipe,
  ShoppingDemandAllocation,
  ShoppingItemRule,
  ShoppingList,
  ShoppingPurchase,
  ShoppingQuantityCorrection,
} from '../types'
import {
  planDeletedSessionsShoppingCleanup,
  type ShoppingCleanupResult,
} from './deletionCleanup'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

interface CleanupSnapshot {
  settings: ShoppingSettings
  lists: ShoppingList[]
  recipes: Recipe[]
  freeDishes: FreeDish[]
  sessions: CookSession[]
  rules: ShoppingItemRule[]
  quantityCorrections: ShoppingQuantityCorrection[]
  purchases: ShoppingPurchase[]
  allocations: ShoppingDemandAllocation[]
}

async function loadSnapshot(): Promise<CleanupSnapshot> {
  const [
    settingsRows,
    lists,
    recipes,
    freeDishes,
    sessions,
    rules,
    quantityCorrections,
    purchases,
    allocations,
  ] = await Promise.all([
    db.settings.toArray(),
    db.shoppingLists.toArray(),
    db.recipes.toArray(),
    db.freeDishes.toArray(),
    db.cookSessions.toArray(),
    db.shoppingItemRules.toArray(),
    db.shoppingQuantityCorrections.toArray(),
    db.shoppingPurchases.toArray(),
    db.shoppingDemandAllocations.toArray(),
  ])
  return {
    settings: shoppingSettingsFromRows(settingsRows),
    lists,
    recipes,
    freeDishes,
    sessions,
    rules,
    quantityCorrections,
    purchases,
    allocations,
  }
}

function emptyResult(): ShoppingCleanupResult {
  return { affectedItemKeys: [], removedPurchaseIds: [], removedAllocationIds: [] }
}

/**
 * Compute the shopping rows that become orphaned when the given cooking events
 * are deleted. Already-cooked events are skipped because they never contributed
 * to the visible shopping demand.
 */
export async function planCleanupForDeletedSessions(
  deletedSessions: readonly CookSession[],
): Promise<ShoppingCleanupResult> {
  const active = deletedSessions.filter((session) => session.status !== 'cooked')
  if (active.length === 0) return emptyResult()

  const snapshot = await loadSnapshot()
  const deletedIds = new Set(deletedSessions.map((session) => session.id))
  const remainingSessions = snapshot.sessions.filter(
    (session) => !deletedIds.has(session.id),
  )

  const groups = new Map<
    string,
    { period: ShoppingPeriod; sessions: CookSession[] }
  >()
  for (const session of active) {
    if (!DATE_RE.test(session.date)) continue
    let resolution
    try {
      resolution = resolveShoppingPeriodResolution(
        session.date,
        snapshot.settings,
        snapshot.lists,
      )
    } catch {
      // Malformed persisted period data must not block the deletion itself.
      continue
    }
    // Overlapping persisted periods are already a visible conflict. Never guess
    // a period and risk deleting rows from the wrong list.
    if (resolution.conflict) continue
    const group = groups.get(resolution.period.start) ?? {
      period: resolution.period,
      sessions: [],
    }
    group.sessions.push(session)
    groups.set(resolution.period.start, group)
  }

  const affectedItemKeys = new Set<string>()
  const removedPurchaseIds = new Set<string>()
  const removedAllocationIds = new Set<string>()

  for (const { period, sessions } of groups.values()) {
    const planned = planDeletedSessionsShoppingCleanup({
      period,
      recipes: snapshot.recipes,
      freeDishes: snapshot.freeDishes,
      deletedSessions: sessions,
      remainingSessions,
      rules: snapshot.rules,
      quantityCorrections: snapshot.quantityCorrections,
      purchases: snapshot.purchases,
      allocations: snapshot.allocations,
    })
    for (const key of planned.affectedItemKeys) affectedItemKeys.add(key)
    for (const id of planned.removedPurchaseIds) removedPurchaseIds.add(id)
    for (const id of planned.removedAllocationIds) removedAllocationIds.add(id)
  }

  return {
    affectedItemKeys: Array.from(affectedItemKeys).sort(),
    removedPurchaseIds: Array.from(removedPurchaseIds).sort(),
    removedAllocationIds: Array.from(removedAllocationIds).sort(),
  }
}
