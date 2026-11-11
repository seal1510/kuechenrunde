import { describe, expect, it } from 'vitest'
import {
  OcrFormatError,
  applyOcrConsistencyChecks,
  extractJsonObject,
  splitQuantityAndUnit,
  validateOcrPageReports,
  validateOcrRecipe,
  type OcrRecipe,
} from './photo-ocr'

function minimalRecipe(overrides: Record<string, unknown> = {}): unknown {
  return {
    recognized: true,
    title: 'Testrezept',
    ingredients: [{ quantity: '250', unit: 'g', name: 'Mehl' }],
    steps: [{ text: 'Alles verrühren.' }],
    ...overrides,
  }
}

describe('extractJsonObject', () => {
  it('reads plain, fenced and prefixed JSON', () => {
    expect(extractJsonObject('{"a":1}')).toEqual({ a: 1 })
    expect(extractJsonObject('```json\n{"a":1}\n```')).toEqual({ a: 1 })
    expect(extractJsonObject('Hier ist das Rezept:\n{"a":1}\nViel Spaß.')).toEqual({ a: 1 })
  })

  it('rejects missing or invalid JSON', () => {
    expect(() => extractJsonObject('')).toThrow(OcrFormatError)
    expect(() => extractJsonObject('Kein JSON')).toThrow(OcrFormatError)
    expect(() => extractJsonObject('{"a":')).toThrow(OcrFormatError)
  })
})

describe('validateOcrRecipe', () => {
  it('normalizes strings, drops empty rows and generic "Zutaten" groups', () => {
    const recipe = validateOcrRecipe(
      minimalRecipe({
        title: '  Testrezept  ',
        ingredients: [
          { quantity: ' 250 ', unit: ' g ', name: ' Mehl ', group: 'Zutaten' },
          { name: '' },
        ],
        steps: [{ text: '  Alles verrühren.  ' }, { text: '   ' }],
        warnings: ['  Hinweis  ', ''],
      }),
    )
    expect(recipe.title).toBe('Testrezept')
    expect(recipe.ingredients).toHaveLength(1)
    expect(recipe.ingredients[0]?.group).toBe('')
    expect(recipe.ingredients[0]?.quantity).toBe('250')
    expect(recipe.steps).toHaveLength(1)
    // Die vorhandene Modell-Warnung bleibt erhalten; zusätzlich macht die
    // Validierung den stillen Verlust der leeren Zeilen sichtbar.
    expect(recipe.warnings[0]).toBe('Hinweis')
    expect(recipe.warnings.join(' ')).toContain('Zutatenzeile')
    expect(recipe.warnings.join(' ')).toContain('Zubereitungsschritt')
  })

  it('warns instead of silently accepting a recipe without ingredients or steps', () => {
    const withoutIngredients = validateOcrRecipe(
      minimalRecipe({ ingredients: [], steps: [{ text: 'Alles verrühren.' }] }),
    )
    expect(withoutIngredients.recognized).toBe(true)
    expect(withoutIngredients.warnings.join(' ')).toContain('keine Zutaten')

    const withoutSteps = validateOcrRecipe(
      minimalRecipe({ ingredients: [{ quantity: '250', unit: 'g', name: 'Mehl' }], steps: [] }),
    )
    expect(withoutSteps.warnings.join(' ')).toContain('keine Zubereitungsschritte')
  })

  it('derives recognized=false and adds a warning when no recipe content exists', () => {
    const recipe = validateOcrRecipe({ title: '', ingredients: [], steps: [] })
    expect(recipe.recognized).toBe(false)
    expect(recipe.warnings).toContain('Kein Rezept erkannt.')
  })

  it('rejects wrong types instead of guessing', () => {
    expect(() => validateOcrRecipe([])).toThrow(OcrFormatError)
    expect(() => validateOcrRecipe(minimalRecipe({ title: 42 }))).toThrow(OcrFormatError)
    expect(() => validateOcrRecipe(minimalRecipe({ ingredients: 'Mehl' }))).toThrow(OcrFormatError)
  })
})

describe('validateOcrPageReports', () => {
  it('synthesizes a report when the model omits pages', () => {
    expect(validateOcrPageReports(undefined, 2)).toEqual([
      { index: 0, kind: 'recipe', note: '' },
      { index: 1, kind: 'recipe', note: '' },
    ])
  })

  it('keeps a complete per-page report and rejects a mismatched page count', () => {
    expect(
      validateOcrPageReports(
        [
          { index: 0, kind: 'recipe', note: '' },
          { index: 1, kind: 'continuation', note: 'Fortsetzung' },
        ],
        2,
      ),
    ).toHaveLength(2)
    expect(() =>
      validateOcrPageReports([{ index: 0, kind: 'recipe', note: '' }], 2),
    ).toThrow(OcrFormatError)
  })
})

describe('splitQuantityAndUnit', () => {
  it('splits a merged amount and known unit', () => {
    expect(splitQuantityAndUnit('2 EL', '')).toEqual({ quantity: '2', unit: 'EL' })
    expect(splitQuantityAndUnit('200 g', '')).toEqual({ quantity: '200', unit: 'g' })
    expect(splitQuantityAndUnit('1 Pck.', '')).toEqual({ quantity: '1', unit: 'Pck.' })
    expect(splitQuantityAndUnit('1/2 TL', '')).toEqual({ quantity: '1/2', unit: 'TL' })
    expect(splitQuantityAndUnit('1 1/2 Tassen', '')).toEqual({ quantity: '1 1/2', unit: 'Tassen' })
  })

  it('never guesses unknown units or overwrites an existing unit', () => {
    expect(splitQuantityAndUnit('2 Handvoll', '')).toEqual({ quantity: '2 Handvoll', unit: '' })
    expect(splitQuantityAndUnit('2 EL', 'g')).toEqual({ quantity: '2 EL', unit: 'g' })
    expect(splitQuantityAndUnit('3', '')).toEqual({ quantity: '3', unit: '' })
    expect(splitQuantityAndUnit('', '')).toEqual({ quantity: '', unit: '' })
  })
})

