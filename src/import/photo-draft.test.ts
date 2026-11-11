import { describe, expect, it } from 'vitest'
import type { OcrRecipe } from './photo-ocr'
import {
  buildPhotoRecipe,
  draftFromOcrRecipe,
  isUnrecognizedOcrRecipe,
  photoDraftNotices,
  photoImportId,
} from './photo-draft'

function ocrRecipe(overrides: Partial<OcrRecipe> = {}): OcrRecipe {
  return {
    recognized: true,
    title: '  Omas Apfelkuchen  ',
    description: 'Familienrezept aus dem Heft.',
    servingsText: '4 Portionen',
    prepTime: '20 Min.',
    cookTime: '50 Min.',
    totalTime: '1 Std. 10 Min.',
    notes: 'Backofen vorheizen.',
    ingredients: [
      {
        group: 'Teig',
        quantity: '250',
        unit: 'g',
        name: 'Mehl',
        purchaseNote: '',
        preparationNote: 'gesiebt',
        uncertain: false,
        uncertainty: '',
      },
      {
        group: 'Teig',
        quantity: '1/2',
        unit: 'TL',
        name: 'Salz',
        purchaseNote: '',
        preparationNote: '',
        uncertain: false,
        uncertainty: '',
      },
      {
        group: 'Belag',
        quantity: '2-3',
        unit: '',
        name: 'Äpfel',
        purchaseNote: 'bevorzugt Boskoop',
        preparationNote: '',
        uncertain: true,
        uncertainty: 'Anzahl evtl. 4',
      },
      {
        group: '',
        quantity: '',
        unit: '',
        name: '   ',
        purchaseNote: '',
        preparationNote: '',
        uncertain: false,
        uncertainty: '',
      },
    ],
    steps: [
      { text: 'Mehl und Salz mischen.', uncertain: false, uncertainty: '' },
      { text: 'Äpfel schneiden und backen.', uncertain: true, uncertainty: 'Temperatur unleserlich' },
      { text: '   ', uncertain: false, uncertainty: '' },
    ],
    uncertainties: [{ reference: 'Schritt 2, Temperatur', note: 'Evtl. 180 °C.' }],
    warnings: ['Eine Zutat war unleserlich.'],
    ...overrides,
  }
}

describe('draftFromOcrRecipe', () => {
  it('maps the validated OCR recipe onto the existing editable draft', () => {
    const draft = draftFromOcrRecipe(ocrRecipe())

    expect(draft.title).toBe('Omas Apfelkuchen')
    expect(draft.description).toBe('Familienrezept aus dem Heft.')
    expect(draft.servingsText).toBe('4 Portionen')
    expect(draft.prepTime).toBe('20 Min.')
    expect(draft.cookTime).toBe('50 Min.')
    expect(draft.totalTime).toBe('1 Std. 10 Min.')
    expect(draft.notes).toBe('Backofen vorheizen.')
    expect(draft.sourceUrl).toBe('')
    expect(draft.favorite).toBe(false)
    expect(draft.wantToCook).toBe(false)
    expect(draft.cuisine).toEqual([])
    expect(draft.tags).toEqual([])

    expect(draft.ingredients).toHaveLength(3)
    expect(draft.ingredients[0]).toMatchObject({
      group: 'Teig',
      quantity: '250',
      unit: 'g',
      name: 'Mehl',
      preparationNote: 'gesiebt',
    })
    expect(draft.ingredients[1]).toMatchObject({
      quantity: '1/2',
      unit: 'TL',
      name: 'Salz',
    })
    expect(draft.ingredients[2]).toMatchObject({
      group: 'Belag',
      quantity: '2-3',
      unit: '',
      name: 'Äpfel',
      purchaseNote: 'bevorzugt Boskoop',
    })
    expect(draft.steps.map((step) => step.text)).toEqual([
      'Mehl und Salz mischen.',
      'Äpfel schneiden und backen.',
    ])
  })

  it('produces a draft whose existing build path preserves quantities', () => {
    const draft = draftFromOcrRecipe(ocrRecipe())
    const recipe = buildPhotoRecipe(draft, {
      model: 'test-model',
      pageCount: 2,
      recognizedAt: 123,
    })
    const mehl = recipe.ingredients.find((ingredient) => ingredient.name === 'Mehl')
    expect(mehl?.quantity).toBe(250)
    expect(mehl?.quantityText).toBe('250')
    expect(mehl?.unit).toBe('g')
    expect(mehl?.raw).toBe('250 g Mehl')
    const salz = recipe.ingredients.find((ingredient) => ingredient.name === 'Salz')
    expect(salz?.quantityText).toBe('1/2')
    expect(salz?.quantity).toBe(0.5)
    const aepfel = recipe.ingredients.find((ingredient) => ingredient.name === 'Äpfel')
    expect(aepfel?.quantityText).toBe('2-3')
    expect(aepfel?.quantity).toBe(2)
    expect(recipe.ingredientGroups.map((group) => group.title)).toEqual(['Teig', 'Belag'])
  })
})

