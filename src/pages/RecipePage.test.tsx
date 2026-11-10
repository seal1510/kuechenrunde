import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { Recipe } from '../types'
import { RecipePage } from './RecipePage'

const live = vi.hoisted(() => {
  let call = 0
  let values: unknown[] = []
  return {
    reset: (next: unknown[]) => {
      call = 0
      values = next
    },
    next: () => values[call++ % values.length],
  }
})

vi.mock('dexie-react-hooks', () => ({
  useLiveQuery: () => live.next(),
}))

vi.mock('../components/Markdown', () => ({
  Markdown: ({ text }: { text: string }) => <div data-markdown>{text}</div>,
  useImageUrl: () => null,
}))

function recipe(): Recipe {
  return {
    id: 'r1',
    importId: 'mela-r1',
    importSource: 'mela',
    title: 'Testgericht',
    description: '',
    ingredientGroups: [],
    ingredients: [],
    instructions: [],
    servingsText: '2',
    servingsNumber: 2,
    prepTime: '',
    cookTime: '',
    totalTime: '',
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

describe('recipe detail planning action', () => {
  it('offers an explicit plan action without automatic planning', () => {
    live.reset([{ recipe: recipe() }, [], { weekStartDay: 3 }])
    const html = renderToStaticMarkup(<RecipePage id="r1" />)

    expect(html).toContain('Einplanen')
    expect(html.match(/Einplanen/g)).toHaveLength(2)
    expect(html).toContain('Kochen')
    expect(html).not.toMatch(/automatisch/i)
  })
})
