import { RecipeCard } from '../components/RecipeCard'
import type { CloudRecordsStore } from '../data/cloudRecords'
import { RecipeLibraryView } from '../recipe/LibraryView'
import { useCloudRecipes } from './useCloudRecipes'

export function CloudLibraryPage({ store }: { store: CloudRecordsStore }) {
  const recipes = useCloudRecipes(store)
  return (
    <RecipeLibraryView
      recipes={recipes}
      cloudMode
      renderRecipeCard={(recipe) => (
        <RecipeCard recipe={recipe} coverUrl={null} />
      )}
    />
  )
}
