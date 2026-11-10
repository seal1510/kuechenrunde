import { db } from '../db'
import { planCleanupForDeletedSessions } from '../shopping/orphanCleanup'
import { randomId } from '../lib/id'
import { recipeFromParsedMela } from './melaRecipe'
import type {
  ImportProgress,
  ImportResult,
  ParsedMelaRecipe,
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

    const recipe = recipeFromParsedMela(parsed)
    const images: RecipeImage[] = parsed.images.map((image, imageIndex) => ({
      id: randomId(),
      recipeId: recipe.id,
      position: imageIndex,
      mimeType: image.mimeType,
      bytes: image.bytes,
    }))

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
 * Delete every recipe, image, cooking event, plan entry, free dish, day flag,
 * day note and all shopping data (test-data reset). Settings are deliberately
 * kept, matching the existing UI contract (household size and the shopping
 * configuration stay editable). The whole reset is one transaction, so a
 * failure cannot leave a partially deleted shopping state behind.
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
      db.shoppingManualItems,
      db.shoppingChecks,
      db.shoppingPurchases,
      db.shoppingItemRules,
      db.shoppingQuantityCorrections,
      db.shoppingLists,
      db.shoppingDemandAllocations,
    ],
    async () => {
      await db.images.clear()
      await db.mealPlans.clear()
      await db.mealDays.clear()
      await db.cookSessions.clear()
      await db.cookProgress.clear()
      await db.dayNotes.clear()
      await db.freeDishes.clear()
      await db.shoppingManualItems.clear()
      await db.shoppingChecks.clear()
      await db.shoppingPurchases.clear()
      await db.shoppingItemRules.clear()
      await db.shoppingQuantityCorrections.clear()
      await db.shoppingLists.clear()
      await db.shoppingDemandAllocations.clear()
      await db.recipes.clear()
    },
  )
}

export async function deleteRecipe(recipeId: string): Promise<void> {
  await db.transaction(
    'rw',
    [
      db.recipes,
      db.images,
      db.mealPlans,
      db.cookSessions,
      db.cookProgress,
      db.freeDishes,
      db.settings,
      db.shoppingLists,
      db.shoppingItemRules,
      db.shoppingQuantityCorrections,
      db.shoppingPurchases,
      db.shoppingDemandAllocations,
    ],
    async () => {
      // Removing a recipe also removes all of its planned cooking events. The
      // shopping cleanup must therefore run for every affected event before
      // the sessions disappear.
      const sessions = await db.cookSessions
        .where('recipeId')
        .equals(recipeId)
        .toArray()
      const cleanup = await planCleanupForDeletedSessions(sessions)

      await db.images.where('recipeId').equals(recipeId).delete()
      await db.mealPlans.where('recipeId').equals(recipeId).delete()
      await db.cookSessions.where('recipeId').equals(recipeId).delete()
      if (sessions.length > 0) {
        await db.cookProgress
          .where('cookSessionId')
          .anyOf(sessions.map((session) => session.id))
          .delete()
      }
      if (cleanup.removedPurchaseIds.length > 0) {
        await db.shoppingPurchases.bulkDelete(cleanup.removedPurchaseIds)
      }
      if (cleanup.removedAllocationIds.length > 0) {
        await db.shoppingDemandAllocations.bulkDelete(cleanup.removedAllocationIds)
      }
      await db.recipes.delete(recipeId)
    },
  )
}
