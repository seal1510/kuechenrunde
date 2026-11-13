import { describe, expect, it } from 'vitest'
import {
  OcrFormatError,
  applyOcrConsistencyChecks,
  buildOcrAssemblyPayload,
  extractJsonObject,
  isPlausibleOcrAssemblySteps,
  isSafeIngredientCleanup,
  mergePhotoOcrUsage,
  splitQuantityAndUnit,
  validateOcrAssemblySteps,
  validateOcrPageReports,
  validateOcrPolish,
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

describe('buildOcrAssemblyPayload', () => {
  it('liefert nummerierbare Transkriptionszeilen und die validierten Zutaten', () => {
    const recipe = validateOcrRecipe(
      minimalRecipe({
        ingredients: [
          { group: 'Teig', quantity: '250', unit: 'g', name: 'Mehl', purchaseNote: 'Type 550' },
        ],
      }),
    )
    const payload = buildOcrAssemblyPayload(recipe, '  Titel  \n\n1 EL Öl\r\nAlles mischen.\n')
    expect(payload.transcriptionLines).toEqual(['Titel', '1 EL Öl', 'Alles mischen.'])
    expect(payload.ingredients).toEqual([
      {
        index: 1,
        group: 'Teig',
        quantity: '250',
        unit: 'g',
        name: 'Mehl',
        purchaseNote: 'Type 550',
        preparationNote: '',
      },
    ])
  })

  it('begrenzt eine überlange Transkription, ohne undefined weiterzureichen', () => {
    expect(buildOcrAssemblyPayload(validateOcrRecipe(minimalRecipe()), '')).toEqual({
      transcriptionLines: [],
      ingredients: [
        {
          index: 1,
          group: '',
          quantity: '250',
          unit: 'g',
          name: 'Mehl',
          purchaseNote: '',
          preparationNote: '',
        },
      ],
    })
  })
})

describe('validateOcrAssemblySteps', () => {
  it('akzeptiert zusätzliche Modellfelder und verwirft sie', () => {
    const steps = validateOcrAssemblySteps({
      usageCheck: [{ ingredient: 'Mehl', step: 1 }],
      steps: [
        { text: '  Mehl und Wasser verrühren.  ', uncertain: false, uncertainty: '', sourceLines: [2, 3] },
      ],
    })
    expect(steps).toEqual([
      { text: 'Mehl und Wasser verrühren.', uncertain: false, uncertainty: '' },
    ])
    expect(steps[0]).not.toHaveProperty('sourceLines')
  })

  it('sortiert Schritte anhand der Quellzeilen in die Originalreihenfolge', () => {
    const steps = validateOcrAssemblySteps({
      steps: [
        { text: 'Zweiter Schritt.', sourceLines: [5] },
        { text: 'Erster Schritt.', sourceLines: [2] },
        { text: 'Dritter Schritt.', sourceLines: [7] },
      ],
    })
    expect(steps.map((step) => step.text)).toEqual([
      'Erster Schritt.',
      'Zweiter Schritt.',
      'Dritter Schritt.',
    ])
  })

  it('stellt eine zurückgeführte Zutat hinter das Pürieren/Einrühren der Soße', () => {
    const steps = validateOcrAssemblySteps({
      steps: [
        { text: 'Die Soße anbraten.', sourceLines: [2] },
        { text: 'Das Fleisch wieder zur Soße geben.', sourceLines: [3] },
        { text: 'Die Soße pürieren.', sourceLines: [5] },
        { text: 'Den Joghurt einrühren.', sourceLines: [6] },
        { text: 'Mit Kräutern bestreuen.', sourceLines: [7] },
      ],
    })
    expect(steps.map((step) => step.text)).toEqual([
      'Die Soße anbraten.',
      'Die Soße pürieren.',
      'Den Joghurt einrühren.',
      'Das Fleisch wieder zur Soße geben.',
      'Mit Kräutern bestreuen.',
    ])
  })

  it('zieht unsichere Rekonstruktionsschritte nicht anhand falscher Quellzeilen nach vorn', () => {
    const steps = validateOcrAssemblySteps({
      steps: [
        { text: 'Erster Schritt.', sourceLines: [4] },
        { text: 'Zweiter Schritt.', sourceLines: [8] },
        {
          text: 'Wieder hinzugeben.',
          uncertain: true,
          uncertainty: 'rekonstruiert',
          sourceLines: [4],
        },
        { text: 'Bestreuen.', sourceLines: [15] },
      ],
    })
    expect(steps.map((step) => step.text)).toEqual([
      'Erster Schritt.',
      'Zweiter Schritt.',
      'Wieder hinzugeben.',
      'Bestreuen.',
    ])
  })

  it('lässt die Modellreihenfolge stehen, wenn Quellzeilen fehlen', () => {
    const steps = validateOcrAssemblySteps({
      steps: [{ text: 'Erst.' }, { text: 'Dann.' }],
    })
    expect(steps.map((step) => step.text)).toEqual(['Erst.', 'Dann.'])
  })

  it('lehnt fehlende, leere oder falsche Schritte ab', () => {
    expect(() => validateOcrAssemblySteps(null)).toThrow(OcrFormatError)
    expect(() => validateOcrAssemblySteps({ steps: 'keine Liste' })).toThrow(OcrFormatError)
    expect(() => validateOcrAssemblySteps({ steps: [] })).toThrow(OcrFormatError)
    expect(() => validateOcrAssemblySteps({ steps: [{ text: '   ' }] })).toThrow(OcrFormatError)
  })
})

describe('isSafeIngredientCleanup', () => {
  it('erlaubt nur sprachliche Bereinigungen, keine inhaltliche Ersetzung', () => {
    expect(isSafeIngredientCleanup('Pomito Tomaten (frucht fleisch)', 'Pomito Tomatenfruchtfleisch')).toBe(true)
    expect(isSafeIngredientCleanup('tandoori Sherwood- M.', 'Tandoori Sherwood-Mischung')).toBe(true)
    expect(isSafeIngredientCleanup('Chilies', 'Chilis')).toBe(true)
    expect(isSafeIngredientCleanup('Petersilie', 'Pfefferminze')).toBe(false)
    expect(isSafeIngredientCleanup('Mehl', 'Zucker')).toBe(false)
  })
})

describe('validateOcrPolish', () => {
  const source = (): OcrRecipe =>
    validateOcrRecipe(
      minimalRecipe({
        ingredients: [
          { group: 'Teig', quantity: '250', unit: 'g', name: 'Mehl' },
          { group: 'Füllung', quantity: '1', unit: 'TL', name: 'Zucker' },
        ],
        steps: [
          { text: 'Mehl und Zucker verrühren und backen lassen.' },
          { text: 'Den Teig ruhen lassen.' },
        ],
      }),
    )

  it('wendet sichere Namens- und Gruppenkorrekturen an, ohne Mengen zu ändern', () => {
    const result = validateOcrPolish(source(), {
      ingredients: [
        { index: 1, name: 'Mehl (Weizen)', group: 'Teig', uncertain: false, uncertainty: '' },
        { index: 2, name: 'Zucker', group: 'Teig', uncertain: false, uncertainty: '' },
      ],
      steps: [
        { text: 'Mehl und Zucker zu einem Teig verrühren und backen.', sourceLines: [1] },
        { text: 'Den Teig vor dem Backen ruhen lassen.', sourceLines: [2] },
      ],
    })
    expect(result.appliedIngredientList).toBe(true)
    expect(result.adjustedNames).toBe(1)
    expect(result.recipe.ingredients[0]?.name).toBe('Mehl (Weizen)')
    expect(result.recipe.ingredients[0]?.quantity).toBe('250')
    expect(result.recipe.ingredients[0]?.unit).toBe('g')
    expect(result.recipe.ingredients[1]?.group).toBe('Teig')
  })

  it('verwirft unsichere Namensänderungen und unbekannte Gruppen, behält das Original', () => {
    const result = validateOcrPolish(source(), {
      ingredients: [
        { index: 1, name: 'Pfefferminze', group: 'Gewürze' },
        { index: 2, name: 'Zucker', group: 'Füllung' },
      ],
      steps: [{ text: 'Mehl und Zucker verrühren und backen lassen.', sourceLines: [1, 2] }],
    })
    expect(result.rejectedNames).toBe(1)
    expect(result.rejectedGroups).toBe(1)
    expect(result.recipe.ingredients[0]?.name).toBe('Mehl')
    expect(result.recipe.ingredients[0]?.group).toBe('Teig')
  })

  it('ordnet Zutaten ohne Gruppenangabe der vorherigen Gruppe zu', () => {
    const recipe = validateOcrRecipe(
      minimalRecipe({
        ingredients: [
          { group: 'Soße', quantity: '250', unit: 'ml', name: 'Joghurt' },
          { group: '', quantity: '1', unit: 'TL', name: 'Petersilie' },
        ],
        steps: [{ text: 'Joghurt und Petersilie verrühren und servieren.' }],
      }),
    )
    const result = validateOcrPolish(
      recipe,
      {
        ingredients: [
          { index: 1, name: 'Joghurt', group: 'Soße' },
          { index: 2, name: 'Petersilie', group: '' },
        ],
        steps: [{ text: 'Joghurt und Petersilie verrühren und servieren.', sourceLines: [1] }],
      },
      'Fleisch\nSoße\n250 ml Joghurt\n1 TL Petersilie\nBeilage\nReis',
    )
    expect(result.recipe.ingredients[1]?.group).toBe('Soße')
  })

  it('ersetzt erfundene Gruppen anhand der sichtbaren Überschriften', () => {
    const recipe = validateOcrRecipe(
      minimalRecipe({
        ingredients: [
          { group: 'Fleisch', quantity: '600', unit: 'g', name: 'Hähnchenbrust' },
          { group: 'Soße', quantity: '250', unit: 'ml', name: 'Joghurt' },
          { group: 'Garnitur', quantity: '1', unit: 'TL', name: 'Petersilie' },
          { group: 'Beilage', quantity: '', unit: '', name: 'Reis' },
        ],
        steps: [{ text: 'Alles zubereiten und servieren.' }],
      }),
    )
    const transcription = 'Fleisch\n600 g Hähnchenbrust\nSoße\n250 ml Joghurt\n1 TL Petersilie\nBeilage\nReis'
    const result = validateOcrPolish(
      recipe,
      {
        ingredients: [
          { index: 1, name: 'Hähnchenbrust', group: 'Fleisch' },
          { index: 2, name: 'Joghurt', group: 'Soße' },
          { index: 3, name: 'Petersilie', group: 'Garnitur' },
          { index: 4, name: 'Reis', group: 'Beilage' },
        ],
        steps: [{ text: 'Alles zubereiten und servieren.', sourceLines: [1] }],
      },
      transcription,
    )
    expect(result.recipe.ingredients[2]?.group).toBe('Soße')
    expect(result.rejectedGroups).toBe(1)
  })

  it('sortiert Schritte anhand der Quellzeilen und ignoriert Zusatzfelder', () => {
    const result = validateOcrPolish(source(), {
      usageCheck: [{ ingredient: 'Mehl', step: 1 }],
      steps: [
        { text: 'Zweiter Schritt.', sourceLines: [2] },
        { text: 'Erster Schritt.', sourceLines: [1] },
      ],
    })
    expect(result.recipe.steps.map((step) => step.text)).toEqual([
      'Erster Schritt.',
      'Zweiter Schritt.',
    ])
    expect(result.appliedIngredientList).toBe(false)
  })
})

describe('isPlausibleOcrAssemblySteps', () => {
  const recipe = (): OcrRecipe =>
    validateOcrRecipe(
      minimalRecipe({
        ingredients: [
          { quantity: '250', unit: 'g', name: 'Mehl' },
          { quantity: '2', unit: '', name: 'Eier' },
          { quantity: '100', unit: 'ml', name: 'Milch' },
          { quantity: '1', unit: 'TL', name: 'Salz' },
        ],
        steps: [
          { text: 'Mehl, Eier, Milch und Salz verrühren.' },
          { text: 'Teig ruhen lassen.' },
          { text: 'Backen.' },
          { text: 'Abkühlen lassen.' },
        ],
      }),
    )
  const step = (text: string): { text: string; uncertain: boolean; uncertainty: string } => ({
    text,
    uncertain: false,
    uncertainty: '',
  })

  it('akzeptiert eine vollständige, plausible Schrittliste', () => {
    expect(
      isPlausibleOcrAssemblySteps(
        [
          step('Mehl, Eier, Milch und Salz zu einem Teig verrühren.'),
          step('Den Teig ruhen lassen und anschließend backen.'),
          step('Den Kuchen abkühlen lassen.'),
        ],
        recipe(),
      ),
    ).toBe(true)
  })

  it('verwirft einzelne oder inhaltsleere Fehlantworten', () => {
    expect(isPlausibleOcrAssemblySteps([], recipe())).toBe(false)
    expect(isPlausibleOcrAssemblySteps([step('Kurz.')], recipe())).toBe(false)
  })

  it('akzeptiert gute Schritte mit generischen Bezügen (keine Zutatenwiederholung)', () => {
    // Gute Rezepte verweisen oft auf „die Masse“ oder „die Soße“, statt alle
    // Zutaten erneut aufzuzählen. Das darf nicht als unplausibel gelten.
    expect(
      isPlausibleOcrAssemblySteps(
        [
          step('Die Zutaten zu einem Teig verrühren.'),
          step('Die Masse in die Form geben.'),
          step('Den Teig backen und abkühlen lassen.'),
        ],
        recipe(),
      ),
    ).toBe(true)
  })

  it('verwirft wiederholte oder ausufernde Listen', () => {
    expect(
      isPlausibleOcrAssemblySteps(
        [step('Den Teig verrühren und backen.'), step('Den Teig verrühren und backen.')],
        recipe(),
      ),
    ).toBe(false)
    const many = Array.from({ length: 14 }, (_, index) => step(`Schritt Nummer ${index} ausführen.`))
    expect(isPlausibleOcrAssemblySteps(many, recipe())).toBe(false)
  })
})

describe('mergePhotoOcrUsage', () => {
  it('summiert vorhandene Tokenzahlen und lässt fehlende null', () => {
    expect(
      mergePhotoOcrUsage(
        { promptTokens: 100, completionTokens: 20 },
        { promptTokens: 50, completionTokens: null },
      ),
    ).toEqual({ promptTokens: 150, completionTokens: 20 })
    expect(
      mergePhotoOcrUsage(
        { promptTokens: null, completionTokens: null },
        { promptTokens: null, completionTokens: null },
      ),
    ).toEqual({ promptTokens: null, completionTokens: null })
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
