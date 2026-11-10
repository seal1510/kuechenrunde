import { describe, expect, it } from 'vitest'
import type { Ingredient } from '../types'
import {
  formatQuantityToken,
  formatScaledNumber,
  parseQuantityToken,
  resolveOriginalServings,
  scaleQuantityForDisplay,
  scaleRecipeIngredients,
  scaledIngredientAmount,
  scaledIngredientLine,
} from './scaling'

function ingredient(overrides: Partial<Ingredient> & { raw: string }): Ingredient {
  return {
    id: overrides.id ?? 'ing-1',
    groupId: null,
    position: 0,
    name: overrides.name ?? overrides.raw,
    quantity: overrides.quantity ?? null,
    quantityText: overrides.quantityText ?? null,
    unit: overrides.unit ?? null,
    purchaseNote: '',
    preparationNote: '',
    parseStatus: 'parsed',
    links: [],
    ...overrides,
    raw: overrides.raw,
  }
}

describe('quantity token parsing', () => {
  it('parses integers, decimals, fractions and mixed fractions', () => {
    expect(parseQuantityToken('2')?.values).toEqual([2])
    expect(parseQuantityToken('2,5')?.values).toEqual([2.5])
    expect(parseQuantityToken('1/2')?.values).toEqual([0.5])
    expect(parseQuantityToken('1 1/2')?.values).toEqual([1.5])
    expect(parseQuantityToken('½')?.values).toEqual([0.5])
    expect(parseQuantityToken('1½')?.values).toEqual([1.5])
  })

  it('keeps ranges and qualifiers', () => {
    const range = parseQuantityToken('ca. 2-3')
    expect(range).toEqual({ qualifier: 'ca.', values: [2, 3], range: true })
    expect(parseQuantityToken('bis 2')).toEqual({
      qualifier: 'bis',
      values: [2],
      range: false,
    })
    expect(parseQuantityToken('bis zu 50')?.values).toEqual([50])
  })

  it('does not invent a number for plain text', () => {
    expect(parseQuantityToken('nach Geschmack')).toBeNull()
    expect(parseQuantityToken('')).toBeNull()
    expect(parseQuantityToken(null)).toBeNull()
  })
})

describe('scaling', () => {
  it('scales both bounds of a range and keeps the qualifier', () => {
    expect(scaleQuantityForDisplay('2-3', 1.5)).toBe('3–4,5')
    expect(scaleQuantityForDisplay('ca. 200', 0.5)).toBe('ca. 100')
    expect(scaleQuantityForDisplay('1 1/2', 2)).toBe('3')
    expect(scaleQuantityForDisplay('1/2', 3)).toBe('1,5')
    expect(scaleQuantityForDisplay('bis 2', 1.5)).toBe('bis 3')
  })

  it('uses readable rounding', () => {
    expect(formatScaledNumber(2.6666)).toBe('2,67')
    expect(formatScaledNumber(300.2)).toBe('300')
    expect(formatScaledNumber(0.004)).toBe('0,01')
    expect(formatScaledNumber(4.0)).toBe('4')
  })

  it('changes the displayed amount but never the stored ingredient', () => {
    const original = ingredient({
      raw: 'ca. 2-3 EL Olivenöl',
      name: 'Olivenöl',
      quantity: 2,
      quantityText: 'ca. 2-3',
      unit: 'EL',
    })
    const result = scaleRecipeIngredients([original], 4, 6)
    expect(result.factor).toBe(1.5)
    expect(result.items[0]?.quantityText).toBe('ca. 3–4,5')
    expect(scaledIngredientAmount(result.items[0]!)).toBe('ca. 3–4,5 EL')
    expect(scaledIngredientLine(result.items[0]!)).toBe('ca. 3–4,5 EL Olivenöl')
    expect(original.quantityText).toBe('ca. 2-3')
    expect(original.quantity).toBe(2)
  })

  it('repairs legacy stored rows before scaling', () => {
    const old = ingredient({
      raw: '750 bis 950 ml Rinderbrühe',
      name: 'bis 950 ml Rinderbrühe',
      quantity: 750,
      quantityText: '750',
      unit: null,
    })
    const result = scaleRecipeIngredients([old], 2, 4)
    expect(result.items[0]?.ingredient.name).toBe('Rinderbrühe')
    expect(result.items[0]?.quantityText).toBe('1500–1900')
    expect(scaledIngredientAmount(result.items[0]!)).toBe('1500–1900 ml')
    expect(old.name).toBe('bis 950 ml Rinderbrühe')
    expect(old.unit).toBeNull()

    const garlic = ingredient({
      raw: 'Knoblauchzehe(n), 2 - 3',
      parseStatus: 'plain',
    })
    const scaledGarlic = scaleRecipeIngredients([garlic], 2, 4)
    expect(scaledGarlic.items[0]?.ingredient.name).toBe('Knoblauchzehen')
    expect(scaledGarlic.items[0]?.quantityText).toBe('4–6')
  })

  it('leaves non-numeric ingredients unchanged', () => {
    const salt = ingredient({ raw: 'Salz und Pfeffer', parseStatus: 'plain' })
    const result = scaleRecipeIngredients([salt], 2, 8)
    expect(result.items[0]?.scaled).toBe(false)
    expect(result.items[0]?.note).toBe('missing-quantity')
    expect(result.items[0]?.quantityText).toBeNull()
    expect(scaledIngredientAmount(result.items[0]!)).toBe('')
  })

  it('reports unclear original servings and does not scale', () => {
    const item = ingredient({
      raw: '200 g Mehl',
      name: 'Mehl',
      quantity: 200,
      quantityText: '200',
      unit: 'g',
    })
    const result = scaleRecipeIngredients([item], null, 4)
    expect(result.factor).toBeNull()
    expect(result.items[0]?.scaled).toBe(false)
    expect(result.items[0]?.quantityText).toBe('200')
    expect(result.warnings).toHaveLength(1)
    expect(result.warnings[0]).toContain('unklar')
  })

  it('accepts only unambiguous original servings', () => {
    expect(resolveOriginalServings({ servingsNumber: 4, servingsText: '4' })).toBe(4)
    expect(resolveOriginalServings({ servingsNumber: null, servingsText: '4 Portionen' })).toBe(4)
    expect(resolveOriginalServings({ servingsNumber: null, servingsText: 'für 4 Personen' })).toBe(4)
    expect(resolveOriginalServings({ servingsNumber: null, servingsText: '4-6' })).toBeNull()
    expect(resolveOriginalServings({ servingsNumber: null, servingsText: 'für viele' })).toBeNull()
  })
})