describe('photoDraftNotices', () => {
  it('lists uncertainties, unsure ingredients, steps and pages with references', () => {
    const notices = photoDraftNotices(ocrRecipe(), [
      { index: 0, kind: 'recipe', note: '' },
      { index: 1, kind: 'unclear', note: 'Handschrift nicht lesbar.' },
      { index: 2, kind: 'not-a-recipe', note: '' },
    ])

    expect(notices).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          reference: 'Schritt 2, Temperatur',
          text: 'Evtl. 180 °C.',
        }),
        expect.objectContaining({
          reference: 'Zutat 3 (Äpfel)',
          text: 'Anzahl evtl. 4',
        }),
        expect.objectContaining({
          reference: 'Schritt 2',
          text: 'Temperatur unleserlich',
        }),
        expect.objectContaining({ text: 'Eine Zutat war unleserlich.' }),
        expect.objectContaining({
          reference: 'Seite 2',
          text: 'Handschrift nicht lesbar.',
        }),
        expect.objectContaining({
          reference: 'Seite 3',
          text: expect.stringContaining('kein Rezept'),
        }),
      ]),
    )
  })

  it('does not duplicate identical notices', () => {
    const recipe = ocrRecipe({
      uncertainties: [
        { reference: 'Zutat 3', note: 'Menge unklar' },
        { reference: 'Zutat 3', note: 'Menge unklar' },
      ],
      ingredients: [],
      steps: [],
      warnings: [],
    })
    const notices = photoDraftNotices(recipe)
    expect(notices.filter((notice) => notice.text === 'Menge unklar')).toHaveLength(1)
  })

  it('reports an empty list for a clean answer', () => {
    const clean = ocrRecipe({
      ingredients: [
        {
          group: '',
          quantity: '1',
          unit: 'Stk.',
          name: 'Ei',
          purchaseNote: '',
          preparationNote: '',
          uncertain: false,
          uncertainty: '',
        },
      ],
      steps: [{ text: 'Kochen.', uncertain: false, uncertainty: '' }],
      uncertainties: [],
      warnings: [],
    })
    expect(photoDraftNotices(clean, [{ index: 0, kind: 'recipe', note: '' }])).toEqual([])
  })
})

describe('buildPhotoRecipe', () => {
  it('stores the photo origin and raw metadata through the existing builder', () => {
    const draft = draftFromOcrRecipe(ocrRecipe())
    const recipe = buildPhotoRecipe(draft, {
      model: '@cf/meta/llama-4-scout-17b-16e-instruct',
      pageCount: 3,
      recognizedAt: 1_700_000_000_000,
      pages: [
        { index: 0, kind: 'recipe', note: '' },
        { index: 1, kind: 'continuation', note: '' },
        { index: 2, kind: 'unclear', note: 'Seite schwer lesbar' },
      ],
      uncertainties: [{ reference: 'Seite 3', note: 'Schwer lesbar' }],
      warnings: ['Zwei Seiten zusammengeführt.'],
    })

    expect(recipe.importSource).toBe('photo')
    expect(recipe.importId).toMatch(/^photo-1700000000000-[A-Za-z0-9]+$/)
    expect(recipe.title).toBe('Omas Apfelkuchen')
    expect(recipe.sourceUrl).toBe('')
    expect(recipe.importMeta).toBeUndefined()
    expect(recipe.raw).toMatchObject({
      source: 'photo-ocr',
      contractVersion: 1,
      model: '@cf/meta/llama-4-scout-17b-16e-instruct',
      pageCount: 3,
      recognizedAt: 1_700_000_000_000,
      warnings: ['Zwei Seiten zusammengeführt.'],
    })
    expect(recipe.raw.pages).toHaveLength(3)
    expect(recipe.raw.uncertainties).toEqual([{ reference: 'Seite 3', note: 'Schwer lesbar' }])
  })

  it('uses an explicit import id and keeps the editable corrections', () => {
    const draft = draftFromOcrRecipe(ocrRecipe())
    draft.title = 'Korrigierter Titel'
    const recipe = buildPhotoRecipe(draft, {
      model: 'test',
      pageCount: 1,
      recognizedAt: 5,
      importId: 'photo-fest',
    })
    expect(recipe.importId).toBe('photo-fest')
    expect(recipe.title).toBe('Korrigierter Titel')
  })

  it('generates sanitised photo import ids', () => {
    expect(photoImportId(42, 'ab/cd ef')).toBe('photo-42-abcdef')
    expect(photoImportId(42).startsWith('photo-42-')).toBe(true)
  })
})

describe('isUnrecognizedOcrRecipe', () => {
  it('detects answers without any recipe content', () => {
    expect(
      isUnrecognizedOcrRecipe({
        ...ocrRecipe(),
        recognized: false,
        ingredients: [],
        steps: [],
      }),
    ).toBe(true)
    expect(isUnrecognizedOcrRecipe(ocrRecipe())).toBe(false)
  })
})
