import {
  findUrlImportDuplicates,
  saveLocalUrlImport,
} from '../import/local-url-import'
import { UrlImportPage } from './UrlImportPage'

/** Local Dexie wiring for the shared URL-import UI. */
export function LocalUrlImportPage() {
  return (
    <UrlImportPage
      service="local"
      findDuplicates={findUrlImportDuplicates}
      saveImport={saveLocalUrlImport}
    />
  )
}
