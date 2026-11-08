/*
 * openCook Web
 * Copyright (C) 2026 openCook Web contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Pure portion scaling. The stored recipe quantities are never modified; the
 * scaled text is only a display value. Everything is generic: no recipe,
 * ingredient name or unit is special-cased.
 */

import type { Ingredient } from '../types'

export interface ParsedQuantityToken {
  /** "ca.", "etwa", … including the original punctuation. */
  qualifier: string
  /** One value for a single amount, two for a range. */
  values: number[]
  /** True when the original wrote a range. */
  range: boolean
}

export type ScaleNote =
  | 'missing-quantity'
  | 'unknown-original-servings'
  | 'invalid-target'

export interface ScaledIngredient {
  ingredient: Ingredient
  /** Readable scaled amount including qualifier, null when not numeric. */
  quantityText: string | null
  /** True only when a numeric amount was actually scaled. */
  scaled: boolean
  note: ScaleNote | null
}

export interface RecipeScaleResult {
  /** null when the original portion count is unclear or the target invalid. */
  factor: number | null
  originalServings: number | null
  targetServings: number
  items: ScaledIngredient[]
  warnings: string[]
}

const QUALIFIER_RE = /^(ca\.?|etwa|circa|zirka|rund|ungefähr|gut)\s+/i

const UNICODE_FRACTIONS: Record<string, number> = {
  '½': 0.5,
  '¼': 0.25,
  '¾': 0.75,
  '⅓': 1 / 3,
  '⅔': 2 / 3,
  '⅛': 0.125,
  '⅜': 0.375,
  '⅝': 0.625,
  '⅞': 0.875,
}

function parseFraction(value: string): number | null {
  const parts = value.split('/')
  if (parts.length !== 2) return null
  const numerator = Number.parseFloat(parts[0] ?? '')
  const denominator = Number.parseFloat(parts[1] ?? '')
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) {
    return null
  }
  return numerator / denominator
}

/** Parse one bound: "2", "2,5", "1/2", "1 1/2", "1½", "½". */
function parseBound(value: string): number | null {
  const text = value.trim()
  if (!text) return null

  const unicode = UNICODE_FRACTIONS[text]
  if (unicode !== undefined) return unicode

  const mixedUnicode = /^(\d+)\s*([½¼¾⅓⅔⅛⅜⅝⅞])$/.exec(text)
  if (mixedUnicode) {
    const fraction = UNICODE_FRACTIONS[mixedUnicode[2] ?? '']
    if (fraction !== undefined) return Number(mixedUnicode[1]) + fraction
  }

  if (text.includes(' ') && text.includes('/')) {
    const [whole, fraction] = text.split(/\s+/, 2)
    const wholeNumber = Number.parseFloat((whole ?? '').replace(',', '.'))
    const fractionValue = parseFraction(fraction ?? '')
    if (Number.isFinite(wholeNumber) && fractionValue !== null) {
      return wholeNumber + fractionValue
    }
    return null
  }

  if (text.includes('/')) return parseFraction(text)

  const parsed = Number.parseFloat(text.replace(',', '.'))
  return Number.isFinite(parsed) ? parsed : null
}

/**
 * Parse a stored `quantityText` only if it is a real amount. Ambiguous tokens
 * ("nach Geschmack", "etwas") stay unparsed so they are never scaled.
 */
export function parseQuantityToken(text: string | null | undefined): ParsedQuantityToken | null {
  if (typeof text !== 'string') return null
  let rest = text.trim()
  if (!rest) return null

  let qualifier = ''
  const qualifierMatch = QUALIFIER_RE.exec(rest)
  if (qualifierMatch) {
    qualifier = (qualifierMatch[0] ?? '').trim()
    rest = rest.slice(qualifierMatch[0].length).trim()
  }

  if (!rest) return null
  const parts = rest.split(/\s*[-–—]\s*/)
  if (parts.length > 2 || parts.some((part) => !part)) return null

  const values: number[] = []
  for (const part of parts) {
    const parsed = parseBound(part)
    if (parsed === null) return null
    values.push(parsed)
  }
  if (values.length === 0) return null
  return { qualifier, values, range: values.length === 2 }
}

/** Readable rounding: no false precision, decimal comma, trimmed zeros. */
export function formatScaledNumber(value: number): string {
  if (!Number.isFinite(value)) return ''
  const abs = Math.abs(value)
  let decimals = 2
  if (abs >= 100) decimals = 0
  else if (abs >= 10) decimals = 1
  let rounded = Number(value.toFixed(decimals))
  if (rounded === 0 && value > 0) rounded = Number((1 / 10 ** decimals).toFixed(decimals))
  if (Number.isInteger(rounded)) return String(rounded)
  return rounded
    .toFixed(decimals)
    .replace(/0+$/, '')
    .replace(/[.,]$/, '')
    .replace('.', ',')
}

