import { describe, expect, it } from 'vitest'
import type { Ingredient } from '../types'
import {
  orderIngredientsForDisplay,
  parseIngredientLine,
  parseIngredients,
} from './ingredients'
import { formatIngredientAmount } from './mela'

function line(rawLine: string): Ingredient {
  return parseIngredientLine(rawLine, 0, null)
}

describe('ingredient quantity parsing', () => {
  it('parses the five known Mela examples', () => {
    const examples: Array<{
      raw: string
      quantity: number
      quantityText: string
      unit: string | null
      name: string
    }> = [
      {
        raw: 'ca. 200 ml Rotwein (trocken, z. B. Dornfelder)',
        quantity: 200,
        quantityText: 'ca. 200',
        unit: 'ml',
        name: 'Rotwein (trocken, z. B. Dornfelder)',
      },
      {
        raw: 'halbe Tasse Wasser',
        quantity: 0.5,
        quantityText: '½',
        unit: 'Tasse',
        name: 'Wasser',
      },
      {
        raw: '3 Zehen Knoblauch',
        quantity: 3,
        quantityText: '3',
        unit: 'Zehen',
        name: 'Knoblauch',
      },
      {
        raw: '2 Paprika',
        quantity: 2,
        quantityText: '2',
        unit: null,
        name: 'Paprika',
      },
      {
        raw: '1/2 TL Salz',
        quantity: 0.5,
        quantityText: '1/2',
        unit: 'TL',
        name: 'Salz',
      },
    ]

    for (const example of examples) {
      const ingredient = line(example.raw)
      expect(ingredient.parseStatus).toBe('parsed')
      expect(ingredient.quantity).toBeCloseTo(example.quantity)
      expect(ingredient.quantityText).toBe(example.quantityText)
      expect(ingredient.unit).toBe(example.unit)
      expect(ingredient.name).toBe(example.name)
      expect(ingredient.raw).toBe(example.raw)
      expect(ingredient.purchaseNote).toBe('')
      expect(ingredient.preparationNote).toBe('')
    }
  })

  it('accepts qualifiers, fractions, decimals and ranges', () => {
    expect(line('etwa 250 g Mehl')).toMatchObject({
      quantity: 250,
      quantityText: 'etwa 250',
      unit: 'g',
      name: 'Mehl',
    })
    expect(line('1 1/2 EL Zucker')).toMatchObject({
      quantity: 1.5,
      quantityText: '1 1/2',
      unit: 'EL',
      name: 'Zucker',
    })
    expect(line('2-3 EL Öl')).toMatchObject({
      quantity: 2,
      quantityText: '2-3',
      unit: 'EL',
      name: 'Öl',
    })
    expect(line('0,5 l Milch')).toMatchObject({
      quantity: 0.5,
      quantityText: '0,5',
      unit: 'l',
      name: 'Milch',
    })
    expect(line('1.5 kg Kartoffeln')).toMatchObject({
      quantity: 1.5,
      quantityText: '1.5',
      unit: 'kg',
      name: 'Kartoffeln',
    })
    expect(line('1TL Salz')).toMatchObject({
      quantity: 1,
      quantityText: '1',
      unit: 'TL',
      name: 'Salz',
    })
    expect(line('1½ TL Salz')).toMatchObject({
      quantity: 1.5,
      quantityText: '1½',
      unit: 'TL',
      name: 'Salz',
    })
    expect(line('eine halbe Tasse Wasser')).toMatchObject({
      quantity: 0.5,
      quantityText: '½',
      unit: 'Tasse',
      name: 'Wasser',
    })
    expect(line('dreiviertel TL Salz')).toMatchObject({
      quantity: 0.75,
      quantityText: '¾',
      unit: 'TL',
      name: 'Salz',
    })
    expect(line('½ Tasse Wasser')).toMatchObject({
      quantity: 0.5,
      quantityText: '½',
      unit: 'Tasse',
      name: 'Wasser',
    })
    expect(line('eine Prise Salz')).toMatchObject({
      quantity: 1,
      quantityText: '1',
      unit: 'Prise',
      name: 'Salz',
    })
    expect(line('ein wenig Salz').parseStatus).toBe('plain')
    expect(line('1 1/2 - 2 EL Zucker')).toMatchObject({
      quantity: 1.5,
      quantityText: '1 1/2 - 2',
      unit: 'EL',
      name: 'Zucker',
    })
    expect(line('ca. 2-3 EL Öl')).toMatchObject({
      quantity: 2,
      quantityText: 'ca. 2-3',
      unit: 'EL',
      name: 'Öl',
    })
  })

  it('keeps unclear or missing quantities as plain original lines', () => {
    for (const raw of [
      'Salz und Pfeffer',
      'etwas Muskat',
      'ca. Salz',
      '1/2',
      'evtl. etwas Wasser zum Nachgießen',
    ]) {
      const ingredient = line(raw)
      expect(ingredient.parseStatus).toBe('plain')
      expect(ingredient.quantity).toBeNull()
      expect(ingredient.raw).toBe(raw)
      expect(ingredient.name).toBe(raw)
    }
  })

  it('does not strip parentheses or infer notes', () => {
    expect(line('2 Zwiebeln (fein gewürfelt)')).toMatchObject({
      quantity: 2,
      name: 'Zwiebeln (fein gewürfelt)',
      purchaseNote: '',
      preparationNote: '',
      parseStatus: 'parsed',
    })
    expect(line('350 ml passierte Tomaten (Mutti)')).toMatchObject({
      quantity: 350,
      unit: 'ml',
      name: 'passierte Tomaten (Mutti)',
      purchaseNote: '',
      preparationNote: '',
    })
  })
})

