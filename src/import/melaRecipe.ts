/*
 * Küchenrunde – reine Abbildung eines geparsten Mela-Rezepts
 * Copyright (C) 2026 openCook Web contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Dieser Modul enthält keinen Datenbankzugriff. Der lokale Importer und der
 * Cloud-Importer erzeugen damit exakt dasselbe Recipe-Objekt; nur die
 * Persistenz unterscheidet sich.
 */

import { randomId } from '../lib/id'
import type { ParsedMelaRecipe, Recipe } from '../types'

export function recipeFromParsedMela(
  parsed: ParsedMelaRecipe,
  recipeId: string = randomId(),
  now: number = Date.now(),
): Recipe {
  return {
    id: recipeId,
    importId: parsed.importId,
    importSource: 'mela',
    title: parsed.title,
    description: parsed.description,
    ingredientGroups: parsed.ingredientGroups,
    ingredients: parsed.ingredients,
    instructions: parsed.instructions,
    servingsText: parsed.servingsText,
    servingsNumber: parsed.servingsNumber,
    prepTime: parsed.prepTime,
    cookTime: parsed.cookTime,
    totalTime: parsed.totalTime,
    categories: parsed.categories,
    cuisine: [],
    dishType: [],
    effort: '',
    tags: [],
    notes: parsed.notes,
    nutrition: parsed.nutrition,
    sourceUrl: parsed.sourceUrl,
    favorite: parsed.favorite,
    wantToCook: parsed.wantToCook,
    melaDate: parsed.melaDate,
    raw: parsed.raw,
    createdAt: now,
    updatedAt: now,
  }
}
