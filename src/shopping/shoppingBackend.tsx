/*
 * Küchenrunde – gemeinsame Datenschnittstelle der Einkaufsliste
 * Copyright (C) 2026 openCook Web contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Die bestehende Einkaufsliste und ihre Dialoge sprechen ausschließlich über
 * diese Schnittstelle mit der Persistenz. Im lokalen Modus werden unverändert
 * die vorhandenen Dexie-Services aufgerufen. Der Cloud-Modus liefert dieselbe
 * Schnittstelle über den CloudRecordsStore.
 *
 * Die Fachlogik (Bedarfsberechnung, Zutatenidentität, Käufe, Verteilungen)
 * bleibt in den vorhandenen Domain- und Service-Modulen. Hier wird nur die
 * Persistenz ausgetauscht.
 */

import { createContext, useContext, useMemo } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db'
import type { ShoppingCategoryId } from '../domain/shopping'
import { applyShoppingSettings } from '../shopping/cycle'
import type { ShoppingSettings } from '../settings/shopping'
import {
  deleteFreeShoppingList,
  ensureStandardShoppingList,
  createFreeShoppingList,
  renameShoppingList,
  createManualListItem,
  updateManualListItem,
  removeManualListItem,
  setManualItemPurchased,
  moveShoppingItem,
  assignShoppingSubquantity,
  removeShoppingAllocation,
  resetShoppingAllocations,
  type AssignShoppingSubquantityInput,
  type AssignShoppingSubquantityResult,
  type CreateManualListItemInput,
  type CreateShoppingListInput,
  type DeleteFreeShoppingListOptions,
  type DeleteFreeShoppingListResult,
  type MoveShoppingItemInput,
  type MoveShoppingItemResult,
  type ResetShoppingAllocationsInput,
  type UpdateManualListItemPatch,
} from '../shopping/listService'
import {
  addShoppingPurchase,
  clearLegacyQuantity,
  mergeShoppingProducts,
  removeQuantityCorrection,
  removeShoppingPurchase,
  resolveAmbiguousRule,
  restoreManualItem,
  saveCategoryOrder,
  saveItemRule,
  saveQuantityCorrection,
  splitShoppingProduct,
  type ItemRuleInput,
  type PurchaseInput,
  type QuantityCorrectionInput,
} from '../shopping/service'
import type {
  CookSession,
  FreeDish,
  Recipe,
  SettingRecord,
  ShoppingDemandAllocation,
  ShoppingItemRule,
  ShoppingList,
  ShoppingManualItem,
  ShoppingPurchase,
  ShoppingQuantityCorrection,
} from '../types'

/** All records the shopping surface renders, loaded as one consistent view. */
export interface ShoppingData {
  recipes: Recipe[]
  freeDishes: FreeDish[]
  cookSessions: CookSession[]
  manualItems: ShoppingManualItem[]
  purchases: ShoppingPurchase[]
  rules: ShoppingItemRule[]
  quantityCorrections: ShoppingQuantityCorrection[]
  settings: SettingRecord[]
  shoppingLists: ShoppingList[]
  allocations: ShoppingDemandAllocation[]
}

export interface ShoppingBackend {
  useShoppingData(): ShoppingData | undefined
  ensureStandardShoppingList(anchor: string): Promise<ShoppingList>
  createFreeShoppingList(
    input: CreateShoppingListInput | string,
  ): Promise<ShoppingList>
  renameShoppingList(id: string, name: string): Promise<ShoppingList>
  deleteFreeShoppingList(
    id: string,
    options?: DeleteFreeShoppingListOptions,
  ): Promise<DeleteFreeShoppingListResult>
  createManualListItem(
    input: CreateManualListItemInput,
  ): Promise<ShoppingManualItem>
  updateManualListItem(
    id: string,
    patch: UpdateManualListItemPatch,
  ): Promise<ShoppingManualItem>
  /** Removes one manual article and returns exactly the purchases removed with it. */
  removeManualListItemWithPurchases(id: string): Promise<ShoppingPurchase[]>
  setManualItemPurchased(
    id: string,
    purchased: boolean,
  ): Promise<{ item: ShoppingManualItem; purchases: ShoppingPurchase[] }>
  restoreManualItem(
    item: ShoppingManualItem,
    purchases: readonly ShoppingPurchase[],
  ): Promise<void>
  addShoppingPurchase(input: PurchaseInput): Promise<ShoppingPurchase>
  removeShoppingPurchase(id: string): Promise<void>
  /** Removes several purchase events in one atomic write. */
  removeShoppingPurchases(ids: readonly string[]): Promise<void>
  moveShoppingItem(input: MoveShoppingItemInput): Promise<MoveShoppingItemResult>
  assignShoppingSubquantity(
    input: AssignShoppingSubquantityInput,
  ): Promise<AssignShoppingSubquantityResult>
  removeShoppingAllocation(id: string): Promise<void>
  /** Removes several allocations in one atomic write. */
  removeShoppingAllocations(ids: readonly string[]): Promise<void>
  resetShoppingAllocations(input: ResetShoppingAllocationsInput): Promise<number>
  saveCategoryOrder(
    order: readonly ShoppingCategoryId[],
  ): Promise<ShoppingCategoryId[]>
  saveItemRule(key: string, patch: ItemRuleInput): Promise<ShoppingItemRule | null>
  saveQuantityCorrection(
    input: QuantityCorrectionInput,
  ): Promise<ShoppingQuantityCorrection>
  removeQuantityCorrection(id: string): Promise<void>
  clearLegacyQuantity(key: string): Promise<void>
  resolveAmbiguousRule(ruleKey: string, targetKey: string): Promise<void>
  mergeShoppingProducts(sourceKey: string, targetKey: string): Promise<string>
  splitShoppingProduct(aliasKey: string): Promise<void>
  applyShoppingSettings(
    patch: Partial<ShoppingSettings>,
    today?: string,
  ): Promise<ShoppingSettings>
}