describe('ingredient display ordering', () => {
  const ingredients: Ingredient[] = [
    { id: 'a', groupId: null, position: 0, raw: 'Salz', name: 'Salz', quantity: null, quantityText: null, unit: null, parseStatus: 'plain', links: [] },
    { id: 'b', groupId: null, position: 1, raw: '2 Paprika', name: 'Paprika', quantity: 2, quantityText: '2', unit: null, parseStatus: 'parsed', links: [] },
    { id: 'c', groupId: null, position: 2, raw: 'Pfeffer', name: 'Pfeffer', quantity: null, quantityText: null, unit: null, parseStatus: 'plain', links: [] },
    { id: 'd', groupId: null, position: 3, raw: '1 Zwiebel', name: 'Zwiebel', quantity: 1, quantityText: '1', unit: null, parseStatus: 'parsed', links: [] },
  ]

  it('puts recognised amounts first and keeps the relative order', () => {
    const original = ingredients.map((entry) => entry.id)
    expect(orderIngredientsForDisplay(ingredients).map((entry) => entry.id)).toEqual([
      'b',
      'd',
      'a',
      'c',
    ])
    expect(ingredients.map((entry) => entry.id)).toEqual(original)
  })

  it('keeps textual section headings in place and partitions each section', () => {
    const items: Ingredient[] = [
      { id: 'h1', groupId: null, position: 0, raw: 'Für die Marinade:', name: 'Für die Marinade:', quantity: null, quantityText: null, unit: null, parseStatus: 'plain', links: [] },
      { id: 'a', groupId: null, position: 1, raw: 'Salz', name: 'Salz', quantity: null, quantityText: null, unit: null, parseStatus: 'plain', links: [] },
      { id: 'b', groupId: null, position: 2, raw: '1 TL Salz', name: 'Salz', quantity: 1, quantityText: '1', unit: 'TL', parseStatus: 'parsed', links: [] },
      { id: 'c', groupId: null, position: 3, raw: 'Pfeffer', name: 'Pfeffer', quantity: null, quantityText: null, unit: null, parseStatus: 'plain', links: [] },
      { id: 'h2', groupId: null, position: 4, raw: 'FÜR DAS DRESSING', name: 'FÜR DAS DRESSING', quantity: null, quantityText: null, unit: null, parseStatus: 'plain', links: [] },
      { id: 'd', groupId: null, position: 5, raw: 'Essig', name: 'Essig', quantity: null, quantityText: null, unit: null, parseStatus: 'plain', links: [] },
      { id: 'e', groupId: null, position: 6, raw: '2 EL Öl', name: 'Öl', quantity: 2, quantityText: '2', unit: 'EL', parseStatus: 'parsed', links: [] },
    ]
    expect(orderIngredientsForDisplay(items).map((entry) => entry.id)).toEqual([
      'h1',
      'b',
      'a',
      'c',
      'h2',
      'e',
      'd',
    ])
  })

  it('applies the same partition inside named groups', () => {
    const parsed = parseIngredients(
      ['# Sauce', 'Salz', '1 Zwiebel', 'Pfeffer', '2 Knoblauchzehen'].join('\n'),
    )
    expect(parsed.groups.map((group) => group.title)).toEqual(['Sauce'])
    expect(parsed.ingredients.map((entry) => entry.name)).toEqual([
      'Salz',
      'Zwiebel',
      'Pfeffer',
      'Knoblauchzehen',
    ])
    const groupItems = parsed.ingredients.filter((entry) => entry.groupId === parsed.groups[0]?.id)
    expect(orderIngredientsForDisplay(groupItems).map((entry) => entry.name)).toEqual([
      'Zwiebel',
      'Knoblauchzehen',
      'Salz',
      'Pfeffer',
    ])
  })
})

describe('ingredient amount display', () => {
  it('uses preserved quantity tokens and readable fractions', () => {
    expect(formatIngredientAmount(line('ca. 200 ml Rotwein (trocken)'))).toBe('ca. 200 ml')
    expect(formatIngredientAmount(line('halbe Tasse Wasser'))).toBe('½ Tasse')
    expect(formatIngredientAmount(line('3 Zehen Knoblauch'))).toBe('3 Zehen')
    expect(formatIngredientAmount(line('2 Paprika'))).toBe('2')
    expect(formatIngredientAmount(line('1/2 TL Salz'))).toBe('½ TL')
    expect(formatIngredientAmount(line('2-3 EL Öl'))).toBe('2–3 EL')
    expect(formatIngredientAmount(line('1 1/2 EL Zucker'))).toBe('1½ EL')
    expect(formatIngredientAmount(line('0,5 l Milch'))).toBe('0,5 l')
    expect(formatIngredientAmount(line('1.5 kg Kartoffeln'))).toBe('1,5 kg')
    expect(formatIngredientAmount(line('etwa 250 g Mehl'))).toBe('etwa 250 g')
  })
})
