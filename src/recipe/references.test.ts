import { describe, expect, it } from 'vitest'
import type { Ingredient, Instruction, InstructionReference } from '../types'
import {
  computeRemainingQuantity,
  normalizeInstructionList,
  normalizeReferenceAnchors,
  parseQuantityPrefix,
  reconcileReferenceAnchors,
  renderRecipeInstructions,
  resolveReferenceAnchor,
} from './references'

function ingredient(overrides: Partial<Ingredient> = {}): Ingredient {
  return {
    id: 'ing-1',
    groupId: null,
    position: 0,
    raw: '2 Zwiebeln',
    name: 'Zwiebeln',
    quantity: 2,
    quantityText: '2',
    unit: null,
    parseStatus: 'parsed',
    links: [],
    ...overrides,
  }
}

function reference(overrides: Partial<InstructionReference> = {}): InstructionReference {
  return {
    id: 'ref-1',
    ingredientId: 'ing-1',
    anchor: '2',
    anchorOffset: 4,
    quantity: { kind: 'full' },
    ...overrides,
  }
}

function instruction(text: string, references: InstructionReference[] = []): Instruction {
  return { id: 'step-1', position: 0, raw: text, text, references }
}

function render(
  instructions: Instruction[],
  ingredients: Ingredient[],
  originalServings: number | null,
  targetServings: number,
  autoScale = true,
  linkIngredients = true,
) {
  return renderRecipeInstructions(instructions, ingredients, {
    originalServings,
    targetServings,
    autoScale,
    linkIngredients,
  })
}

describe('parseQuantityPrefix', () => {
  it('extracts the longest readable amount and leaves unit/name literal', () => {
    expect(parseQuantityPrefix('400 g Hackfleisch')).toEqual({
      text: '400',
      start: 0,
      end: 3,
    })
    expect(parseQuantityPrefix('Die 2-3 Zwiebeln')).toEqual({
      text: '2-3',
      start: 4,
      end: 7,
    })
    expect(parseQuantityPrefix('ca. 1 1/2 Tassen')).toEqual({
      text: 'ca. 1 1/2',
      start: 0,
      end: 9,
    })
  })

  it('returns null when there is no amount', () => {
    expect(parseQuantityPrefix('Zwiebeln fein würfeln')).toBeNull()
  })
})

