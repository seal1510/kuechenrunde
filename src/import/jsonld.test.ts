import { describe, expect, it } from 'vitest'
import { extractRecipeCandidates, htmlToText } from './jsonld'

function page(blocks: Array<unknown | string>, head = ''): string {
  const scripts = blocks
    .map((block) => {
      const content = typeof block === 'string' ? block : JSON.stringify(block)
      return `<script type="application/ld+json">${content}</script>`
    })
    .join('\n')
  return `<!doctype html><html><head>${head}</head><body>${scripts}</body></html>`
}

const fullRecipe = {
  '@context': 'https://schema.org',
  '@type': 'Recipe',
  '@id': 'https://example.com/rezepte/pasta#recipe',
  name: 'Tomatenpasta',
  description: '<p>Lecker &amp; schnell.</p><p>Für 4 Personen.</p>',
  recipeYield: 4,
  prepTime: 'PT20M',
  cookTime: 'PT30M',
  totalTime: 'PT50M',
  recipeCategory: 'Hauptgericht',
  recipeCuisine: 'Italienisch',
  keywords: 'schnell, einfach',
  recipeIngredient: [
    '2 Zwiebeln',
    '200 g Mehl',
    '1 Bund Petersilie',
    '2 Zwiebeln (fein gewürfelt)',
    {
      '@type': 'HowToSupply',
      name: 'Salz',
      amount: 1,
      unitText: 'Prise',
      purchaseNote: 'Meersalz',
      preparationNote: 'fein mahlen',
    },
  ],
  recipeInstructions: [
    { '@type': 'HowToStep', text: 'Teig kneten.' },
    {
      '@type': 'HowToSection',
      name: 'Für die Sauce',
      itemListElement: [
        { '@type': 'HowToStep', text: 'Tomaten <b>kochen</b>.' },
        { '@type': 'HowToStep', text: 'Abschmecken.' },
      ],
    },
    'Alles servieren.',
  ],
  image: [
    'https://example.com/img1.jpg',
    { '@type': 'ImageObject', url: '/img2.jpg' },
  ],
}

