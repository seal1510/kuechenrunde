import { db } from '../db'
import { randomId } from '../lib/id'
import type { Recipe, RecipeImage } from '../types'

export interface EditorImage {
  id: string
  bytes: ArrayBuffer
  mimeType: string
}

export interface RecipeEditorData {
  recipe: Recipe
  images: RecipeImage[]
}

export async function loadRecipeEditorData(id: string): Promise<RecipeEditorData | null> {
  const recipe = await db.recipes.get(id)
  if (!recipe) return null
  const images = await db.images.where('recipeId').equals(id).sortBy('position')
  return { recipe, images }
}

/**
 * Persist a recipe and its exact image list in one transaction. Existing image
 * ids keep their bytes; new images get a fresh id; removed images are deleted.
 * The image at position 0 is the cover / primary image.
 */
export async function saveRecipeWithImages(recipe: Recipe, images: EditorImage[]): Promise<void> {
  const rows: RecipeImage[] = images.map((image, index) => ({
    id: image.id || randomId(),
    recipeId: recipe.id,
    position: index,
    mimeType: image.mimeType,
    bytes: image.bytes,
  }))

  await db.transaction('rw', db.recipes, db.images, async () => {
    await db.recipes.put(recipe)
    const existing = await db.images.where('recipeId').equals(recipe.id).toArray()
    const keep = new Set(rows.map((row) => row.id))
    const remove = existing.filter((row) => !keep.has(row.id)).map((row) => row.id)
    if (remove.length > 0) await db.images.bulkDelete(remove)
    if (rows.length > 0) await db.images.bulkPut(rows)
  })
}
