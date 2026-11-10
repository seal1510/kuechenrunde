import {
  deleteAllData,
  existingImportIds,
  importMelaRecipes,
} from '../import/importer'
import { ImportPage } from './ImportPage'

/** Local Dexie wiring for the shared Mela import UI. */
export function LocalImportPage() {
  return (
    <ImportPage
      service="local"
      existingImportIds={existingImportIds}
      importRecipes={importMelaRecipes}
      deleteAllData={deleteAllData}
    />
  )
}
