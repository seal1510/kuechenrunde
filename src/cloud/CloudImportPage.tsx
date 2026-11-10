import type { CloudRecipeImageService } from '../data/cloudImages'
import type { CloudRecordsStore } from '../data/cloudRecords'
import { ImportPage } from '../pages/ImportPage'
import {
  existingCloudImportIds,
  importMelaRecipesToCloud,
} from './cloudMelaImport'

export function CloudImportPage({
  store,
  images,
}: {
  store: CloudRecordsStore
  images: CloudRecipeImageService
}) {
  return (
    <ImportPage
      service="cloud"
      existingImportIds={(ids) => existingCloudImportIds(store, ids)}
      importRecipes={(recipes, onProgress) =>
        importMelaRecipesToCloud(store, images, recipes, onProgress)
      }
    />
  )
}