describe('instruction ingredient references', () => {
  it('scales only the explicitly linked amount', () => {
    const ingredients = [ingredient()]
    const instructions = [instruction('Die 2 Zwiebeln 10 Minuten anbraten.', [reference()])]
    const rendered = render(instructions, ingredients, 4, 6)
    expect(rendered[0]?.text).toBe('Die 3 Zwiebeln 10 Minuten anbraten.')
    expect(rendered[0]?.references[0]?.scaled).toBe(true)
  })

  it('scales down and handles fractions, ranges and units through the shared parser', () => {
    const ingredients = [
      ingredient({ id: 'i1', quantityText: '1/2', quantity: 0.5, unit: 'TL', name: 'Salz' }),
      ingredient({ id: 'i2', quantityText: '2-3', quantity: 2, unit: 'Stück', name: 'Eier' }),
    ]
    const instructions = [
      instruction('Mit 1/2 TL Salz und 2-3 Eiern verrühren.', [
        reference({ id: 'r1', ingredientId: 'i1', anchor: '1/2', anchorOffset: 5 }),
        reference({ id: 'r2', ingredientId: 'i2', anchor: '2-3', anchorOffset: 17 }),
      ]),
    ]
    const rendered = render(instructions, ingredients, 4, 2)
    expect(rendered[0]?.text).toBe('Mit 0,25 TL Salz und 1–1,5 Eiern verrühren.')
  })

  it('leaves unlinked numbers, temperatures, times and device levels untouched', () => {
    const ingredients = [ingredient()]
    const text = 'Bei 180 °C die 2 Zwiebeln 10 Minuten garen, Stufe 3, dann 5 Minuten ruhen.'
    const rendered = render([instruction(text, [reference({ anchor: '2', anchorOffset: 17 })])], ingredients, 4, 8)
    expect(rendered[0]?.text).toBe(
      'Bei 180 °C die 4 Zwiebeln 10 Minuten garen, Stufe 3, dann 5 Minuten ruhen.',
    )
  })

  it('scales partial amounts from the original portions', () => {
    const butter = ingredient({
      id: 'butter',
      name: 'Butter',
      quantity: 100,
      quantityText: '100',
      unit: 'g',
    })
    const instructions = [
      instruction('40 g Butter in der Pfanne erhitzen.', [
        reference({
          id: 'r1',
          ingredientId: 'butter',
          anchor: '40',
          anchorOffset: 0,
          quantity: { kind: 'partial', quantityText: '40' },
        }),
      ]),
      instruction('Die übrigen 60 g Butter zur Sauce geben.', [
        reference({
          id: 'r2',
          ingredientId: 'butter',
          anchor: '60',
          anchorOffset: 12,
          quantity: { kind: 'remainder' },
        }),
      ]),
    ]
    const rendered = render(instructions, [butter], 4, 8)
    expect(rendered[0]?.text).toBe('80 g Butter in der Pfanne erhitzen.')
    expect(rendered[1]?.text).toBe('Die übrigen 120 g Butter zur Sauce geben.')
  })

  it('does not subtract when a previous usage is a full amount or has an incompatible unit', () => {
    const butter = ingredient({
      id: 'butter',
      name: 'Butter',
      quantity: 100,
      quantityText: '100',
      unit: 'g',
    })
    const fullThenRemainder = render(
      [
        instruction('100 g Butter erhitzen.', [
          reference({ id: 'r1', ingredientId: 'butter', anchor: '100', quantity: { kind: 'full' } }),
        ]),
        instruction('Die übrigen 60 g Butter dazugeben.', [
          reference({ id: 'r2', ingredientId: 'butter', anchor: '60', quantity: { kind: 'remainder' } }),
        ]),
      ],
      [butter],
      4,
      8,
    )
    expect(fullThenRemainder[1]?.text).toBe('Die übrigen 60 g Butter dazugeben.')
    expect(fullThenRemainder[1]?.references[0]?.issue).toBe('unsafe-remainder')

    const incomparable = render(
      [
        instruction('40 ml Butter erhitzen.', [
          reference({
            id: 'r1',
            ingredientId: 'butter',
            anchor: '40',
            quantity: { kind: 'partial', quantityText: '40 ml' },
          }),
        ]),
        instruction('Die übrigen 60 g Butter dazugeben.', [
          reference({ id: 'r2', ingredientId: 'butter', anchor: '60', quantity: { kind: 'remainder' } }),
        ]),
      ],
      [butter],
      4,
      8,
    )
    expect(incomparable[1]?.text).toBe('Die übrigen 60 g Butter dazugeben.')
    expect(incomparable[1]?.references[0]?.issue).toBe('unsafe-remainder')
  })

  it('refuses a remainder that is followed by another use of the same ingredient', () => {
    const butter = ingredient({
      id: 'butter',
      name: 'Butter',
      quantity: 100,
      quantityText: '100',
      unit: 'g',
    })
    const rendered = render(
      [
        instruction('Die übrigen 100 g Butter dazugeben.', [
          reference({
            id: 'r1',
            ingredientId: 'butter',
            anchor: '100',
            quantity: { kind: 'remainder' },
          }),
        ]),
        instruction('Später 40 g Butter nachlegen.', [
          reference({
            id: 'r2',
            ingredientId: 'butter',
            anchor: '40',
            quantity: { kind: 'partial', quantityText: '40' },
          }),
        ]),
      ],
      [butter],
      4,
      8,
    )
    expect(rendered[0]?.text).toBe('Die übrigen 100 g Butter dazugeben.')
    expect(rendered[0]?.references[0]?.issue).toBe('unsafe-remainder')
  })

  it('lets two references to the same ingredient work independently', () => {
    const ingredients = [ingredient({ id: 'i1', quantityText: '100', quantity: 100, unit: 'g', name: 'Mehl' })]
    const instructions = [
      instruction('40 g Mehl und 60 g Mehl mischen.', [
        reference({
          id: 'r1',
          ingredientId: 'i1',
          anchor: '40',
          anchorOffset: 0,
          quantity: { kind: 'partial', quantityText: '40' },
        }),
        reference({
          id: 'r2',
          ingredientId: 'i1',
          anchor: '60',
          anchorOffset: 11,
          quantity: { kind: 'partial', quantityText: '60' },
        }),
      ]),
    ]
    const rendered = render(instructions, ingredients, 4, 8)
    expect(rendered[0]?.text).toBe('80 g Mehl und 120 g Mehl mischen.')
  })

  it('keeps the original text when a referenced ingredient was deleted', () => {
    const rendered = render(
      [instruction('Die 2 Zwiebeln würfeln.', [reference()])],
      [],
      4,
      8,
    )
    expect(rendered[0]?.text).toBe('Die 2 Zwiebeln würfeln.')
    expect(rendered[0]?.references[0]?.issue).toBe('missing-ingredient')
  })

  it('keeps unclear amounts unchanged instead of inventing a value', () => {
    const unclear = ingredient({ id: 'i1', quantity: null, quantityText: null, name: 'Salz' })
    const rendered = render(
      [
        instruction('Salz nach Geschmack hinzufügen.', [
          reference({ ingredientId: 'i1', anchor: 'Salz', anchorOffset: 0 }),
        ]),
      ],
      [unclear],
      4,
      8,
    )
    expect(rendered[0]?.text).toBe('Salz nach Geschmack hinzufügen.')
    expect(rendered[0]?.references[0]?.issue).toBe('missing-quantity')
  })

  it('does not rewrite anything when original servings are unknown', () => {
    const rendered = render(
      [instruction('Die 2 Zwiebeln würfeln.', [reference()])],
      [ingredient()],
      null,
      8,
    )
    expect(rendered[0]?.text).toBe('Die 2 Zwiebeln würfeln.')
    expect(rendered[0]?.references[0]?.issue).toBe('unknown-original-servings')
  })

  it('resolves duplicate anchors by their saved offset without moving other references', () => {
    const text = '2 Eier trennen, 2 EL Zucker mischen.'
    const refs = [
      reference({ id: 'r1', ingredientId: 'i1', anchor: '2', anchorOffset: 0 }),
      reference({ id: 'r2', ingredientId: 'i2', anchor: '2', anchorOffset: 20 }),
    ]
    const ingredients = [
      ingredient({ id: 'i1', name: 'Eier', quantityText: '2', quantity: 2 }),
      ingredient({ id: 'i2', name: 'Zucker', quantityText: '2', quantity: 2, unit: 'EL' }),
    ]
    const rendered = render([instruction(text, refs)], ingredients, 2, 4)
    expect(rendered[0]?.text).toBe('4 Eier trennen, 4 EL Zucker mischen.')
  })

  it('follows a uniquely occurring amount while the user edits around it', () => {
    const oldText = 'Die 2 Zwiebeln würfeln.'
    const refs = normalizeReferenceAnchors(oldText, [reference({ anchor: '2', anchorOffset: 4 })])
    const next = reconcileReferenceAnchors(oldText, 'Die großen 2 Zwiebeln würfeln.', refs)
    expect(next[0]?.anchorOffset).toBe(11)
  })

  it('does not reassign an ambiguous amount while typing', () => {
    const oldText = '2 Zwiebeln und 2 EL Öl.'
    const refs = normalizeReferenceAnchors(oldText, [reference({ anchor: '2', anchorOffset: 0 })])
    const next = reconcileReferenceAnchors(oldText, '5 Zwiebeln und 2 EL Öl.', refs)
    expect(next[0]?.anchorOffset).toBe(0)
    expect(resolveReferenceAnchor('5 Zwiebeln und 2 EL Öl.', next[0]!)).toBeNull()
  })

  it('does not silently move a reference to another identical amount', () => {
    const original = '2 Zwiebeln und 2 EL Öl.'
    const normalized = normalizeReferenceAnchors(original, [
      reference({ anchor: '2', anchorOffset: 0 }),
    ])
    const edited = '5 Zwiebeln und 2 EL Öl.'
    expect(resolveReferenceAnchor(edited, normalized[0]!)).toBeNull()
  })

  it('refreshes offsets after text edits and keeps references sorted', () => {
    const text = 'Zuerst 2 Zwiebeln, dann 400 g Hackfleisch.'
    const refs = [
      reference({ id: 'r1', anchor: '2', anchorOffset: 0 }),
      reference({ id: 'r2', ingredientId: 'i2', anchor: '400', anchorOffset: 0 }),
    ]
    const normalized = normalizeReferenceAnchors(text, refs)
    expect(normalized.map((entry) => entry.anchorOffset)).toEqual([7, 24])
    expect(resolveReferenceAnchor(text, normalized[0]!)).toEqual({ start: 7, end: 8 })
  })

  it('computes a remaining amount only from safe partial usages', () => {
    const butter = ingredient({ id: 'butter', quantity: 100, quantityText: '100', unit: 'g' })
    const steps = [
      instruction('40 g Butter erhitzen.', [
        reference({
          id: 'r1',
          ingredientId: 'butter',
          anchor: '40',
          quantity: { kind: 'partial', quantityText: '40' },
        }),
      ]),
      instruction('Die übrigen 60 g Butter dazugeben.', []),
    ]
    expect(
      computeRemainingQuantity(steps, [butter], 'butter', {
        instructionIndex: 1,
        referenceIndex: 0,
      }),
    ).toEqual({ text: '60', remaining: 60 })
  })

  it('turns unstructured instruction text into line steps without touching content', () => {
    const normalized = normalizeInstructionList(
      'Erster Absatz.\n\nZweiter Absatz mit **Formatierung**.',
    )
    expect(normalized.map((step) => step.text)).toEqual([
      'Erster Absatz.',
      'Zweiter Absatz mit **Formatierung**.',
    ])
    expect(normalized.map((step) => step.position)).toEqual([0, 1])
  })

  it('normalizes legacy instructions without dropping text or unknown fields', () => {
    const normalized = normalizeInstructionList([
      { id: 's1', raw: 'Original\nText', text: 'Original\nText', custom: 'keep' },
      { id: 's1', raw: 'Zweiter', text: 'Zweiter' },
    ])
    expect(normalized).toHaveLength(2)
    expect(normalized[0]?.text).toBe('Original\nText')
    expect(normalized[0]?.references).toEqual([])
    expect((normalized[0] as unknown as Record<string, unknown>).custom).toBe('keep')
    expect(normalized[1]?.id).not.toBe('s1')
    expect(normalized[1]?.position).toBe(1)
  })
})

