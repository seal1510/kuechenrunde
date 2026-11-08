import { db } from '../db'
import { randomId } from '../lib/id'
import type {
  ImportProgress,
  ImportResult,
  ParsedMelaRecipe,
  Recipe,
  RecipeImage,
} from '../types'

/** Existing Mela import ids, used for the duplicate badge in the preview. */
export async function existingImportIds(ids: string[]): Promise<Set<string>> {
  const unique = Array.from(new Set(ids.filter(Boolean)))
  const found = new Set<string>()
  for (let offset = 0; offset < unique.length; offset += 500) {
    const chunk = unique.slice(offset, offset + 500)
    if (chunk.length === 0) continue
    const rows = await db.recipes.where('importId').anyOf(chunk).toArray()
    for (const row of rows) found.add(row.importId)
  }
  return found
}

/**
 * Write parsed recipes and their images. Idempotent by Mela import id: the unique
 * index plus an explicit check means importing the same file twice only adds the
 * first copy.
 */
export async function importMelaRecipes(
  recipes: ParsedMelaRecipe[],
  onProgress?: (progress: ImportProgress) => void,
): Promise<ImportResult> {
  const result: ImportResult = {
    imported: 0,
    duplicates: 0,
    failed: [],
    warnings: [],
    images: 0,
  }

  for (let index = 0; index < recipes.length; index += 1) {
    const parsed = recipes[index]
    if (!parsed) continue
    onProgress?.({ current: index + 1, total: recipes.length, title: parsed.title })

    const existing = await db.recipes.where('importId').equals(parsed.importId).first()
    if (existing) {
      result.duplicates += 1
      continue
    }

    const now = Date.now()
    const recipeId = randomId()
    const images: RecipeImage[] = parsed.images.map((image, imageIndex) => ({
      id: randomId(),
      recipeId,
      position: imageIndex,
      mimeType: image.mimeType,
      bytes: image.bytes,
    }))

    const recipe: Recipe = {
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

    try {
      await db.transaction('rw', db.recipes, db.images, async () => {
        await db.recipes.add(recipe)
        if (images.length > 0) await db.images.bulkAdd(images)
      })
      result.imported += 1
      result.images += images.length
      for (const warning of parsed.warnings) {
        result.warnings.push({ title: parsed.title, message: warning })
      }
    } catch (error) {
      // A concurrent insert can win the unique importId index; treat that as a
      // duplicate rather than a failed import.
      if ((error as Error).name === 'ConstraintError') {
        result.duplicates += 1
      } else {
        result.failed.push({ title: parsed.title, message: (error as Error).message })
      }
    }
  }

  return result
}

/**
 * Delete every recipe, image, cooking event, plan entry, free dish, day flag
 * and day note (test-data reset).
 */
export async function deleteAllData(): Promise<void> {
  await db.transaction(
    'rw',
    [
      db.recipes,
      db.images,
      db.mealPlans,
      db.mealDays,
      db.cookSessions,
      db.cookProgress,
      db.dayNotes,
      db.freeDishes,
    ],
    async () => {
      await db.images.clear()
      await db.mealPlans.clear()
      await db.mealDays.clear()
      await db.cookSessions.clear()
      await db.cookProgress.clear()
      await db.dayNotes.clear()
      await db.freeDishes.clear()
      await db.recipes.clear()
    },
  )
}

export async function deleteRecipe(recipeId: string): Promise<void> {
  await db.transaction(
    'rw',
    [db.recipes, db.images, db.mealPlans, db.cookSessions, db.cookProgress],
    async () => {
      await db.images.where('recipeId').equals(recipeId).delete()
      await db.mealPlans.where('recipeId').equals(recipeId).delete()
      const sessionIds = await db.cookSessions
        .where('recipeId')
        .equals(recipeId)
        .primaryKeys()
      await db.cookSessions.where('recipeId').equals(recipeId).delete()
      if (sessionIds.length > 0) {
        await db.cookProgress.where('cookSessionId').anyOf(sessionIds).delete()
      }
      await db.recipes.delete(recipeId)
    },
  )
}
