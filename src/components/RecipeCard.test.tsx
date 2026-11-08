import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { Recipe } from '../types'
import { RecipeBody, RecipeCard } from './RecipeCard'

vi.mock('./Markdown', () => ({
  Markdown: ({ text }: { text: string }) => <div data-markdown>{text}</div>,
}))

function recipe(overrides: Partial<Recipe> = {}): Recipe {
  return {
    id: 'r1',
    importId: 'mela-r1',
    importSource: 'mela',
    title: 'Testrezept',
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
    ...overrides,
  }
}

describe('recipe notes and nutrition', () => {
  it('renders notes and nutrition under separate headings', () => {
    const html = renderToStaticMarkup(
      <RecipeBody recipe={recipe({ notes: 'Allgemeine Notiz', nutrition: 'Kalorien: 420 kcal' })} />,
    )
    const notesIndex = html.indexOf('>Notizen<')
    const nutritionIndex = html.indexOf('>Nährwerte<')
    expect(html).toContain('recipe-layout has-notes has-nutrition')
    expect(notesIndex).toBeGreaterThan(-1)
    expect(nutritionIndex).toBeGreaterThan(notesIndex)
    expect(html).toContain('Allgemeine Notiz')
    expect(html).toContain('Kalorien: 420 kcal')
    expect(html).not.toContain('Originaltext')
    expect(html).not.toContain('Mela liefert')
  })

  it('does not render an empty nutrition section', () => {
    const html = renderToStaticMarkup(<RecipeBody recipe={recipe({ notes: 'Nur eine Notiz' })} />)
    expect(html).toContain('recipe-layout has-notes')
    expect(html).not.toContain('has-nutrition')
    expect(html).toContain('>Notizen<')
    expect(html).not.toContain('>Nährwerte<')
    expect(html).toContain('Nur eine Notiz')
  })

  it('does not render an empty notes section', () => {
    const html = renderToStaticMarkup(<RecipeBody recipe={recipe({ nutrition: 'Protein: 18 g' })} />)
    expect(html).toContain('recipe-layout has-nutrition')
    expect(html).not.toContain('has-notes')
    expect(html).not.toContain('>Notizen<')
    expect(html).toContain('>Nährwerte<')
    expect(html).toContain('Protein: 18 g')
  })

  it('hides both sections when both fields are empty', () => {
    const html = renderToStaticMarkup(<RecipeBody recipe={recipe()} />)
    expect(html).not.toContain('>Notizen<')
    expect(html).not.toContain('>Nährwerte<')
  })

  it('shows ingredients with amounts before ingredients without, stably', () => {
    const html = renderToStaticMarkup(
      <RecipeBody
        recipe={recipe({
          ingredients: [
            {
              id: 'i1',
              groupId: null,
              position: 0,
              raw: 'Salz',
              name: 'Salz',
              quantity: null,
              quantityText: null,
              unit: null,
              parseStatus: 'plain',
              links: [],
            },
            {
              id: 'i2',
              groupId: null,
              position: 1,
              raw: '2 Paprika',
              name: 'Paprika',
              quantity: 2,
              quantityText: '2',
              unit: null,
              parseStatus: 'parsed',
              links: [],
            },
            {
              id: 'i3',
              groupId: null,
              position: 2,
              raw: 'Pfeffer',
              name: 'Pfeffer',
              quantity: null,
              quantityText: null,
              unit: null,
              parseStatus: 'plain',
              links: [],
            },
            {
              id: 'i4',
              groupId: null,
              position: 3,
              raw: '1 Zwiebel',
              name: 'Zwiebel',
              quantity: 1,
              quantityText: '1',
              unit: null,
              parseStatus: 'parsed',
              links: [],
            },
          ],
        })}
      />,
    )
    expect(html.indexOf('Paprika')).toBeLessThan(html.indexOf('Zwiebel'))
    expect(html.indexOf('Zwiebel')).toBeLessThan(html.indexOf('Salz'))
    expect(html.indexOf('Salz')).toBeLessThan(html.indexOf('Pfeffer'))
  })

  it('shows purchase and preparation notes without merging them', () => {
    const html = renderToStaticMarkup(
      <RecipeBody
        recipe={recipe({
          ingredients: [
            {
              id: 'i1',
              groupId: null,
              position: 0,
              raw: '350 ml passierte Tomaten (Mutti)',
              name: 'passierte Tomaten',
              quantity: 350,
              quantityText: '350',
              unit: 'ml',
              purchaseNote: 'bevorzugt Mutti',
              preparationNote: 'passiert',
              parseStatus: 'parsed',
              links: [],
            },
          ],
        })}
      />,
    )
    expect(html).toContain('Einkauf: bevorzugt Mutti')
    expect(html).toContain('Zubereitung: passiert')
    expect(html).toContain('passierte Tomaten')
  })

  it('lays out ingredients before preparation in a two-column body', () => {
    const html = renderToStaticMarkup(<RecipeBody recipe={recipe()} />)
    expect(html).toContain('recipe-layout')
    expect(html).not.toContain('recipe-main')
    expect(html.indexOf('>Zutaten<')).toBeGreaterThan(-1)
    expect(html.indexOf('>Zubereitung<')).toBeGreaterThan(html.indexOf('>Zutaten<'))
  })
})

