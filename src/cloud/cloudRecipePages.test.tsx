import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { CloudRecordsStore } from '../data/cloudRecords'
import type { Recipe } from '../types'
import { CloudLibraryPage } from './CloudLibraryPage'
import { CloudRecipeDetailPage } from './CloudRecipeDetailPage'

vi.mock('../components/Markdown', () => ({
  Markdown: ({ text }: { text: string }) => <div data-markdown>{text}</div>,
  useImageUrl: () => null,
}))

function recipe(id: string, title: string): Recipe {
  return {
    id,
    importId: `manual-${id}`,
    importSource: 'manual',
    title,
    description: 'Ein synthetisches Cloud-Testrezept.',
    ingredientGroups: [],
    ingredients: [],
    instructions: [],
    servingsText: '2 Portionen',
    servingsNumber: 2,
    prepTime: '5 min',
    cookTime: '10 min',
    totalTime: '15 min',
    categories: [],
    cuisine: [],
    dishType: [],
    effort: '',
    tags: [],
    notes: '',
    nutrition: '',
    sourceUrl: '',
    favorite: false,
    wantToCook: false,
    melaDate: null,
    raw: {},
    createdAt: 1,
    updatedAt: 1,
  }
}

function fakeStore(recipes: Recipe[]): CloudRecordsStore {
  const rows = recipes.map((entry, index) => ({
    collection: 'recipes',
    id: entry.id,
    rev: index + 1,
    data: entry,
  }))
  return {
    getVersion: () => 1,
    subscribe: () => () => {},
    list: (collection: string) =>
      collection === 'recipes' ? rows : [],
    get: (collection: string, id: string) =>
      collection === 'recipes' ? rows.find((row) => row.id === id) : undefined,
  } as unknown as CloudRecordsStore
}

describe('Cloud-Rezeptseiten', () => {
  it('zeigt die Cloud-Bibliothek mit URL-, Mela-Import- und Backup-Aktionen', () => {
    const html = renderToStaticMarkup(
      <CloudLibraryPage store={fakeStore([recipe('r1', 'Cloud-Curry')])} />,
    )

    expect(html).toContain('Rezeptbibliothek')
    expect(html).toContain('Cloud-Curry')
    expect(html).toContain('Neues Rezept')
    expect(html).not.toContain('Zur Bibliothek')
    expect(html).toContain('URL-Import')
    expect(html).toContain('Mela-Import')
    expect(html).toContain('Backup')
    expect(html).not.toContain('Alles bleibt lokal')
  })

  it('zeigt den leeren Cloud-Bestand korrekt', () => {
    const html = renderToStaticMarkup(<CloudLibraryPage store={fakeStore([])} />)
    expect(html).toContain('Noch keine Cloud-Rezepte gespeichert.')
    expect(html).toContain('Lege dein erstes Rezept an.')
    expect(html).toContain('Rezept per URL importieren')
    expect(html).not.toContain('Zum Import')
  })

  it('zeigt Cloud-Details mit Bearbeitung, manuellem Einplanen und Kochen', () => {
    const html = renderToStaticMarkup(
      <CloudRecipeDetailPage
        store={fakeStore([recipe('r1', 'Cloud-Curry')])}
        id="r1"
      />,
    )

    expect(html).toContain('Cloud-Curry')
    expect(html).toContain('Zutaten')
    expect(html).toContain('Zubereitung')
    expect(html).toContain('Bearbeiten')
    expect(html).toContain('Timer und Kochfortschritt bleiben auf diesem Gerät')
    expect(html.match(/Einplanen/g)).toHaveLength(2)
    expect(html.match(/Kochen/g)).toHaveLength(2)
    expect(html).toContain('detail-cook')
    expect(html).toContain('href="#/recipe/r1/cook"')
    expect(html).not.toMatch(/automatisch/i)
  })

  it('zeigt bei unbekannter ID den Nicht-gefunden-Zustand', () => {
    const html = renderToStaticMarkup(
      <CloudRecipeDetailPage store={fakeStore([])} id="fehlt" />,
    )
    expect(html).toContain('Rezept nicht gefunden.')
  })
})
