import { useCallback } from 'react'
import { inspectBackup } from '../backup/backup'
import type { CloudRecordsStore } from '../data/cloudRecords'
import type { ImageStoragePort } from '../data/imageStorage'
import { BackupPage } from '../pages/BackupPage'
import { exportCloudBackup, restoreCloudBackup } from './cloudBackup'

export function CloudBackupPage({
  store,
  storage,
}: {
  store: CloudRecordsStore
  storage: ImageStoragePort
}) {
  const handleExport = useCallback(
    () => exportCloudBackup(store, storage),
    [store, storage],
  )
  const handleInspect = useCallback(
    (buffer: ArrayBuffer) => inspectBackup(buffer, { compareLocal: false }),
    [],
  )
  const handleRestore = useCallback(
    (inspection: Parameters<typeof restoreCloudBackup>[0]) =>
      restoreCloudBackup(inspection, store, storage),
    [store, storage],
  )

  return (
    <BackupPage
      service="cloud"
      exportBackup={handleExport}
      inspectBackup={handleInspect}
      restoreBackup={handleRestore}
    />
  )
}
