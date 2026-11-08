/*
 * openCook Web
 * Copyright (C) 2026 openCook Web contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Pure dish identity and ingredient-demand rules shared by library recipes
 * and plan-only free dishes. Both types expose the same scaling interface, so
 * the future shopping list can treat one cooking event exactly once. No React
 * or Dexie imports.
 */

import type { CookSession, DishKind, FreeDish, MealPlanEntry, Recipe } from '../types'
import {
  resolveOriginalServings,
  scaleRecipeIngredients,
  type RecipeScaleResult,
} from './scaling'

export type DishIdentity =
  | { kind: 'recipe'; recipeId: string }
  | { kind: 'free'; freeDishId: string }

/** Identity of a meal appointment or cooking event. */
export function dishIdentityFor(source: {
  recipeId?: string | null
  freeDishId?: string | null
}): DishIdentity | null {
  if (source.freeDishId) return { kind: 'free', freeDishId: source.freeDishId }
  if (source.recipeId) return { kind: 'recipe', recipeId: source.recipeId }
  return null
}

export function dishKindFor(source: {
  recipeId?: string | null
  freeDishId?: string | null
}): DishKind | null {
  return dishIdentityFor(source)?.kind ?? null
}

/** True when a cooking event and a meal appointment belong to the same dish. */
export function sessionMatchesEntry(
  session: Pick<CookSession, 'recipeId' | 'freeDishId'>,
  entry: Pick<MealPlanEntry, 'recipeId' | 'freeDishId'>,
): boolean {
  const sessionIdentity = dishIdentityFor(session)
  const entryIdentity = dishIdentityFor(entry)
  if (!sessionIdentity || !entryIdentity) return false
  if (sessionIdentity.kind !== entryIdentity.kind) return false
  return sessionIdentity.kind === 'free'
    ? entryIdentity.kind === 'free' &&
        sessionIdentity.freeDishId === entryIdentity.freeDishId
    : entryIdentity.kind === 'recipe' && sessionIdentity.recipeId === entryIdentity.recipeId
}

export type DishSource =
  | { kind: 'recipe'; recipe: Recipe }
  | { kind: 'free'; freeDish: FreeDish }

export function dishSourceName(source: DishSource): string {
  return source.kind === 'free' ? source.freeDish.name : source.recipe.title
}

/** Portions the stored ingredient quantities refer to. */
export function dishReferenceServings(source: DishSource): number | null {
  if (source.kind === 'free') {
    const value = source.freeDish.referenceServings
    return Number.isFinite(value) && value > 0 ? value : null
  }
  return resolveOriginalServings(source.recipe)
}

export function dishIngredientsFor(source: DishSource) {
  return source.kind === 'free' ? source.freeDish.ingredients : source.recipe.ingredients
}

/**
 * Scale one dish to the total cooking portions of its cooking event. The
 * stored reference quantities are never modified; this is a display/demand
 * calculation only.
 */
export function scaleDishIngredients(
  source: DishSource,
  cookServings: number,
): RecipeScaleResult {
  return scaleRecipeIngredients(
    dishIngredientsFor(source),
    dishReferenceServings(source),
    cookServings,
  )
}

/**
 * Shopping-relevant view: amount, unit, name and the purchase note only.
 * Preparation notes deliberately never appear here.
 */
export interface DishShoppingNeed {
  name: string
  unit: string | null
  quantityText: string | null
  purchaseNote: string
}

/**
 * Ingredients for exactly one cooking event. Calling this once per
 * `CookSession` (instead of once per linked meal appointment) guarantees that
 * multiple eat days do not duplicate demand.
 */
export function dishShoppingNeeds(
  source: DishSource,
  session: Pick<CookSession, 'servings'>,
): { scaling: RecipeScaleResult; needs: DishShoppingNeed[] } {
  const scaling = scaleDishIngredients(source, session.servings)
  const needs = scaling.items
    .filter((item) => item.ingredient.name.trim().length > 0)
    .map((item) => ({
      name: item.ingredient.name.trim(),
      unit: item.ingredient.unit?.trim() || null,
      quantityText: item.quantityText,
      purchaseNote: item.ingredient.purchaseNote?.trim() ?? '',
    }))
  return { scaling, needs }
}
