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
) {
  return renderRecipeInstructions(instructions, ingredients, {
    originalServings,
    targetServings,
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
