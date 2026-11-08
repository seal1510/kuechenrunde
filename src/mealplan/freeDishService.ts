/*
 * openCook Web
 * Copyright (C) 2026 openCook Web contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Plan-only dishes. A free dish is stored once in `freeDishes`; its name,
 * reference portions and ingredients are shared by every linked meal
 * appointment through one common cooking event. It never becomes a recipe.
 */

import { db } from '../db'
import { buildIngredientList, type IngredientDraftInput } from '../recipe/editor'
import { randomId } from '../lib/id'
import type { CookSessionStatus, FreeDish } from '../types'
import {
  persistDishPlan,
  type SaveDishPlanDay,
  type SaveDishPlanResult,
} from './dishService'
import { MealPlanError } from './service'

export interface SaveFreeDishPlanInput {
  /** Existing cooking event when the dish is edited. */
  cookSessionId?: string | null
  /** Existing free dish when the dish is edited. */
  freeDishId?: string | null
  name: string
  days: SaveDishPlanDay[]
  /** Portions the entered ingredient quantities refer to. */
  referenceServings: number
  ingredients: readonly IngredientDraftInput[]
  allowCookedChange?: boolean
  cookStatus?: CookSessionStatus
}

export interface SaveFreeDishPlanResult extends SaveDishPlanResult {
  freeDish: FreeDish
}

export function normalizeFreeDishName(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

export function normalizeFreeDishReferenceServings(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new MealPlanError('Bitte eine Portionszahl größer als 0 für die Zutaten angeben.')
  }
  const rounded = Math.round(value * 10) / 10
  if (rounded <= 0) {
    throw new MealPlanError('Bitte eine Portionszahl größer als 0 für die Zutaten angeben.')
  }
  return rounded
}

/**
 * Create or update a free dish and all of its eat days. The reference portion
 * count is taken verbatim from the caller and is never derived from the
 * current day selection, so editing days cannot silently rescale stored
 * ingredient quantities.
 */
export async function saveFreeDishPlan(
  input: SaveFreeDishPlanInput,
): Promise<SaveFreeDishPlanResult> {
  const name = normalizeFreeDishName(input.name)
  if (!name) throw new MealPlanError('Bitte einen Namen für das Gericht angeben.')
  const referenceServings = normalizeFreeDishReferenceServings(input.referenceServings)
  if (input.cookSessionId && !input.freeDishId) {
    throw new MealPlanError('Dieses Gericht existiert nicht mehr.')
  }

  const freeDishId = input.freeDishId?.trim() || `free-${randomId()}`
  let written: FreeDish | null = null

  const result = await persistDishPlan({
    identity: { kind: 'free', recipeId: null, freeDishId },
    days: input.days,
    cookSessionId: input.cookSessionId,
    cookStatus: input.cookStatus,
    allowCookedChange: input.allowCookedChange,
    prepare: async (nowValue) => {
      const existing = await db.freeDishes.get(freeDishId)
      if (input.freeDishId && !existing) {
        throw new MealPlanError('Dieses freie Gericht existiert nicht mehr.')
      }
      const freeDish: FreeDish = {
        id: freeDishId,
        name,
        referenceServings,
        ingredients: buildIngredientList(
          input.ingredients,
          existing?.ingredients ?? [],
        ),
        createdAt: existing?.createdAt ?? nowValue,
        updatedAt: nowValue,
      }
      await db.freeDishes.put(freeDish)
      written = freeDish
    },
  })

  if (!written) throw new MealPlanError('Das freie Gericht konnte nicht gespeichert werden.')
  return { ...result, freeDish: written }
}

/** Read the stored snapshot for the editing dialog. */
export async function getFreeDish(id: string): Promise<FreeDish | undefined> {
  return db.freeDishes.get(id)
}
