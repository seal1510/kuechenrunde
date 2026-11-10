import { useMemo } from 'react'
import type { CloudRecordsStore } from '../data/cloudRecords'
import { CloudRecipeRepository } from '../data/cloudRecipes'
import { RecipeEditorPage } from '../pages/RecipeEditorPage'
import { createCloudRecipeEditorBackend } from './cloudRecipeEditorBackend'

export function CloudRecipeEditorPage({
  store,
  id,
}: {
  store: CloudRecordsStore
  id?: string
}) {
  const repository = useMemo(() => new CloudRecipeRepository(store), [store])
  const backend = useMemo(
    () => createCloudRecipeEditorBackend(repository),
    [repository],
  )
  return <RecipeEditorPage id={id} backend={backend} />
}
