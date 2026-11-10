import { useCallback, useMemo } from 'react'
import type { CloudRecipeImageService } from '../data/cloudImages'
import type { CloudRecordsStore } from '../data/cloudRecords'
import { CloudRecipeRepository } from '../data/cloudRecipes'
import { CLOUD_RECIPE_IMAGE_MIME_TYPES } from '../import/image-mime'
import { createRecipeFetcher } from '../import/url-fetcher'
import { UrlImportPage } from '../pages/UrlImportPage'
import type { EditorImage } from '../recipe/repository'
import { getAccessToken } from '../supabase/auth'
import type { Recipe } from '../types'
import {
  findCloudUrlImportDuplicates,
  saveCloudUrlImportedRecipe,
} from './cloudUrlImport'

export function CloudUrlImportPage({
  store,
  images,
}: {
  store: CloudRecordsStore
  images: CloudRecipeImageService
}) {
  const repository = useMemo(() => new CloudRecipeRepository(store), [store])
  // The endpoint is same-origin. The Supabase token is sent only to this own
  // route; the Pages Function never forwards it to the recipe website.
  const fetcher = useMemo(
    () => createRecipeFetcher({ service: 'cloud', getAccessToken }),
    [],
  )
  const findDuplicates = useCallback(
    async (importUrl: string, candidateKey: string) =>
      findCloudUrlImportDuplicates(repository, importUrl, candidateKey),
    [repository],
  )
  const saveImport = useCallback(
    (recipe: Recipe, editorImages: EditorImage[]) =>
      saveCloudUrlImportedRecipe(images, recipe, editorImages),
    [images],
  )

  return (
    <UrlImportPage
      service="cloud"
      fetcher={fetcher}
      findDuplicates={findDuplicates}
      saveImport={saveImport}
      allowedImageTypes={CLOUD_RECIPE_IMAGE_MIME_TYPES}
    />
  )
}