describe('recipe cards', () => {
  it('renders a text card without an image placeholder', () => {
    const html = renderToStaticMarkup(
      <RecipeCard
        recipe={recipe({
          totalTime: '6 1/2 - 7 Stunden',
          servingsText: '2',
          servingsNumber: 2,
          tags: ['Schnell'],
        })}
        coverUrl={null}
      />,
    )
    expect(html).toContain('recipe-card is-text')
    expect(html).toContain('Testrezept')
    expect(html).toContain('6,5–7 Std.')
    expect(html).toContain('Schnell')
    expect(html).not.toContain('Portion')
    expect(html).not.toContain('recipe-card-thumb')
    expect(html).not.toContain('recipe-card-placeholder')
  })

  it('renders bare Mela minute values as readable durations', () => {
    const html = renderToStaticMarkup(
      <RecipeCard recipe={recipe({ totalTime: '60' })} coverUrl={null} />,
    )
    expect(html).toContain('1 Std.')
    expect(html).not.toContain('60 Min.')
  })

  it('places the thumbnail beside the text, not above the title', () => {
    const html = renderToStaticMarkup(<RecipeCard recipe={recipe()} coverUrl="blob:demo" />)
    expect(html).toContain('recipe-card has-image')
    expect(html).toContain('recipe-card-thumb')
    expect(html).toContain('src="blob:demo"')
    expect(html).not.toContain('recipe-card-image')
    expect(html.indexOf('recipe-card-text')).toBeLessThan(html.indexOf('recipe-card-thumb'))
    expect(html.indexOf('<h2>')).toBeLessThan(html.indexOf('recipe-card-thumb'))
  })

  it('keeps the full title accessible while the card clamps it visually', () => {
    const title = 'Ein sehr langer Rezepttitel mit vielen Wörtern für die Kartenansicht'
    const html = renderToStaticMarkup(
      <RecipeCard recipe={recipe({ title })} coverUrl={null} />,
    )
    expect(html).toContain(`title="${title}"`)
    expect(html).toContain(title)
  })

  it('does not reserve an empty metadata block', () => {
    const html = renderToStaticMarkup(
      <RecipeCard
        recipe={recipe({ servingsText: '', servingsNumber: null, totalTime: '', tags: [] })}
        coverUrl={null}
      />,
    )
    expect(html).not.toContain('recipe-card-facts')
    expect(html).not.toContain('recipe-card-tags')
    expect(html).not.toContain('recipe-card-meta')
  })
})