describe('applyOcrConsistencyChecks', () => {
  function recipe(
    ingredients: OcrRecipe['ingredients'],
    steps: OcrRecipe['steps'] = [],
  ): OcrRecipe {
    return {
      recognized: true,
      title: 'Testrezept',
      description: '',
      servingsText: '',
      prepTime: '',
      cookTime: '',
      totalTime: '',
      notes: '',
      ingredients,
      steps,
      uncertainties: [],
      warnings: [],
    }
  }

  it('flags the same ingredient with different amounts as uncertain', () => {
    const checked = applyOcrConsistencyChecks(
      recipe([
        {
          group: '',
          quantity: '200',
          unit: 'g',
          name: 'Zucker',
          purchaseNote: '',
          preparationNote: '',
          uncertain: false,
          uncertainty: '',
        },
        {
          group: '',
          quantity: '180',
          unit: 'g',
          name: 'zucker',
          purchaseNote: '',
          preparationNote: '',
          uncertain: false,
          uncertainty: '',
        },
      ]),
    )
    expect(checked.ingredients[0]?.uncertain).toBe(true)
    expect(checked.ingredients[1]?.uncertain).toBe(true)
    expect(checked.ingredients[1]?.uncertainty).toContain('mehrfach')
    expect(checked.uncertainties).toHaveLength(1)
    expect(checked.uncertainties[0]?.reference).toBe('Zutat 2 (zucker)')
    expect(checked.uncertainties[0]?.note).toContain('200 g')
    expect(checked.uncertainties[0]?.note).toContain('180 g')
  })

  it('marks an ingredient that looks like a preparation step', () => {
    const checked = applyOcrConsistencyChecks(
      recipe(
        [
          {
            group: 'Fleisch',
            quantity: '',
            unit: '',
            name: 'marinieren',
            purchaseNote: '',
            preparationNote: '',
            uncertain: false,
            uncertainty: '',
          },
        ],
        [],
      ),
    )
    expect(checked.ingredients[0]?.uncertain).toBe(true)
    expect(checked.ingredients[0]?.uncertainty).toContain('Zubereitungsschritt')
    expect(checked.uncertainties).toHaveLength(1)
  })

  it('marks a step that looks like an ingredient line but leaves real steps alone', () => {
    const step = (text: string): OcrRecipe['steps'][number] => ({
      text,
      uncertain: false,
      uncertainty: '',
    })
    const checked = applyOcrConsistencyChecks(
      recipe(
        [
          {
            group: '',
            quantity: '250',
            unit: 'g',
            name: 'Mehl',
            purchaseNote: '',
            preparationNote: '',
            uncertain: false,
            uncertainty: '',
          },
        ],
        [
          step('250 g Mehl und 2 EL Zucker verrühren.'),
          step('10 Minuten kochen.'),
          step('Teig 30 Minuten ruhen lassen.'),
          step('2 EL Olivenöl'),
        ],
      ),
    )
    expect(checked.steps[0]?.uncertain).toBe(false)
    // "250 g Mehl ..." enthält ein Handlungsverb (verrühren) → kein Hinweis.
    expect(checked.steps[0]?.uncertainty).toBe('')
    expect(checked.steps[1]?.uncertain).toBe(false)
    expect(checked.steps[2]?.uncertain).toBe(false)
    // Reine Zutatenzeile als Schritt → markiert, aber nicht verschoben.
    expect(checked.steps[3]?.uncertain).toBe(true)
    expect(checked.steps[3]?.uncertainty).toContain('Zutatenzeile')
  })

  it('is idempotent and leaves identical duplicate amounts alone', () => {
    const source = recipe([
      {
        group: '',
        quantity: '1',
        unit: 'TL',
        name: 'Salz',
        purchaseNote: '',
        preparationNote: '',
        uncertain: false,
        uncertainty: '',
      },
      {
        group: '',
        quantity: '1',
        unit: 'TL',
        name: 'Salz',
        purchaseNote: '',
        preparationNote: '',
        uncertain: false,
        uncertainty: '',
      },
    ])
    const once = applyOcrConsistencyChecks(source)
    const twice = applyOcrConsistencyChecks(once)
    expect(once.uncertainties).toHaveLength(0)
    expect(twice.uncertainties).toHaveLength(0)

    const changed = applyOcrConsistencyChecks(
      recipe([
        {
          group: '',
          quantity: '1',
          unit: 'TL',
          name: 'Salz',
          purchaseNote: '',
          preparationNote: '',
          uncertain: false,
          uncertainty: '',
        },
        {
          group: '',
          quantity: '2',
          unit: 'TL',
          name: 'Salz',
          purchaseNote: '',
          preparationNote: '',
          uncertain: false,
          uncertainty: '',
        },
      ]),
    )
    expect(applyOcrConsistencyChecks(changed).uncertainties).toHaveLength(1)
  })
})
