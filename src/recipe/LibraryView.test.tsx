import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { RecipeLibraryView } from './LibraryView'

function render(cloudMode: boolean): string {
  return renderToStaticMarkup(
    <RecipeLibraryView
      recipes={[]}
      cloudMode={cloudMode}
      renderRecipeCard={() => null}
    />,
  )
}

describe('mobile recipe library actions', () => {
  it('keeps Neues Rezept primary and folds both imports into one Import menu', () => {
    const html = render(true)

    expect(html).toContain('Neues Rezept')
    expect(html).toContain('class="library-import-menu"')
    expect(html).toContain('<summary class="button quiet">Import</summary>')
    expect(html).toContain('URL-Rezeptimport')
    expect(html).toContain('Mela-Import')
    expect(html).toContain('href="#/import/url"')
    expect(html).toContain('href="#/import"')
  })

  it('marks direct desktop actions as secondary so phones can hide them', () => {
    const html = render(true)

    expect(html).toContain(
      'class="button quiet library-action-secondary" href="#/import/url"',
    )
    expect(html).toContain(
      'class="button quiet library-action-secondary" href="#/import"',
    )
    expect(html).toContain(
      'class="button quiet library-action-secondary" href="#/backup"',
    )
  })

  it('offers the same import menu in local mode', () => {
    const html = render(false)

    expect(html).toContain('class="library-import-menu"')
    expect(html).toContain('URL-Rezeptimport')
    expect(html).toContain('Mela-Import')
    expect(html).toContain('href="#/backup"')
    expect(html).toContain('Backup')
  })

  it('keeps search, sorting and filters in the library', () => {
    const html = render(true)

    expect(html).toContain('Rezepte durchsuchen')
    expect(html).toContain('Sortierung')
    expect(html).toContain('Kategorie')
    expect(html).toContain('Küche')
    expect(html).toContain('Gerichtstyp')
    expect(html).toContain('Aufwand')
    expect(html).toContain('Tag')
  })
})
