/*
 * Küchenrunde – schmaler Rezept-Datenpfad über Supabase
 * Copyright (C) 2026 openCook Web contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Dies ist der vertikale Pfad für Etappe A1: Lesen und Speichern genau einer
 * Entität über den CloudRecordsStore. Er ist noch NICHT an Seiten, Services
 * oder src/db.ts angeschlossen. Die vorhandene lokale App bleibt unverändert.
 *
 * IDs bleiben unverändert; `rev` ist die serverseitige Revisionsnummer für
 * Compare-and-Swap und gehört nicht zum fachlichen Recipe-Objekt.
 */

import type { Recipe } from '../types'
import { CloudDataError } from './cloudErrors'
import { CloudRecordsStore } from './cloudRecords'

export const RECIPES_COLLECTION = 'recipes'

export interface LoadedRecipe {
  recipe: Recipe
  rev: number
}

function assertRecipe(recipe: Recipe): void {
  if (!recipe || typeof recipe !== 'object') {
    throw new CloudDataError('Ungültiges Rezept.')
  }
  if (typeof recipe.id !== 'string' || !recipe.id.trim()) {
    throw new CloudDataError('Das Rezept hat keine gültige ID.')
  }
  if (typeof recipe.importId !== 'string' || !recipe.importId.trim()) {
    throw new CloudDataError('Das Rezept hat keine gültige importId.')
  }
}

export class CloudRecipeRepository {
  constructor(private readonly records: CloudRecordsStore) {}

  /** Liest aus dem geladenen Snapshot. Der Store muss zuvor geladen sein. */
  async load(id: string): Promise<LoadedRecipe | null> {
    const row = this.records.get<Recipe>(RECIPES_COLLECTION, id)
    return row ? { recipe: row.data, rev: row.rev } : null
  }

  list(): Recipe[] {
    return this.records.list<Recipe>(RECIPES_COLLECTION).map((row) => row.data)
  }

  async create(recipe: Recipe): Promise<LoadedRecipe> {
    assertRecipe(recipe)
    const row = await this.records.create(RECIPES_COLLECTION, recipe.id, recipe)
    return { recipe: row.data, rev: row.rev }
  }

  async update(recipe: Recipe, expectedRev: number): Promise<LoadedRecipe> {
    assertRecipe(recipe)
    const row = await this.records.update(
      RECIPES_COLLECTION,
      recipe.id,
      recipe,
      expectedRev,
    )
    return { recipe: row.data, rev: row.rev }
  }

  async remove(id: string, expectedRev: number): Promise<void> {
    await this.records.remove(RECIPES_COLLECTION, id, expectedRev)
  }

  subscribe(listener: () => void): () => void {
    return this.records.subscribe(listener)
  }
}