/** Local adapter: delegates one-to-one to the unchanged Dexie services. */
export const localShoppingBackend: ShoppingBackend = {
  useShoppingData() {
    // Query order is the existing page contract (and its tests):
    // recipes, free dishes, sessions, manual items, purchases, rules,
    // corrections, settings, lists, allocations.
    const recipes = useLiveQuery(() => db.recipes.toArray(), [])
    const freeDishes = useLiveQuery(() => db.freeDishes.toArray(), [])
    const cookSessions = useLiveQuery(() => db.cookSessions.toArray(), [])
    const manualItems = useLiveQuery(() => db.shoppingManualItems.toArray(), [])
    const purchases = useLiveQuery(() => db.shoppingPurchases.toArray(), [])
    const rules = useLiveQuery(() => db.shoppingItemRules.toArray(), [])
    const quantityCorrections = useLiveQuery(
      () => db.shoppingQuantityCorrections.toArray(),
      [],
    )
    const settings = useLiveQuery(() => db.settings.toArray(), [])
    const shoppingLists = useLiveQuery(() => db.shoppingLists.toArray(), [])
    const allocations = useLiveQuery(
      () => db.shoppingDemandAllocations.toArray(),
      [],
    )

    return useMemo(() => {
      if (
        recipes === undefined ||
        freeDishes === undefined ||
        cookSessions === undefined ||
        manualItems === undefined ||
        purchases === undefined ||
        rules === undefined ||
        quantityCorrections === undefined ||
        settings === undefined ||
        shoppingLists === undefined ||
        allocations === undefined
      ) {
        return undefined
      }
      return {
        recipes,
        freeDishes,
        cookSessions,
        manualItems,
        purchases,
        rules,
        quantityCorrections,
        settings,
        shoppingLists,
        allocations,
      }
    }, [
      recipes,
      freeDishes,
      cookSessions,
      manualItems,
      purchases,
      rules,
      quantityCorrections,
      settings,
      shoppingLists,
      allocations,
    ])
  },

  ensureStandardShoppingList: (anchor) => ensureStandardShoppingList(anchor),
  createFreeShoppingList: (input) => createFreeShoppingList(input),
  renameShoppingList: (id, name) => renameShoppingList(id, name),
  deleteFreeShoppingList: (id, options) => deleteFreeShoppingList(id, options),
  createManualListItem: (input) => createManualListItem(input),
  updateManualListItem: (id, patch) => updateManualListItem(id, patch),
  removeManualListItemWithPurchases: async (id) => {
    const before = await db.shoppingPurchases.toArray()
    await removeManualListItem(id)
    const after = new Set(
      (await db.shoppingPurchases.toArray()).map((purchase) => purchase.id),
    )
    return before.filter((purchase) => !after.has(purchase.id))
  },
  setManualItemPurchased: (id, purchased) =>
    setManualItemPurchased(id, purchased),
  restoreManualItem: (item, purchases) => restoreManualItem(item, purchases),
  addShoppingPurchase: (input) => addShoppingPurchase(input),
  removeShoppingPurchase: (id) => removeShoppingPurchase(id),
  removeShoppingPurchases: async (ids) => {
    await db.transaction('rw', db.shoppingPurchases, async () => {
      for (const id of ids) await db.shoppingPurchases.delete(id)
    })
  },
  moveShoppingItem: (input) => moveShoppingItem(input),
  assignShoppingSubquantity: (input) => assignShoppingSubquantity(input),
  removeShoppingAllocation: (id) => removeShoppingAllocation(id),
  removeShoppingAllocations: async (ids) => {
    // The existing single-row service also re-targets affected purchases.
    for (const id of ids) await removeShoppingAllocation(id)
  },
  resetShoppingAllocations: (input) => resetShoppingAllocations(input),
  saveCategoryOrder: (order) => saveCategoryOrder(order),
  saveItemRule: (key, patch) => saveItemRule(key, patch),
  saveQuantityCorrection: (input) => saveQuantityCorrection(input),
  removeQuantityCorrection: (id) => removeQuantityCorrection(id),
  clearLegacyQuantity: (key) => clearLegacyQuantity(key),
  resolveAmbiguousRule: (ruleKey, targetKey) =>
    resolveAmbiguousRule(ruleKey, targetKey),
  mergeShoppingProducts: (sourceKey, targetKey) =>
    mergeShoppingProducts(sourceKey, targetKey),
  splitShoppingProduct: (aliasKey) => splitShoppingProduct(aliasKey),
  applyShoppingSettings: (patch, today) => applyShoppingSettings(patch, today),
}

const ShoppingBackendContext = createContext<ShoppingBackend>(
  localShoppingBackend,
)

export const ShoppingBackendProvider = ShoppingBackendContext.Provider

export function useShoppingBackend(): ShoppingBackend {
  return useContext(ShoppingBackendContext)
}
