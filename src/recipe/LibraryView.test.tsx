import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  LibraryFilterChips,
  LibraryFilterSheet,
  LibrarySortSheet,
  RecipeLibraryView,
} from './LibraryView'
import { EMPTY_LIBRARY_FILTERS } from './libraryFilters'

function render(cloudMode: boolean): string {
  return renderToStaticMarkup(
    <RecipeLibraryView
      recipes={[]}
      cloudMode={cloudMode}
      renderRecipeCard={() => null}
    />,
  )
}

function renderFilterSheet(open: boolean): string {
  return renderToStaticMarkup(
    <LibraryFilterSheet
      open={open}
      onClose={() => undefined}
      filters={EMPTY_LIBRARY_FILTERS}
      categories={['Hauptgericht']}
      cuisines={['Italienisch']}
      dishTypes={['Pasta']}
      efforts={['einfach']}
      tags={['schnell']}
      resultCount={4}
      totalCount={9}
      onFilterChange={() => undefined}
      onReset={() => undefined}
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
    expect(html).toContain('Foto / Scan')
    expect(html).toContain('Mela-Import')
    expect(html).toContain('href="#/import/url"')
    expect(html).toContain('href="#/import/foto"')
    expect(html).toContain('href="#/import"')
  })

  it('marks direct desktop actions as secondary so phones can hide them', () => {
    const html = render(true)

    expect(html).toContain(
      'class="button quiet library-action-secondary" href="#/import/url"',
    )
    expect(html).toContain(
      'class="button quiet library-action-secondary" href="#/import/foto"',
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
    expect(html).not.toContain('Foto / Scan')
    expect(html).not.toContain('href="#/import/foto"')
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

  it('keeps the desktop filter bar and adds compact phone controls', () => {
    const html = render(true)

    expect(html).toContain('class="filter-bar"')
    expect(html).toContain('class="sort-field"')
    expect(html).toContain('class="library-mobile-actions"')
    expect(html).toContain('aria-label="Filter"')
    expect(html).toContain('aria-label="Sortierung ändern, aktuell A–Z"')
    // With no active filters no chip row is reserved.
    expect(html).not.toContain('class="library-filter-chips"')
    expect(html).not.toContain('library-filter-badge')
  })

  it('opens the filter sheet with every existing filter and reset', () => {
    const html = renderFilterSheet(true)

    expect(html).toContain('role="dialog"')
    expect(html).toContain('aria-label="Filter schließen"')
    expect(html).toContain('Mehrere Filter lassen sich kombinieren.')
    expect(html).toContain('4 von 9 Rezepten')
    expect(html).toContain('Kategorie')
    expect(html).toContain('Küche')
    expect(html).toContain('Gerichtstyp')
    expect(html).toContain('Aufwand')
    expect(html).toContain('Tag')
    expect(html).toContain('Alle zurücksetzen')
    expect(html).toContain('Fertig')
  })

  it('renders no filter sheet while it is closed', () => {
    expect(renderFilterSheet(false)).toBe('')
  })

  it('shows all existing sort options and marks the current one', () => {
    const html = renderToStaticMarkup(
      <LibrarySortSheet
        open
        sort="updated"
        onClose={() => undefined}
        onChange={() => undefined}
      />,
    )

    expect(html).toContain('role="dialog"')
    expect(html).toContain('A–Z')
    expect(html).toContain('Zuletzt hinzugefügt')
    expect(html).toContain('Zuletzt bearbeitet')
    expect(html).toContain('Dauer aufsteigend')
    expect(html).toContain('aria-checked="true"')
    expect(html).toContain('library-sort-option is-selected')
  })

  it('renders one removable chip per active filter and a reset action', () => {
    const html = renderToStaticMarkup(
      <LibraryFilterChips
        filters={{
          ...EMPTY_LIBRARY_FILTERS,
          category: 'Hauptgericht',
          cuisine: 'Italienisch',
        }}
        onRemove={() => undefined}
        onReset={() => undefined}
      />,
    )

    expect(html).toContain('aria-label="Aktive Filter"')
    expect(html).toContain('Kategorie: Hauptgericht')
    expect(html).toContain('Küche: Italienisch')
    expect(html).toContain('aria-label="Kategorie: Hauptgericht entfernen"')
    expect(html).toContain('aria-label="Küche: Italienisch entfernen"')
    expect(html).toContain('Alle zurücksetzen')
    expect(html.match(/class="library-filter-chip"/g)).toHaveLength(2)
  })

  it('does not reserve a chip row when no filter is active', () => {
    const html = renderToStaticMarkup(
      <LibraryFilterChips
        filters={EMPTY_LIBRARY_FILTERS}
        onRemove={() => undefined}
        onReset={() => undefined}
      />,
    )
    expect(html).toBe('')
  })
})
