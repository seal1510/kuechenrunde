import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { UrlImportPage } from './UrlImportPage'

vi.mock('../components/Markdown', () => ({
  Markdown: ({ text }: { text: string }) => <div data-markdown>{text}</div>,
  useImageUrl: () => null,
}))

const findDuplicates = async () => ({ exact: null, sameSource: [] })
const saveImport = async () => []

describe('URL import page', () => {
  it('keeps the local default and its Mela-import link', () => {
    const html = renderToStaticMarkup(<UrlImportPage findDuplicates={findDuplicates} saveImport={saveImport} />)
    expect(html).toContain('Rezept per URL importieren')
    expect(html).toContain('Der Abruf läuft über den lokalen, abgesicherten Importdienst.')
    expect(html).toContain('Mela-Import')
    expect(html).toContain('lokal')
    expect(html).not.toContain('Familien-Cloud')
  })

  it('uses the cloud copy without the local Mela-import link', () => {
    const html = renderToStaticMarkup(
      <UrlImportPage service="cloud" findDuplicates={findDuplicates} saveImport={saveImport} />,
    )
    expect(html).toContain('Der Abruf läuft über den abgesicherten Importdienst der Familien-Cloud.')
    expect(html).toContain('in der Familien-Cloud')
    expect(html).not.toContain('Mela-Import')
  })
})