describe('automatic ingredient amount scaling', () => {
  it('scales unambiguous amounts, units, fractions and ranges', () => {
    const ingredients = [
      ingredient({ id: 'huhn', name: 'Hähnchen', quantity: 500, quantityText: '500', unit: 'g' }),
      ingredient({ id: 'oel', name: 'Öl', quantity: 2, quantityText: '2', unit: 'EL' }),
      ingredient({ id: 'zwiebeln', name: 'Zwiebeln', quantity: 3, quantityText: '3' }),
      ingredient({ id: 'salz', name: 'Salz', quantity: 0.5, quantityText: '½', unit: 'TL' }),
      ingredient({ id: 'wasser', name: 'Wasser', quantity: 2, quantityText: '2-3', unit: 'EL' }),
    ]
    const text =
      '500 g Hähnchen mit 2 EL Öl und 3 Zwiebeln anbraten. Mit ½ TL Salz und 2-3 EL Wasser ablöschen.'

    const rendered = render([instruction(text)], ingredients, 2, 4)

    expect(rendered[0]?.text).toBe(
      '1000 g Hähnchen mit 4 EL Öl und 6 Zwiebeln anbraten. Mit 1 TL Salz und 4–6 EL Wasser ablöschen.',
    )
  })

  it('scales decimal commas, mixed fractions and unit synonyms', () => {
    const ingredients = [
      ingredient({
        id: 'kartoffeln',
        name: 'Kartoffeln',
        quantity: 1.5,
        quantityText: '1,5',
        unit: 'kg',
      }),
      ingredient({ id: 'salz', name: 'Salz', quantity: 1.5, quantityText: '1 1/2', unit: 'TL' }),
      ingredient({ id: 'oel', name: 'Öl', quantity: 2, quantityText: '2', unit: 'EL' }),
    ]
    const text = '1,5 kg Kartoffeln schälen, mit 1 1/2 TL Salz und 2 Esslöffel Öl mischen.'

    const rendered = render([instruction(text)], ingredients, 2, 4)

    expect(rendered[0]?.text).toBe(
      '3 kg Kartoffeln schälen, mit 3 TL Salz und 4 Esslöffel Öl mischen.',
    )
  })

  it('compares compatible mass and volume units conservatively', () => {
    const ingredients = [
      ingredient({
        id: 'kartoffeln',
        name: 'Kartoffeln',
        quantity: 1,
        quantityText: '1',
        unit: 'kg',
      }),
      ingredient({ id: 'milch', name: 'Milch', quantity: 500, quantityText: '500', unit: 'ml' }),
    ]
    const text = '500 g Kartoffeln und 0,5 l Milch abmessen.'

    const rendered = render([instruction(text)], ingredients, 2, 4)

    expect(rendered[0]?.text).toBe('1000 g Kartoffeln und 1 l Milch abmessen.')
    expect(
      render([instruction('1500 g Kartoffeln abmessen.')], ingredients, 2, 4)[0]?.text,
    ).toBe('1500 g Kartoffeln abmessen.')
    expect(
      render([instruction('0,6 l Milch abmessen.')], ingredients, 2, 4)[0]?.text,
    ).toBe('0,6 l Milch abmessen.')
  })

  it('does not treat a thousands separator as an ingredient amount', () => {
    const mehl = ingredient({
      id: 'mehl',
      name: 'Mehl',
      quantity: 1500,
      quantityText: '1500',
      unit: 'g',
    })

    expect(render([instruction('1 500 g Mehl abwiegen.')], [mehl], 2, 4)[0]?.text).toBe(
      '1 500 g Mehl abwiegen.',
    )
    expect(render([instruction('1 kg 500 g Mehl abwiegen.')], [mehl], 2, 4)[0]?.text).toBe(
      '1 kg 500 g Mehl abwiegen.',
    )
    expect(render([instruction('1.500 g Mehl abwiegen.')], [mehl], 2, 4)[0]?.text).toBe(
      '1.500 g Mehl abwiegen.',
    )
  })

  it('keeps temperatures, times, geometry and step labels untouched', () => {
    const ingredients = [
      ingredient({ id: 'huhn', name: 'Hähnchen', quantity: 500, quantityText: '500', unit: 'g' }),
      ingredient({ id: 'zwiebeln', name: 'Zwiebeln', quantity: 2, quantityText: '2' }),
      ingredient({ id: 'ingwer', name: 'Ingwer', quantity: 10, quantityText: '10', unit: 'g' }),
    ]
    const text =
      'Bei 180 °C die 500 g Hähnchen 20 Minuten garen. Danach 2 Zwiebeln 5 Minuten dünsten und 2 cm Ingwer fein hacken. Schritt 3: Zwiebeln beiseitelegen.'

    const rendered = render([instruction(text)], ingredients, 2, 4)

    expect(rendered[0]?.text).toBe(
      'Bei 180 °C die 1000 g Hähnchen 20 Minuten garen. Danach 4 Zwiebeln 5 Minuten dünsten und 2 cm Ingwer fein hacken. Schritt 3: Zwiebeln beiseitelegen.',
    )
  })

  it('rejects time, temperature and geometry even for unitless ingredients', () => {
    const zwiebeln = ingredient({
      id: 'zwiebeln',
      name: 'Zwiebeln',
      quantity: 2,
      quantityText: '2',
    })
    const ingwer = ingredient({ id: 'ingwer', name: 'Ingwer', quantity: 2, quantityText: '2' })

    expect(
      render([instruction('2 Minuten Zwiebeln dünsten.')], [zwiebeln], 2, 4)[0]?.text,
    ).toBe('2 Minuten Zwiebeln dünsten.')
    expect(
      render([instruction('180 °C Zwiebeln rösten.')], [zwiebeln], 2, 4)[0]?.text,
    ).toBe('180 °C Zwiebeln rösten.')
    expect(
      render([instruction('2 cm Ingwer schneiden.')], [ingwer], 2, 4)[0]?.text,
    ).toBe('2 cm Ingwer schneiden.')
  })

  it('scales partial and repeated amounts across steps', () => {
    const ingredients = [
      ingredient({ id: 'mehl', name: 'Mehl', quantity: 500, quantityText: '500', unit: 'g' }),
      ingredient({ id: 'butter', name: 'Butter', quantity: 100, quantityText: '100', unit: 'g' }),
    ]
    const steps = [
      instruction('200 g Mehl mit 40 g Butter mischen.'),
      instruction('Später 60 g Butter und 300 g Mehl dazugeben.'),
    ]

    const rendered = render(steps, ingredients, 2, 4)

    expect(rendered.map((step) => step.text)).toEqual([
      '400 g Mehl mit 80 g Butter mischen.',
      'Später 120 g Butter und 600 g Mehl dazugeben.',
    ])
  })

  it('does not double-scale an explicit reference and still scales another ingredient', () => {
    const ingredients = [
      ingredient({ id: 'butter', name: 'Butter', quantity: 100, quantityText: '100', unit: 'g' }),
      ingredient({ id: 'oel', name: 'Öl', quantity: 2, quantityText: '2', unit: 'EL' }),
    ]
    const steps = [
      instruction('100 g Butter und 2 EL Öl erhitzen.', [
        reference({
          id: 'butter-ref',
          ingredientId: 'butter',
          anchor: '100',
          anchorOffset: 0,
          quantity: { kind: 'full' },
        }),
      ]),
    ]

    const rendered = render(steps, ingredients, 2, 4)

    expect(rendered[0]?.text).toBe('200 g Butter und 4 EL Öl erhitzen.')
    expect(rendered[0]?.text).not.toContain('400 g Butter')
  })

  it('matches singular/plural forms and common ingredient notes', () => {
    const singular = [
      ingredient({ id: 'zwiebel', name: 'Zwiebel', quantity: 2, quantityText: '2' }),
    ]
    expect(render([instruction('2 Zwiebeln würfeln.')], singular, 2, 4)[0]?.text).toBe(
      '4 Zwiebeln würfeln.',
    )
    expect(
      render([instruction('2 große Zwiebeln würfeln.')], singular, 2, 4)[0]?.text,
    ).toBe('4 große Zwiebeln würfeln.')
    expect(
      render([instruction('2 Stk. Zwiebeln würfeln.')], singular, 2, 4)[0]?.text,
    ).toBe('4 Stk. Zwiebeln würfeln.')

    const withNote = [
      ingredient({
        id: 'zwiebeln',
        name: 'Zwiebeln, fein gewürfelt',
        quantity: 2,
        quantityText: '2',
      }),
    ]
    expect(render([instruction('2 Zwiebeln würfeln.')], withNote, 2, 4)[0]?.text).toBe(
      '4 Zwiebeln würfeln.',
    )

    const withPurpose = [
      ingredient({
        id: 'oel',
        name: 'Öl zum Braten',
        quantity: 2,
        quantityText: '2',
        unit: 'EL',
      }),
    ]
    expect(render([instruction('2 EL Öl erhitzen.')], withPurpose, 2, 4)[0]?.text).toBe(
      '4 EL Öl erhitzen.',
    )

    const withParens = [
      ingredient({
        id: 'huhn',
        name: 'Hähnchen (Brust)',
        quantity: 500,
        quantityText: '500',
        unit: 'g',
      }),
    ]
    expect(render([instruction('500 g Hähnchen anbraten.')], withParens, 2, 4)[0]?.text).toBe(
      '1000 g Hähnchen anbraten.',
    )
  })

  it('leaves ambiguous, contradictory or unsafe matches unchanged', () => {
    const mehl = ingredient({
      id: 'mehl',
      name: 'Mehl',
      quantity: 500,
      quantityText: '500',
      unit: 'g',
    })
    expect(render([instruction('2 EL Mehl verrühren.')], [mehl], 2, 4)[0]?.text).toBe(
      '2 EL Mehl verrühren.',
    )
    expect(render([instruction('600 g Mehl verrühren.')], [mehl], 2, 4)[0]?.text).toBe(
      '600 g Mehl verrühren.',
    )

    const oel = ingredient({ id: 'oel', name: 'Öl', quantity: 2, quantityText: '2', unit: 'EL' })
    expect(
      render([instruction('2 EL Olivenöl verwenden.')], [oel], 2, 4)[0]?.text,
    ).toBe('2 EL Olivenöl verwenden.')

    const unclearSalt = ingredient({
      id: 'salz',
      name: 'Salz',
      quantity: null,
      quantityText: null,
      unit: null,
      parseStatus: 'plain',
    })
    expect(
      render([instruction('2 TL Salz hinzufügen.')], [unclearSalt], 2, 4)[0]?.text,
    ).toBe('2 TL Salz hinzufügen.')

    const saltA = ingredient({ id: 'salt-a', name: 'Salz', quantity: 1, quantityText: '1', unit: 'TL' })
    const saltB = ingredient({ id: 'salt-b', name: 'Salz', quantity: 2, quantityText: '2', unit: 'TL' })
    expect(render([instruction('2 TL Salz hinzufügen.')], [saltA, saltB], 2, 4)[0]?.text).toBe(
      '2 TL Salz hinzufügen.',
    )

    const zwiebeln = ingredient({ id: 'zwiebeln', name: 'Zwiebeln', quantity: 2, quantityText: '2' })
    expect(render([instruction('Schritt 2: Zwiebeln würfeln.')], [zwiebeln], 2, 4)[0]?.text).toBe(
      'Schritt 2: Zwiebeln würfeln.',
    )
    expect(render([instruction('2. Zwiebeln würfeln.')], [zwiebeln], 2, 4)[0]?.text).toBe(
      '2. Zwiebeln würfeln.',
    )
    expect(render([instruction('Nr. 2 Zwiebeln würfeln.')], [zwiebeln], 2, 4)[0]?.text).toBe(
      'Nr. 2 Zwiebeln würfeln.',
    )
    expect(
      render([instruction('2 bis 3 Zwiebeln würfeln.')], [zwiebeln], 2, 4)[0]?.text,
    ).toBe('2 bis 3 Zwiebeln würfeln.')
    expect(
      render([instruction('2 EL Zwiebeln würfeln.')], [zwiebeln], 2, 4)[0]?.text,
    ).toBe('2 EL Zwiebeln würfeln.')
    expect(
      render([instruction('3 Zwiebeln würfeln.')], [zwiebeln], 2, 4)[0]?.text,
    ).toBe('3 Zwiebeln würfeln.')
    expect(
      render([instruction('Die Zwiebeln (2 Stück) würfeln.')], [zwiebeln], 2, 4)[0]?.text,
    ).toBe('Die Zwiebeln (2 Stück) würfeln.')
  })

  it('keeps Markdown emphasis while replacing only the amount', () => {
    const ingredients = [
      ingredient({ id: 'huhn', name: 'Hähnchen', quantity: 500, quantityText: '500', unit: 'g' }),
    ]
    const rendered = render(
      [instruction('**500 g Hähnchen** kräftig anbraten.')],
      ingredients,
      2,
      4,
    )

    expect(rendered[0]?.text).toBe('**1000 g Hähnchen** kräftig anbraten.')
  })

  it('does not auto-scale when the caller has not opted in', () => {
    const ingredients = [
      ingredient({ id: 'huhn', name: 'Hähnchen', quantity: 500, quantityText: '500', unit: 'g' }),
    ]
    const rendered = renderRecipeInstructions(
      [instruction('500 g Hähnchen anbraten.')],
      ingredients,
      {
        originalServings: 2,
        targetServings: 4,
      },
    )

    expect(rendered[0]?.text).toBe('500 g Hähnchen anbraten.')
    expect(rendered[0]?.mentions).toEqual([])
    expect(rendered[0]?.annotatedText).toBe('500 g Hähnchen anbraten.')
  })

  it('never mutates the stored instruction or ingredient', () => {
    const huhn = ingredient({
      id: 'huhn',
      name: 'Hähnchen',
      quantity: 500,
      quantityText: '500',
      unit: 'g',
    })
    const step = instruction('500 g Hähnchen anbraten.')
    const before = { ...huhn }

    render([step], [huhn], 2, 4)

    expect(step.text).toBe('500 g Hähnchen anbraten.')
    expect(huhn).toEqual(before)
  })
})