describe('JSON-LD recipe extraction', () => {
  it('reads a complete Recipe object and reuses the existing ingredient/time parsers', () => {
    const result = extractRecipeCandidates(page([fullRecipe]), 'https://example.com/rezept')
    expect(result.candidates).toHaveLength(1)
    expect(result.jsonLdBlockCount).toBe(1)
    expect(result.recipeObjectCount).toBe(1)

    const recipe = result.candidates[0]!
    expect(recipe.title).toBe('Tomatenpasta')
    expect(recipe.description).toBe('Lecker & schnell.\nFür 4 Personen.')
    expect(recipe.servingsText).toBe('4')
    expect(recipe.servingsNumber).toBe(4)
    expect(recipe.prepTime).toBe('20 Min.')
    expect(recipe.cookTime).toBe('30 Min.')
    expect(recipe.totalTime).toBe('50 Min.')
    expect(recipe.cuisine).toEqual(['Italienisch'])
    expect(recipe.dishType).toEqual(['Hauptgericht'])
    expect(recipe.tags).toEqual(['schnell', 'einfach'])

    expect(recipe.ingredients).toHaveLength(5)
    expect(recipe.ingredients[0]).toMatchObject({
      raw: '2 Zwiebeln',
      name: 'Zwiebeln',
      quantity: 2,
      unit: null,
      parseStatus: 'parsed',
    })
    expect(recipe.ingredients[1]).toMatchObject({
      raw: '200 g Mehl',
      name: 'Mehl',
      quantity: 200,
      unit: 'g',
    })
    // Parentheses are never interpreted as a purchase/preparation note.
    expect(recipe.ingredients[3]).toMatchObject({
      raw: '2 Zwiebeln (fein gewürfelt)',
      name: 'Zwiebeln (fein gewürfelt)',
      purchaseNote: '',
      preparationNote: '',
    })
    // Explicit structured note fields are accepted without guessing.
    expect(recipe.ingredients[4]).toMatchObject({
      raw: '1 Prise Salz',
      name: 'Salz',
      quantity: 1,
      unit: 'Prise',
      purchaseNote: 'Meersalz',
      preparationNote: 'fein mahlen',
    })

    expect(recipe.instructions.map((step) => step.text)).toEqual([
      'Teig kneten.',
      '**Für die Sauce**\n\nTomaten kochen.',
      'Abschmecken.',
      'Alles servieren.',
    ])
    expect(recipe.images).toEqual([
      'https://example.com/img1.jpg',
      'https://example.com/img2.jpg',
    ])
    expect(recipe.raw).toEqual(fullRecipe)
  })

  it('keeps decimal commas and double spaces in a recipe-page ingredient list', () => {
    const result = extractRecipeCandidates(
      page([
        {
          '@type': 'Recipe',
          name: 'Afrikanischer Erdnusseintopf mit Hähnchen',
          recipeIngredient: [
            '2  Knoblauchzehen',
            '1,5 TL Kreuzkümmel, wahlweise! (alternativ 1 TL Zimt gemahlen)',
            '1  Peperoni',
            '1,5 EL Honig',
          ],
          recipeInstructions: ['Alles kochen.'],
        },
      ]),
      'https://example.com/erdnuss',
    )
    const amounts = result.candidates[0]!.ingredients.map((ingredient) => ({
      quantity: ingredient.quantity,
      quantityText: ingredient.quantityText,
      unit: ingredient.unit,
      name: ingredient.name,
    }))
    expect(amounts).toEqual([
      { quantity: 2, quantityText: '2', unit: null, name: 'Knoblauchzehen' },
      {
        quantity: 1.5,
        quantityText: '1,5',
        unit: 'TL',
        name: 'Kreuzkümmel, wahlweise! (alternativ 1 TL Zimt gemahlen)',
      },
      { quantity: 1, quantityText: '1', unit: null, name: 'Peperoni' },
      { quantity: 1.5, quantityText: '1,5', unit: 'EL', name: 'Honig' },
    ])
  })

  it('supports multiple blocks, @graph, nested mainEntity and @type variants', () => {
    const first = {
      '@context': 'https://schema.org',
      '@graph': [
        { '@type': 'WebPage', name: 'Startseite' },
        {
          '@type': ['Recipe', 'NewsArticle'],
          name: 'Kartoffelsuppe',
          recipeIngredient: ['500 g Kartoffeln'],
          recipeInstructions: ['Schälen und kochen.'],
          image: 'bilder/suppe.jpg',
        },
      ],
    }
    const second = {
      '@context': 'https://schema.org',
      '@type': 'https://schema.org/Recipe',
      name: 'Salat',
      mainEntity: {
        '@type': 'schema:Recipe',
        name: 'Verschachtelter Salat',
        recipeIngredient: ['1 Kopf Salat'],
      },
    }
    const html = page([first, second], '<base href="https://example.com/base/">')
    const result = extractRecipeCandidates(html, 'https://example.com/rezept')
    expect(result.candidates).toHaveLength(3)
    expect(result.baseUrl).toBe('https://example.com/base/')
    expect(result.candidates[0]?.title).toBe('Kartoffelsuppe')
    expect(result.candidates[0]?.images).toEqual(['https://example.com/base/bilder/suppe.jpg'])
    expect(result.candidates[1]?.title).toBe('Salat')
    expect(result.candidates[2]?.title).toBe('Verschachtelter Salat')
  })

  it('keeps valid blocks when another JSON-LD block is malformed', () => {
    const html = page([
      '{"@type": "Recipe", "name": "Kaputt"',
      {
        '@type': 'Recipe',
        name: 'Gültig',
        recipeIngredient: ['1 Ei'],
      },
    ])
    const result = extractRecipeCandidates(html, 'https://example.com/x')
    expect(result.candidates).toHaveLength(1)
    expect(result.candidates[0]?.title).toBe('Gültig')
    expect(result.warnings.some((warning) => warning.includes('kein gültiges JSON'))).toBe(true)
  })

  it('parses HTML-escaped JSON as a fallback', () => {
    const encoded = JSON.stringify({
      '@type': 'Recipe',
      name: 'Escaped',
      recipeIngredient: ['1 EL Öl'],
    }).replace(/"/g, '&quot;')
    const result = extractRecipeCandidates(page([encoded]), 'https://example.com/x')
    expect(result.candidates).toHaveLength(1)
    expect(result.candidates[0]?.title).toBe('Escaped')
    expect(result.candidates[0]?.ingredients[0]?.name).toBe('Öl')
  })

  it('returns no candidates and an explanation when structured recipe data is missing', () => {
    const empty = extractRecipeCandidates('<html><body>Nur Text</body></html>', 'https://example.com/x')
    expect(empty.candidates).toEqual([])
    expect(empty.jsonLdBlockCount).toBe(0)
    expect(empty.warnings.join(' ')).toContain('keine JSON-LD-Daten')

    const webpage = extractRecipeCandidates(
      page([{ '@type': 'WebPage', name: 'Kein Rezept' }]),
      'https://example.com/x',
    )
    expect(webpage.candidates).toEqual([])
    expect(webpage.jsonLdBlockCount).toBe(1)
    expect(webpage.warnings.join(' ')).toContain('kein Objekt vom Typ schema.org/Recipe')
  })

  it('does not invent missing fields and warns about them', () => {
    const result = extractRecipeCandidates(
      page([{ '@type': 'Recipe', name: '' }]),
      'https://example.com/x',
    )
    const recipe = result.candidates[0]!
    expect(recipe.title).toBe('')
    expect(recipe.description).toBe('')
    expect(recipe.servingsText).toBe('')
    expect(recipe.prepTime).toBe('')
    expect(recipe.ingredients).toEqual([])
    expect(recipe.instructions).toEqual([])
    expect(recipe.warnings.join(' ')).toContain('keinen Titel')
    expect(recipe.warnings.join(' ')).toContain('keine Zutaten')
    expect(recipe.warnings.join(' ')).toContain('keine Anweisungen')
  })

  it('gives duplicate titles distinct stable keys and de-duplicates equal @id values', () => {
    const result = extractRecipeCandidates(
      page([
        {
          '@graph': [
            { '@type': 'Recipe', name: 'Gleich' },
            { '@type': 'Recipe', name: 'Gleich' },
            { '@type': 'Recipe', '@id': '#eins', name: 'Mit ID' },
          ],
        },
        { '@type': 'Recipe', '@id': '#eins', name: 'Mit ID doppelt' },
      ]),
      'https://example.com/x',
    )
    expect(result.candidates.map((recipe) => recipe.key)).toEqual([
      'title:gleich',
      'title:gleich#2',
      'id:https://example.com/x#eins',
    ])
  })

  it('reads free-text instructions, sections and structured ingredient descriptions', () => {
    const result = extractRecipeCandidates(
      page([
        {
          '@type': 'Recipe',
          name: 'Freitext',
          recipeIngredient: [
            { name: 'Zwiebeln', amount: '2', unitText: 'Stück', description: 'fein würfeln' },
            { name: 'Salz', purchaseNote: 'Meersalz' },
          ],
          recipeInstructions:
            '<ol><li>Erster Schritt</li><li>Zweiter Schritt</li></ol>',
          image: 'data:image/png;base64,AAAA',
        },
      ]),
      'https://example.com/x',
    )
    const recipe = result.candidates[0]!
    expect(recipe.instructions.map((step) => step.text)).toEqual([
      'Erster Schritt',
      'Zweiter Schritt',
    ])
    expect(recipe.ingredients[0]).toMatchObject({
      raw: '2 Stück Zwiebeln fein würfeln',
      name: 'Zwiebeln fein würfeln',
      quantity: 2,
      unit: 'Stück',
      preparationNote: '',
    })
    expect(recipe.ingredients[1]).toMatchObject({
      name: 'Salz',
      purchaseNote: 'Meersalz',
    })
    expect(recipe.images).toEqual([])
    expect(recipe.warnings.join(' ')).toContain('Data-URL-Bild')
  })
})

describe('htmlToText', () => {
  it('strips tags, decodes entities and keeps block breaks', () => {
    expect(htmlToText('<p>A &amp; B</p><p>C</p>')).toBe('A & B\nC')
    expect(htmlToText('a<br>b')).toBe('a\nb')
  })
})
