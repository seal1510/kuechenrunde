import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ImportPage } from './ImportPage'

const existingImportIds = async () => new Set<string>()
const importRecipes = async () => ({
  imported: 0,
  duplicates: 0,
  failed: [],
  warnings: [],
  images: 0,
})

describe('Mela import page', () => {
  it('keeps the local copy and the local test-data reset', () => {
    const html = renderToStaticMarkup(
      <ImportPage
        existingImportIds={existingImportIds}
        importRecipes={importRecipes}
        deleteAllData={async () => {}}
      />,
    )
    expect(html).toContain('Die Verarbeitung findet vollständig in diesem Browser statt.')
    expect(html).toContain('lokal in IndexedDB')
    expect(html).toContain('Testdaten')
    expect(html).not.toContain('Familien-Cloud')
  })

  it('uses the cloud copy and hides the local reset', () => {
    const html = renderToStaticMarkup(
      <ImportPage
        service="cloud"
        existingImportIds={existingImportIds}
        importRecipes={importRecipes}
      />,
    )
    expect(html).toContain('gespeichert wird in der Familien-Cloud')
    expect(html).toContain('im privaten Familienspeicher')
    expect(html).not.toContain('Testdaten')
    expect(html).not.toContain('lokal in IndexedDB')
  })
})
