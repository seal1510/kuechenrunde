import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { BackupPage } from './BackupPage'

const exportBackup = async () => ({
  bytes: new Uint8Array(),
  manifest: {
    format: 'opencook-web-backup' as const,
    version: 13,
    createdAt: '2026-05-25T10:00:00.000Z',
    appVersion: '0.4.0',
    counts: {
      recipes: 0,
      images: 0,
      mealPlans: 0,
      mealDays: 0,
      settings: 0,
      dayNotes: 0,
      freeDishes: 0,
      shoppingManualItems: 0,
      shoppingChecks: 0,
      shoppingPurchases: 0,
      shoppingItemRules: 0,
      shoppingQuantityCorrections: 0,
      shoppingLists: 0,
      shoppingDemandAllocations: 0,
    },
    includes: [],
  },
})
const inspectBackup = async () => {
  throw new Error('not used')
}
const restoreBackup = async () => {
  throw new Error('not used')
}

describe('backup page', () => {
  it('keeps the local copy and data management', () => {
    const html = renderToStaticMarkup(
      <BackupPage
        exportBackup={exportBackup}
        inspectBackup={inspectBackup}
        restoreBackup={restoreBackup}
        deleteAllData={async () => {}}
      />,
    )
    expect(html).toContain('Die Datei bleibt ausschließlich lokal.')
    expect(html).toContain('Datenverwaltung')
    expect(html).not.toContain('Familien-Cloud')
  })

  it('uses the cloud copy and hides the local delete/reset section', () => {
    const html = renderToStaticMarkup(
      <BackupPage
        service="cloud"
        exportBackup={exportBackup}
        inspectBackup={inspectBackup}
        restoreBackup={restoreBackup}
      />,
    )
    expect(html).toContain('Gemeinsame Cloud-Daten als vollständiges ZIP')
    expect(html).toContain('nur in eine leere Familien-Cloud')
    expect(html).not.toContain('Datenverwaltung')
    expect(html).not.toContain('Die Datei bleibt ausschließlich lokal.')
  })
})
