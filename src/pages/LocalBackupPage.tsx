import {
  exportBackup,
  inspectBackup,
  restoreBackup,
} from '../backup/backup'
import { deleteAllData } from '../import/importer'
import { BackupPage } from './BackupPage'

/** Local Dexie wiring for the shared backup UI. */
export function LocalBackupPage() {
  return (
    <BackupPage
      service="local"
      exportBackup={exportBackup}
      inspectBackup={inspectBackup}
      restoreBackup={restoreBackup}
      deleteAllData={deleteAllData}
    />
  )
}
