import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db'
import type { Recipe } from '../types'
import { RecipeCard } from '../components/RecipeCard'
import { useImageUrl } from '../components/Markdown'
import { RecipeLibraryView } from '../recipe/LibraryView'

function RecipeCardWithCover({ recipe }: { recipe: Recipe }) {
  const cover = useLiveQuery(
    () =>
      db.images
        .where('recipeId')
        .equals(recipe.id)
        .sortBy('position')
        .then((images) => images[0]),
    [recipe.id],
  )
  const url = useImageUrl(cover?.bytes, cover?.mimeType)
  return <RecipeCard recipe={recipe} coverUrl={url} />
}

export function LibraryPage() {
  const recipes = useLiveQuery(
    () => db.recipes.orderBy('updatedAt').reverse().toArray(),
    [],
  )

  return (
    <RecipeLibraryView
      recipes={recipes}
      renderRecipeCard={(recipe) => <RecipeCardWithCover recipe={recipe} />}
    />
  )
}
