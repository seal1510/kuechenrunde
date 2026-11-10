import { useMemo } from 'react'
import type { CloudRecipeImageService } from '../data/cloudImages'
import type { CloudRecordsStore } from '../data/cloudRecords'
import { CloudRecipeRepository } from '../data/cloudRecipes'
import { RecipeEditorPage } from '../pages/RecipeEditorPage'
import { createCloudRecipeEditorBackend } from './cloudRecipeEditorBackend'

export function CloudRecipeEditorPage({
  store,
  images,
  id,
}: {
  store: CloudRecordsStore
  images: CloudRecipeImageService
  id?: string
}) {
  const repository = useMemo(() => new CloudRecipeRepository(store), [store])
  const backend = useMemo(
    () => createCloudRecipeEditorBackend(repository, images),
    [repository, images],
  )
  return <RecipeEditorPage id={id} backend={backend} />
}
