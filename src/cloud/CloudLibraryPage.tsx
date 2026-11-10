import { RecipeCard } from '../components/RecipeCard'
import type { CloudRecordsStore } from '../data/cloudRecords'
import { RecipeLibraryView } from '../recipe/LibraryView'
import type { Recipe } from '../types'
import { useCloudImageUrl } from './CloudImageProvider'
import { useCloudRecipeImages, useCloudRecipes } from './useCloudRecipes'

function CloudRecipeCard({
  store,
  recipe,
}: {
  store: CloudRecordsStore
  recipe: Recipe
}) {
  const images = useCloudRecipeImages(store, recipe.id)
  const cover = images?.[0]
  const coverUrl = useCloudImageUrl(cover?.storagePath)
  return (
    <RecipeCard
      recipe={recipe}
      coverUrl={coverUrl.url}
      coverError={coverUrl.status === 'error' ? coverUrl.error : undefined}
    />
  )
}

export function CloudLibraryPage({ store }: { store: CloudRecordsStore }) {
  const recipes = useCloudRecipes(store)
  return (
    <RecipeLibraryView
      recipes={recipes}
      cloudMode
      renderRecipeCard={(recipe) => <CloudRecipeCard store={store} recipe={recipe} />}
    />
  )
}
