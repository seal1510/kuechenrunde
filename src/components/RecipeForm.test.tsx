import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { RecipeDraft } from '../recipe/editor'
import { RecipeForm, type RecipeFormProps } from './RecipeForm'

vi.mock('./Markdown', () => ({
  Markdown: ({ text }: { text: string }) => <div data-markdown>{text}</div>,
  useImageUrl: () => null,
}))

function draft(): RecipeDraft {
  return {
    title: 'Synthetisches Curry',
    description: 'Ein rein synthetisches Testrezept.',
    sourceUrl: 'https://example.invalid/rezept',
    notes: 'Nur für Tests.',
    servingsText: '4 Portionen',
    prepTime: '10 min',
    cookTime: '20 min',
    totalTime: '30 min',
    cuisine: ['Indisch'],
    dishType: ['Curry'],
    effort: 'einfach',
    tags: ['schnell'],
    favorite: true,
    wantToCook: false,
    ingredients: [
      {
        key: 'i1',
        id: 'i1',
        group: 'Curry',
        quantity: '1 1/2',
        unit: 'TL',
        name: 'Kurkuma',
        purchaseNote: 'Bio',
        preparationNote: 'gemahlen',
      },
      {
        key: 'i2',
        id: 'i2',
        group: '',
        quantity: '',
        unit: '',
        name: 'Salz',
        purchaseNote: '',
        preparationNote: '',
      },
    ],
    steps: [
      {
        key: 's1',
        id: 's1',
        text: 'Die 1 1/2 TL Kurkuma in die Pfanne geben.',
        references: [
          {
            id: 'ref-1',
            ingredientId: 'i1',
            anchor: '1 1/2',
            anchorOffset: 4,
            quantity: { kind: 'full' },
          },
        ],
      },
    ],
  }
}

const images = [
  { id: 'image-1', bytes: new ArrayBuffer(1), mimeType: 'image/jpeg' },
  { id: 'image-2', bytes: new ArrayBuffer(1), mimeType: 'image/jpeg' },
]

function renderForm(overrides: Partial<RecipeFormProps> = {}) {
  return renderToStaticMarkup(
    <RecipeForm
      formId="recipe-editor"
      draft={draft()}
      onChange={() => undefined}
      images={images}
      onImagesChange={() => undefined}
      onSubmit={() => undefined}
      categoriesNote="Mela-Kategorie"
      {...overrides}
    />,
  )
}

describe('recipe editor form', () => {
  it('renders the workbench with all editable data and disclosures', () => {
    const html = renderForm()

    expect(html).toContain('id="recipe-editor"')
    expect(html).toContain('class="editor-layout"')
    expect(html).toContain('class="editor-main-column"')
    expect(html).toContain('class="editor-side-column"')
    expect(html).toContain('value="Synthetisches Curry"')
    expect(html).toContain('value="4 Portionen"')
    expect(html).toContain('value="30 min"')

    expect(html).toContain('Zutat hinzufügen')
    expect(html).toContain('value="Curry"')
    expect(html).toContain('value="1 1/2"')
    expect(html).toContain('value="TL"')
    expect(html).toContain('value="Kurkuma"')
    expect(html).toContain('value="Bio"')
    expect(html).toContain('value="gemahlen"')
    expect(html).toContain('Gruppe: Curry')
    expect(html).toContain('2 Hinweise')
    expect(html).toContain('aria-label="Zutat 1 nach unten"')

    expect(html).toContain('Schritt hinzufügen')
    expect(html).toContain('aria-label="Schritt 1"')
    expect(html).toContain('rows="5"')
    expect(html).toContain('Die 1 1/2 TL Kurkuma in die Pfanne geben.')
    expect(html).toContain('reference-anchor')
    expect(html).toContain('„1 1/2“')
    expect(html).toContain('Zutat im Text verknüpfen')

    expect(html).toContain('Kategorien &amp; Tags')
    expect(html).toContain('>Indisch')
    expect(html).toContain('>Curry')
    expect(html).toContain('>schnell')
    expect(html).toContain('value="einfach"')

    expect(html).toContain('Vorschau der Zubereitung')
    expect(html).toContain('Erweiterte Rezeptinformationen')
    expect(html).toContain('value="https://example.invalid/rezept"')
    expect(html).toContain('Mela-Kategorie')
    expect(html).toContain('Hauptbild')
    expect(html).toContain('Bilder hinzufügen')
  })

  it('keeps the shared form id used by the URL import', () => {
    const html = renderForm({ formId: 'url-import-form' })
    expect(html).toContain('id="url-import-form"')
  })

  it('marks an empty required title as invalid when the form reports an error', () => {
    const empty = draft()
    empty.title = ''
    const html = renderForm({ draft: empty, error: 'Bitte einen Titel eingeben.' })

    expect(html).toContain('id="recipe-editor-error"')
    expect(html).toContain('aria-invalid="true"')
    expect(html).toContain('aria-describedby="recipe-editor-error"')
  })
})