export function formatQuantityToken(parsed: ParsedQuantityToken, factor: number): string {
  const scaled = parsed.values.map((value) => formatScaledNumber(value * factor))
  const body = scaled.join('–')
  return parsed.qualifier ? `${parsed.qualifier} ${body}` : body
}

/** Convenience for callers that only need the display text. */
export function scaleQuantityForDisplay(
  text: string | null | undefined,
  factor: number,
): string | null {
  const parsed = parseQuantityToken(text)
  if (!parsed || !Number.isFinite(factor) || factor <= 0) return text ?? null
  return formatQuantityToken(parsed, factor)
}

/**
 * Original servings from the recipe. Only an unambiguous positive number is
 * accepted; a range or text like "für 4–6" stays unknown instead of guessing.
 */
export function resolveOriginalServings(recipe: {
  servingsNumber?: number | null
  servingsText?: string | null
}): number | null {
  const number = recipe.servingsNumber
  if (typeof number === 'number' && Number.isFinite(number) && number > 0) return number

  const text = recipe.servingsText?.trim() ?? ''
  if (!text) return null
  const match =
    /^(?:für\s+)?(\d+(?:[.,]\d+)?)\s*(?:portion(?:en)?|person(?:en)?|servings?)?$/i.exec(text)
  if (!match) return null
  const parsed = Number.parseFloat((match[1] ?? '').replace(',', '.'))
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

/**
 * Scale every ingredient for a cooking event.
 *
 * `targetServings` means cooking portions, not eaters. Both range bounds are
 * scaled, qualifiers ("ca.") and units are kept, non-numeric lines are shown
 * unchanged and the original ingredient objects are never mutated.
 */
export function scaleRecipeIngredients(
  ingredients: readonly Ingredient[],
  originalServings: number | null,
  targetServings: number,
): RecipeScaleResult {
  const warnings: string[] = []
  const validOriginal =
    typeof originalServings === 'number' && Number.isFinite(originalServings) && originalServings > 0
  const validTarget =
    typeof targetServings === 'number' && Number.isFinite(targetServings) && targetServings > 0
  const factor = validOriginal && validTarget ? targetServings / originalServings : null

  if (!validOriginal) {
    warnings.push(
      'Die Original-Portionszahl des Rezepts ist unklar. Die Mengen bleiben unverändert und werden nicht skaliert.',
    )
  } else if (!validTarget) {
    warnings.push('Die gewünschte Kochportionenzahl ist ungültig. Die Mengen bleiben unverändert.')
  }

  const items = ingredients.map<ScaledIngredient>((ingredient) => {
    const token =
      ingredient.quantityText?.trim() ||
      (typeof ingredient.quantity === 'number' ? String(ingredient.quantity) : '')
    const parsed = parseQuantityToken(token)

    if (!parsed) {
      return {
        ingredient,
        quantityText: ingredient.quantityText,
        scaled: false,
        note: 'missing-quantity',
      }
    }
    if (factor === null) {
      return {
        ingredient,
        quantityText: ingredient.quantityText,
        scaled: false,
        note: validOriginal ? 'invalid-target' : 'unknown-original-servings',
      }
    }
    return {
      ingredient,
      quantityText: formatQuantityToken(parsed, factor),
      scaled: true,
      note: null,
    }
  })

  return {
    factor,
    originalServings: validOriginal ? originalServings : null,
    targetServings,
    items,
    warnings,
  }
}

/** Full line for the planning dialog, e.g. "ca. 300 g Hackfleisch". */
export function scaledIngredientLine(item: ScaledIngredient): string {
  const amount = item.quantityText?.trim() ?? ''
  const unit = item.ingredient.unit?.trim() ?? ''
  const name = item.ingredient.name.trim()
  return [amount, unit, name].filter(Boolean).join(' ')
}

/**
 * Scale one stored quantity token for display. This is the same parser and
 * formatter used by `scaleRecipeIngredients`; it exists so instruction
 * references never grow a second amount syntax.
 */
export function scaleQuantityText(
  text: string | null | undefined,
  factor: number,
): string | null {
  const parsed = parseQuantityToken(text)
  if (!parsed || !Number.isFinite(factor) || factor <= 0) return null
  return formatQuantityToken(parsed, factor)
}