describe('automatic ingredient mentions', () => {
  it('highlights several exact ingredients in one sentence and adds safe total badges', () => {
    const ingredients = [
      ingredient({ id: 'paprika', name: 'Paprika', quantity: 2, quantityText: '2' }),
      ingredient({ id: 'zwiebel', name: 'Zwiebel', quantity: 1, quantityText: '1' }),
    ]
    const rendered = render(
      [instruction('Die Paprika und Zwiebel würfeln.')],
      ingredients,
      2,
      4,
    )
    const mentions = rendered[0]?.mentions ?? []

    expect(mentions.map((mention) => mention.ingredient.name)).toEqual([
      'Paprika',
      'Zwiebel',
    ])
    expect(mentions.map((mention) => mention.amountText)).toEqual(['4', '2'])
    expect(mentions.every((mention) => !mention.hasAmount)).toBe(true)
    expect(rendered[0]?.annotatedText).toContain(
      '<span class="cook-ingredient-mention">Paprika',
    )
    expect(rendered[0]?.annotatedText).toContain(
      '<span class="cook-ingredient-mention">Zwiebel',
    )
    expect(rendered[0]?.annotatedText).toContain('>4 gesamt</span>')
    expect(rendered[0]?.annotatedText).toContain('>2 gesamt</span>')
  })

  it('matches singular and plural ingredient forms', () => {
    const ingredients = [
      ingredient({ id: 'zwiebel', name: 'Zwiebel', quantity: 2, quantityText: '2' }),
    ]
    const rendered = render([instruction('Die Zwiebeln schneiden.')], ingredients, 2, 4)

    expect(rendered[0]?.mentions).toHaveLength(1)
    expect(rendered[0]?.mentions[0]?.ingredient.name).toBe('Zwiebel')
    expect(rendered[0]?.mentions[0]?.amountText).toBe('4')
    expect(rendered[0]?.annotatedText).toContain(
      '<span class="cook-ingredient-mention">Zwiebeln<span class="cook-ingredient-badge"',
    )
  })

  it('links unique shortened names and safe category terms', () => {
    const ingredients = [
      ingredient({
        id: 'huhn',
        name: 'Hähnchenbrustfilet',
        quantity: 500,
        quantityText: '500',
        unit: 'g',
      }),
      ingredient({
        id: 'bruehe',
        name: 'Hühnerbrühe',
        quantity: 500,
        quantityText: '500',
        unit: 'ml',
      }),
    ]
    const rendered = render(
      [instruction('Das Fleisch mit der Brühe ablöschen.')],
      ingredients,
      2,
      4,
    )
    const mentions = rendered[0]?.mentions ?? []

    expect(mentions.map((mention) => mention.ingredient.name)).toEqual([
      'Hähnchenbrustfilet',
      'Hühnerbrühe',
    ])
    expect(mentions.map((mention) => mention.amountText)).toEqual(['1000 g', '1000 ml'])
    expect(rendered[0]?.annotatedText).toContain(
      '<span class="cook-ingredient-mention">Fleisch',
    )
    expect(rendered[0]?.annotatedText).toContain(
      '<span class="cook-ingredient-mention">Brühe',
    )
    expect(rendered[0]?.annotatedText).toContain('1000 g gesamt')
    expect(rendered[0]?.annotatedText).toContain('1000 ml gesamt')
  })

  it('links an unambiguous poultry term to a compound ingredient', () => {
    const ingredients = [
      ingredient({
        id: 'huhn',
        name: 'Hähnchenbrustfilet',
        quantity: 500,
        quantityText: '500',
        unit: 'g',
      }),
    ]
    const rendered = render([instruction('Das Hähnchen anbraten.')], ingredients, 2, 4)

    expect(rendered[0]?.mentions).toHaveLength(1)
    expect(rendered[0]?.mentions[0]?.ingredient.name).toBe('Hähnchenbrustfilet')
    expect(rendered[0]?.mentions[0]?.amountText).toBe('1000 g')
    expect(rendered[0]?.annotatedText).toContain(
      '<span class="cook-ingredient-mention">Hähnchen',
    )
  })

  it('does not link ambiguous shortened or duplicate names', () => {
    const broths = [
      ingredient({ id: 'huhn', name: 'Hühnerbrühe', quantity: 500, quantityText: '500', unit: 'ml' }),
      ingredient({ id: 'gemuese', name: 'Gemüsebrühe', quantity: 500, quantityText: '500', unit: 'ml' }),
    ]
    const brothRendered = render([instruction('Die Brühe hinzufügen.')], broths, 2, 4)
    expect(brothRendered[0]?.mentions).toEqual([])
    expect(brothRendered[0]?.annotatedText).toBe('Die Brühe hinzufügen.')

    const salts = [
      ingredient({ id: 'salz-a', name: 'Salz', quantity: 1, quantityText: '1', unit: 'TL' }),
      ingredient({ id: 'salz-b', name: 'Salz', quantity: 2, quantityText: '2', unit: 'TL' }),
    ]
    const saltRendered = render([instruction('Salz hinzufügen.')], salts, 2, 4)
    expect(saltRendered[0]?.mentions).toEqual([])
    expect(saltRendered[0]?.annotatedText).toBe('Salz hinzufügen.')
  })

  it('highlights multiple uses without showing the total amount in every step', () => {
    const ingredients = [
      ingredient({
        id: 'bruehe',
        name: 'Hühnerbrühe',
        quantity: 500,
        quantityText: '500',
        unit: 'ml',
      }),
    ]
    const rendered = render(
      [
        instruction('200 ml Brühe hinzufügen.'),
        instruction('Die restliche Brühe dazugeben.'),
      ],
      ingredients,
      2,
      4,
    )

    expect(rendered[0]?.text).toBe('400 ml Brühe hinzufügen.')
    expect(rendered[0]?.mentions[0]?.hasAmount).toBe(true)
    expect(rendered[0]?.mentions[0]?.amountText).toBeNull()
    expect(rendered[1]?.text).toBe('Die restliche Brühe dazugeben.')
    expect(rendered[1]?.mentions[0]?.hasAmount).toBe(false)
    expect(rendered[1]?.mentions[0]?.amountText).toBeNull()
    expect(rendered[0]?.annotatedText).not.toContain('cook-ingredient-badge')
    expect(rendered[1]?.annotatedText).not.toContain('cook-ingredient-badge')
  })

  it('does not add a badge beside an already present amount', () => {
    const ingredients = [
      ingredient({
        id: 'huhn',
        name: 'Hähnchen',
        quantity: 500,
        quantityText: '500',
        unit: 'g',
      }),
    ]
    const rendered = render([instruction('500 g Hähnchen anbraten.')], ingredients, 2, 4)

    expect(rendered[0]?.text).toBe('1000 g Hähnchen anbraten.')
    expect(rendered[0]?.mentions[0]?.hasAmount).toBe(true)
    expect(rendered[0]?.mentions[0]?.amountText).toBeNull()
    expect(rendered[0]?.annotatedText).toContain(
      '<span class="cook-ingredient-mention">Hähnchen</span>',
    )
    expect(rendered[0]?.annotatedText).not.toContain('cook-ingredient-badge')

    const amountAfterName = render(
      [instruction('Das Hähnchen (500 g) anbraten.')],
      ingredients,
      2,
      4,
    )
    expect(amountAfterName[0]?.text).toBe('Das Hähnchen (500 g) anbraten.')
    expect(amountAfterName[0]?.mentions[0]?.hasAmount).toBe(true)
    expect(amountAfterName[0]?.mentions[0]?.amountText).toBeNull()
    expect(amountAfterName[0]?.annotatedText).not.toContain('cook-ingredient-badge')
  })

  it('does not add a total badge beside a spelled-out amount', () => {
    const ingredients = [
      ingredient({ id: 'zwiebeln', name: 'Zwiebeln', quantity: 2, quantityText: '2' }),
    ]
    const rendered = render([instruction('Zwei Zwiebeln schneiden.')], ingredients, 2, 4)

    expect(rendered[0]?.text).toBe('Zwei Zwiebeln schneiden.')
    expect(rendered[0]?.mentions[0]?.hasAmount).toBe(true)
    expect(rendered[0]?.mentions[0]?.amountText).toBeNull()
    expect(rendered[0]?.annotatedText).not.toContain('cook-ingredient-badge')

    const articleRendered = render(
      [instruction('Eine Zwiebel schneiden.')],
      ingredients,
      2,
      4,
    )
    expect(articleRendered[0]?.text).toBe('Eine Zwiebel schneiden.')
    expect(articleRendered[0]?.mentions[0]?.hasAmount).toBe(true)
    expect(articleRendered[0]?.mentions[0]?.amountText).toBeNull()
    expect(articleRendered[0]?.annotatedText).not.toContain('cook-ingredient-badge')
  })

  it('does not add a total badge in a qualitative amount context', () => {
    const salt = ingredient({
      id: 'salz',
      name: 'Salz',
      quantity: 1,
      quantityText: '1',
      unit: 'TL',
    })
    const saltRendered = render(
      [instruction('Salz nach Geschmack hinzufügen.')],
      [salt],
      2,
      4,
    )
    expect(saltRendered[0]?.mentions[0]?.hasAmount).toBe(true)
    expect(saltRendered[0]?.mentions[0]?.amountText).toBeNull()
    expect(saltRendered[0]?.annotatedText).not.toContain('cook-ingredient-badge')

    const onions = [
      ingredient({ id: 'zwiebeln', name: 'Zwiebeln', quantity: 2, quantityText: '2' }),
    ]
    const onionRendered = render(
      [instruction('Die Zwiebeln nach Belieben schneiden.')],
      onions,
      2,
      4,
    )
    expect(onionRendered[0]?.mentions[0]?.hasAmount).toBe(true)
    expect(onionRendered[0]?.mentions[0]?.amountText).toBeNull()
    expect(onionRendered[0]?.annotatedText).not.toContain('cook-ingredient-badge')
  })

  it('lets a manual reference suppress a later total badge for the same ingredient', () => {
    const ingredients = [
      ingredient({
        id: 'butter',
        name: 'Butter',
        quantity: 500,
        quantityText: '500',
        unit: 'g',
      }),
    ]
    const rendered = render(
      [
        instruction('100 g Butter erhitzen.', [
          reference({
            id: 'butter-ref',
            ingredientId: 'butter',
            anchor: '100',
            anchorOffset: 0,
            quantity: { kind: 'partial', quantityText: '100' },
          }),
        ]),
        instruction('Die Butter schmelzen.'),
      ],
      ingredients,
      2,
      4,
    )

    expect(rendered[0]?.text).toBe('200 g Butter erhitzen.')
    expect(rendered[1]?.mentions[0]?.amountText).toBeNull()
    expect(rendered[1]?.annotatedText).not.toContain('cook-ingredient-badge')
  })

  it('keeps Markdown intact and never links code or link destinations', () => {
    const ingredients = [
      ingredient({ id: 'zwiebeln', name: 'Zwiebeln', quantity: 2, quantityText: '2' }),
    ]
    const text =
      '**Die Zwiebeln** und [Zwiebeln](https://example.com/zwiebeln) sowie `Zwiebeln` schneiden.'
    const rendered = render([instruction(text)], ingredients, 2, 4)

    expect(rendered[0]?.mentions).toHaveLength(2)
    expect(rendered[0]?.annotatedText).toContain(
      '**Die <span class="cook-ingredient-mention">Zwiebeln</span>**',
    )
    expect(rendered[0]?.annotatedText).toContain(
      '[<span class="cook-ingredient-mention">Zwiebeln</span>](https://example.com/zwiebeln)',
    )
    expect(rendered[0]?.annotatedText).toContain('`Zwiebeln`')
    expect(rendered[0]?.annotatedText).not.toContain('cook-ingredient-badge')
  })

  it('does not link ingredient names inside longer compound words', () => {
    const oil = ingredient({ id: 'oel', name: 'Öl', quantity: 2, quantityText: '2', unit: 'EL' })
    const oilRendered = render([instruction('2 EL Olivenöl verwenden.')], [oil], 2, 4)
    expect(oilRendered[0]?.mentions).toEqual([])
    expect(oilRendered[0]?.annotatedText).toBe('2 EL Olivenöl verwenden.')

    const tomato = ingredient({ id: 'tomaten', name: 'Tomaten', quantity: 2, quantityText: '2' })
    const tomatoRendered = render([instruction('2 EL Tomatenmark verwenden.')], [tomato], 2, 4)
    expect(tomatoRendered[0]?.mentions).toEqual([])
    expect(tomatoRendered[0]?.annotatedText).toBe('2 EL Tomatenmark verwenden.')
  })

  it('does not link image alt text or raw HTML attributes', () => {
    const ingredients = [
      ingredient({ id: 'zwiebeln', name: 'Zwiebeln', quantity: 2, quantityText: '2' }),
    ]
    const image = render(
      [instruction('![Zwiebeln](https://example.com/zwiebeln.png) ansehen.')],
      ingredients,
      2,
      4,
    )
    expect(image[0]?.mentions).toEqual([])
    expect(image[0]?.annotatedText).toBe(
      '![Zwiebeln](https://example.com/zwiebeln.png) ansehen.',
    )

    const html = render(
      [instruction('<a href="zwiebeln">Zwiebeln</a> schneiden.')],
      ingredients,
      2,
      4,
    )
    expect(html[0]?.mentions).toHaveLength(1)
    expect(html[0]?.annotatedText).toContain('href="zwiebeln">')
    expect(html[0]?.annotatedText).toContain(
      '<span class="cook-ingredient-mention">Zwiebeln',
    )
  })

  it('highlights ingredients with unclear quantities without inventing an amount', () => {
    const ingredients = [
      ingredient({
        id: 'salz',
        name: 'Salz',
        quantity: null,
        quantityText: null,
        unit: null,
        parseStatus: 'plain',
      }),
    ]
    const rendered = render([instruction('Salz hinzufügen.')], ingredients, 2, 4)

    expect(rendered[0]?.mentions).toHaveLength(1)
    expect(rendered[0]?.mentions[0]?.amountText).toBeNull()
    expect(rendered[0]?.annotatedText).toContain(
      '<span class="cook-ingredient-mention">Salz</span>',
    )
    expect(rendered[0]?.annotatedText).not.toContain('cook-ingredient-badge')

    const ambiguousThousands = [
      ingredient({
        id: 'mehl',
        name: 'Mehl',
        quantity: 1.5,
        quantityText: '1.500',
        unit: 'g',
      }),
    ]
    const ambiguousRendered = render(
      [instruction('Mehl hinzufügen.')],
      ambiguousThousands,
      2,
      4,
    )
    expect(ambiguousRendered[0]?.mentions[0]?.amountText).toBeNull()
    expect(ambiguousRendered[0]?.annotatedText).not.toContain('cook-ingredient-badge')
  })

  it('escapes badge text instead of injecting HTML', () => {
    const ingredients = [
      ingredient({
        id: 'oel',
        name: 'Öl',
        quantity: 2,
        quantityText: '2',
        unit: '*<script>*',
      }),
    ]
    const rendered = render([instruction('Das Öl hinzufügen.')], ingredients, 2, 4)

    expect(rendered[0]?.mentions[0]?.amountText).toBe('4 *<script>*')
    expect(rendered[0]?.annotatedText).not.toContain('<script>')
    expect(rendered[0]?.annotatedText).toContain('&#42;&lt;script&gt;&#42;')
  })
})
