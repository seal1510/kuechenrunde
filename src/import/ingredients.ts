/*
 * openCook Web
 * Copyright (C) 2026 openCook Web contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Ingredient-line parsing is derived from the behaviour of openCook's
 * `IngredientLineParser` (GPLv3). The original line is always kept on the
 * ingredient, so a conservative parse never destroys the source text.
 */

import type { Ingredient, IngredientGroup, IngredientLink } from '../types'

const UNIT_WORDS = new Set([
  // metric / volume
  'g', 'kg', 'mg', 'l', 'ml', 'cl', 'dl', 'liter', 'gramm', 'kilogramm',
  // spoons / pinches
  'el', 'tl', 'msp', 'esslöffel', 'teelöffel', 'messerspitze',
  // counts / containers
  'prise', 'prisen', 'stück', 'stk', 'stk.', 'bund', 'becher', 'dose', 'dosen',
  'glas', 'gläser', 'pck', 'packung', 'päckchen', 'beutel', 'tube', 'flasche',
  'kugel', 'kugeln', 'zehe', 'zehen', 'scheibe', 'scheiben', 'blatt', 'blätter',
  'tasse', 'tassen', 'tropfen', 'cm', 'kopf', 'köpfe', 'knolle', 'knollen',
  'stange', 'stangen', 'zweig', 'zweige', 'handvoll', 'schuss', 'spritzer',
  'würfel', 'portion', 'portionen', 'ecke', 'ecken', 'riegel', 'topf',
  // English schema.org / Mela exports
  'cup', 'cups', 'tbsp', 'tsp', 'oz', 'lb', 'clove', 'cloves', 'pinch', 'can',
  'slice', 'slices',
])

/**
 * Canonical unit spelling for conservative text matching. The parser above
 * deliberately preserves the source spelling; automatic instruction scaling
 * only needs to know whether "EL", "Esslöffel" and "Essloeffel" describe the
 * same unit.
 */
const UNIT_ALIASES: Record<string, string> = {
  g: 'g',
  gr: 'g',
  gramm: 'g',
  kg: 'kg',
  kilo: 'kg',
  kilos: 'kg',
  kilogramm: 'kg',
  mg: 'mg',
  l: 'l',
  liter: 'l',
  ml: 'ml',
  milliliter: 'ml',
  cl: 'cl',
  zentiliter: 'cl',
  dl: 'dl',
  deziliter: 'dl',
  el: 'el',
  esslöffel: 'el',
  essloeffel: 'el',
  tl: 'tl',
  teelöffel: 'tl',
  teeloeffel: 'tl',
  msp: 'msp',
  messerspitze: 'msp',
  messerspitzen: 'msp',
  prise: 'prise',
  prisen: 'prise',
  stück: 'stück',
  stk: 'stück',
  stueck: 'stück',
  bund: 'bund',
  bünde: 'bund',
  buende: 'bund',
  becher: 'becher',
  dose: 'dose',
  dosen: 'dose',
  glas: 'glas',
  gläser: 'glas',
  glaeser: 'glas',
  pck: 'packung',
  packung: 'packung',
  packungen: 'packung',
  päckchen: 'päckchen',
  paeckchen: 'päckchen',
  beutel: 'beutel',
  tube: 'tube',
  tuben: 'tube',
  flasche: 'flasche',
  flaschen: 'flasche',
  kugel: 'kugel',
  kugeln: 'kugel',
  zehe: 'zehe',
  zehen: 'zehe',
  scheibe: 'scheibe',
  scheiben: 'scheibe',
  blatt: 'blatt',
  blätter: 'blatt',
  blaetter: 'blatt',
  tasse: 'tasse',
  tassen: 'tasse',
  tropfen: 'tropfen',
  cm: 'cm',
  kopf: 'kopf',
  köpfe: 'kopf',
  koepfe: 'kopf',
  knolle: 'knolle',
  knollen: 'knolle',
  stange: 'stange',
  stangen: 'stange',
  zweig: 'zweig',
  zweige: 'zweig',
  handvoll: 'handvoll',
  schuss: 'schuss',
  spritzer: 'spritzer',
  würfel: 'würfel',
  wuerfel: 'würfel',
  portion: 'portion',
  portionen: 'portion',
  ecke: 'ecke',
  ecken: 'ecke',
  riegel: 'riegel',
  topf: 'topf',
  töpfe: 'topf',
  toepfe: 'topf',
  cup: 'cup',
  cups: 'cup',
  tbsp: 'tbsp',
  tablespoon: 'tbsp',
  tablespoons: 'tbsp',
  tsp: 'tsp',
  teaspoon: 'tsp',
  teaspoons: 'tsp',
  oz: 'oz',
  ounce: 'oz',
  ounces: 'oz',
  lb: 'lb',
  pound: 'lb',
  pounds: 'lb',
  clove: 'clove',
  cloves: 'clove',
  pinch: 'pinch',
  pinches: 'pinch',
  can: 'can',
  cans: 'can',
  slice: 'slice',
  slices: 'slice',
  gram: 'g',
  grams: 'g',
  kilogram: 'kg',
  kilograms: 'kg',
  liters: 'l',
  millilitre: 'ml',
  millilitres: 'ml',
  milliliters: 'ml',
}

/** Count/container units can be omitted or added around a plain number. */
const COUNT_UNITS = new Set([
  'prise', 'stück', 'bund', 'becher', 'dose', 'glas', 'packung', 'päckchen',
  'beutel', 'tube', 'flasche', 'kugel', 'zehe', 'scheibe', 'blatt', 'tasse',
  'tropfen', 'kopf', 'knolle', 'stange', 'zweig', 'handvoll', 'schuss',
  'spritzer', 'würfel', 'portion', 'ecke', 'riegel', 'topf', 'cup', 'clove',
  'pinch', 'can', 'slice',
])

/** Canonical spelling of a known unit, or null for unknown/ambiguous text. */
export function canonicalUnitWord(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const normalized = value
    .trim()
    .toLocaleLowerCase('de')
    .replace(/\.+$/, '')
    .replace(/\/n$/, '')
    .replace(/\(n\)$/, '')
    .replace(/\(en\)$/, '')
  if (!normalized) return null
  const alias = UNIT_ALIASES[normalized]
  if (alias) return alias
  return UNIT_WORDS.has(normalized) ? normalized : null
}

/** True for units that describe countable pieces rather than a measure. */
export function isCountUnit(value: string | null | undefined): boolean {
  const canonical = canonicalUnitWord(value)
  return canonical !== null && COUNT_UNITS.has(canonical)
}

/**
 * Conversion factor between two units of the same reliable dimension. Spoons
 * and cups intentionally stay exact-match only; mass and volume conversions
 * are deterministic and therefore safe for the automatic contradiction check.
 */
const UNIT_DIMENSIONS: Record<string, { dimension: 'mass' | 'volume'; factor: number }> = {
  g: { dimension: 'mass', factor: 1 },
  kg: { dimension: 'mass', factor: 1000 },
  mg: { dimension: 'mass', factor: 0.001 },
  ml: { dimension: 'volume', factor: 1 },
  cl: { dimension: 'volume', factor: 10 },
  dl: { dimension: 'volume', factor: 100 },
  l: { dimension: 'volume', factor: 1000 },
}

/** Factor for `fromUnit` → `toUnit`, or null when the units are not comparable. */
export function unitConversionFactor(
  fromUnit: string | null | undefined,
  toUnit: string | null | undefined,
): number | null {
  const from = canonicalUnitWord(fromUnit)
  const to = canonicalUnitWord(toUnit)
  if (!from || !to) return null
  if (from === to) return 1
  const fromDimension = UNIT_DIMENSIONS[from]
  const toDimension = UNIT_DIMENSIONS[to]
  if (!fromDimension || !toDimension || fromDimension.dimension !== toDimension.dimension) {
    return null
  }
  return fromDimension.factor / toDimension.factor
}

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

const SINGLE_QUANTITY = String.raw`(?:\d+\s+\d+\s*\/\s*\d+|\d+\s*\/\s*\d+|\d+(?:[.,]\d+)?)`
const LEADING_QUANTITY = new RegExp(
  String.raw`^(${SINGLE_QUANTITY}(?:\s*[-–]\s*${SINGLE_QUANTITY})?)\s*`,
)

const QUALIFIER = /^(ca|etwa|circa|zirka|rund|ungefähr)(?:\.|\b)\s*/i
const SPELLED_QUANTITY =
  /^(?:ein(?:e|en|em|er|es)?\s+)?(halb(?:e[rnms]?)?|viertel|dreiviertel|eineinhalb|anderthalb)\b\s*/i

export interface IngredientLineInput {
  /** Original line as supplied by the import source. */
  raw: string
  /** Only set when the source explicitly separates a shopping hint. */
  purchaseNote?: string
  /** Only set when the source explicitly separates a preparation hint. */
  preparationNote?: string
  /** Explicit product/ingredient links supplied by a structured source. */
  links?: IngredientLink[]
}

export function parseIngredients(raw: string): {
  groups: IngredientGroup[]
  ingredients: Ingredient[]
  warnings: string[]
} {
  const lines = String(raw ?? '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => ({ raw: line }))
  return parseIngredientLines(lines)
}

/**
 * Parse already separated ingredient lines. This is the single ingredient
 * parser used by the Mela import, the URL import and the editor. Notes are only
 * accepted when the source supplied them explicitly; parentheses are never
 * interpreted automatically.
 */
export function parseIngredientLines(inputs: readonly IngredientLineInput[]): {
  groups: IngredientGroup[]
  ingredients: Ingredient[]
  warnings: string[]
} {
  const groups: IngredientGroup[] = []
  const ingredients: Ingredient[] = []
  const warnings: string[] = []
  let currentGroup: IngredientGroup | null = null

  inputs.forEach((input) => {
    const trimmed = input.raw.trim()
    if (!trimmed) return

    // Mela documents `#` as the marker for ingredient-group titles.
    const heading = /^#{1,6}\s+(.+?)\s*$/.exec(trimmed)
    if (heading) {
      const title = stripInlineMarkdown(heading[1] ?? '').trim() || trimmed
      currentGroup = {
        id: `group-${groups.length + 1}`,
        title,
        position: groups.length,
        rawHeading: trimmed,
      }
      groups.push(currentGroup)
      return
    }

    const ingredient = parseIngredientLine(trimmed, ingredients.length, currentGroup?.id ?? null)
    const purchaseNote = input.purchaseNote?.trim()
    const preparationNote = input.preparationNote?.trim()
    if (purchaseNote) ingredient.purchaseNote = purchaseNote
    if (preparationNote) ingredient.preparationNote = preparationNote
    if (input.links?.length) {
      const seen = new Set(ingredient.links.map((link) => link.url))
      for (const link of input.links) {
        if (!seen.has(link.url)) {
          ingredient.links.push(link)
          seen.add(link.url)
        }
      }
    }
    ingredients.push(ingredient)
  })

  const unstructured = ingredients.filter((item) => item.parseStatus === 'plain').length
  if (unstructured > 0) {
    warnings.push(
      `${unstructured} Zutatenzeile(n) ohne strukturierte Menge/Einheit – die Originalzeile bleibt erhalten.`,
    )
  }
  return { groups, ingredients, warnings }
}

/** Plain text of an ingredient line, with markdown links/labels removed. */
export function plainIngredientText(rawLine: string): string {
  const withoutLinks = rawLine.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
  return stripInlineMarkdown(withoutLinks).trim() || rawLine.trim()
}

/**
 * Display-only ordering: recognised quantities first, then the rest. Filtering
 * preserves the stored relative order and does not mutate the input array.
 * Plain section lines ("Für die Marinade:", "FÜR DAS DRESSING") stay in place
 * and partition the list, so they are never pushed to the bottom.
 */
export function orderIngredientsForDisplay(items: readonly Ingredient[]): Ingredient[] {
  const result: Ingredient[] = []
  let segment: Ingredient[] = []

  const flush = () => {
    result.push(...segment.filter((item) => item.quantity !== null))
    result.push(...segment.filter((item) => item.quantity === null))
    segment = []
  }

  for (const item of items) {
    if (isIngredientHeading(item)) {
      flush()
      result.push(item)
    } else {
      segment.push(item)
    }
  }
  flush()
  return result
}

function isIngredientHeading(ingredient: Ingredient): boolean {
  if (ingredient.quantity !== null) return false
  const text = ingredient.name.trim()
  if (!text) return false
  if (text.endsWith(':')) return true
  const letters = text.replace(/[^A-Za-zÄÖÜäöüß]/g, '')
  return (
    letters.length > 0 &&
    text === text.toLocaleUpperCase('de') &&
    text.split(/\s+/).length <= 6
  )
}

export function parseIngredientLine(
  rawLine: string,
  position: number,
  groupId: string | null,
): Ingredient {
  const links = extractMarkdownLinks(rawLine)
  const plain = plainIngredientText(rawLine)
  const id = `ing-${position + 1}`

  const base: Ingredient = {
    id,
    groupId,
    position,
    raw: rawLine,
    name: plain,
    quantity: null,
    quantityText: null,
    unit: null,
    purchaseNote: '',
    preparationNote: '',
    parseStatus: 'plain',
    links,
  }

  try {
    const leading = readLeadingQuantity(plain)
    if (!leading) return base
    const { unit, name } = splitUnit(leading.rest)
    if (!name) return base

    return {
      ...base,
      name,
      quantity: leading.quantity,
      quantityText: leading.quantityText,
      unit,
      parseStatus: 'parsed',
    }
  } catch {
    // A conservative parser must never lose the original line.
    return base
  }
}

interface LeadingQuantity {
  quantity: number
  quantityText: string
  rest: string
}

/**
 * Read a quantity prefix conservatively. It accepts optional qualifiers
 * ("ca.", "etwa"), numeric values/ranges/fractions, and a small set of spoken
 * fractions ("halbe", "viertel", ...). Ambiguous text returns null.
 */
function readLeadingQuantity(text: string): LeadingQuantity | null {
  let rest = text
  let qualifier = ''
  const qualifierMatch = QUALIFIER.exec(rest)
  if (qualifierMatch) {
    qualifier = qualifierMatch[0].trim()
    rest = rest.slice(qualifierMatch[0].length)
  }

  const first = rest.charAt(0)
  const unicodeValue = UNICODE_FRACTIONS[first]
  if (unicodeValue !== undefined) {
    return {
      quantity: unicodeValue,
      quantityText: withQualifier(qualifier, first),
      rest: rest.slice(1).trim(),
    }
  }

  const mixedUnicode = /^(\d+)\s*([½¼¾⅓⅔⅛⅜⅝⅞])\s*/.exec(rest)
  if (mixedUnicode) {
    const whole = Number(mixedUnicode[1])
    const fraction = UNICODE_FRACTIONS[mixedUnicode[2] ?? '']
    if (Number.isFinite(whole) && fraction !== undefined) {
      return {
        quantity: whole + fraction,
        quantityText: withQualifier(qualifier, `${whole}${mixedUnicode[2]}`),
        rest: rest.slice(mixedUnicode[0].length).trim(),
      }
    }
  }

  const spelled = SPELLED_QUANTITY.exec(rest)
  if (spelled) {
    const spoken = spokenQuantity((spelled[1] ?? '').toLowerCase())
    if (spoken) {
      return {
        quantity: spoken.value,
        quantityText: withQualifier(qualifier, spoken.text),
        rest: rest.slice(spelled[0].length).trim(),
      }
    }
  }

  // "eine Prise", "ein Bund": only treat the article as one when a real unit
  // follows. "ein wenig Salz" must stay plain.
  const one = /^ein(?:e|en|em|er|es)?\s+/i.exec(rest)
  if (one) {
    const afterOne = rest.slice(one[0].length)
    const { unit } = splitUnit(afterOne)
    if (unit) {
      return {
        quantity: 1,
        quantityText: withQualifier(qualifier, '1'),
        rest: afterOne,
      }
    }
  }

  const match = LEADING_QUANTITY.exec(rest)
  if (!match) return null
  const quantity = parseQuantity(match[1] ?? '')
  if (quantity === null) return null
  return {
    quantity,
    quantityText: withQualifier(qualifier, (match[1] ?? '').trim()),
    rest: rest.slice(match[0].length).trim(),
  }
}

function withQualifier(qualifier: string, value: string): string {
  return qualifier ? `${qualifier} ${value}` : value
}

function spokenQuantity(token: string): { value: number; text: string } | null {
  if (token.startsWith('halb')) return { value: 0.5, text: '½' }
  if (token === 'viertel') return { value: 0.25, text: '¼' }
  if (token === 'dreiviertel') return { value: 0.75, text: '¾' }
  if (token === 'eineinhalb' || token === 'anderthalb') return { value: 1.5, text: '1 1/2' }
  return null
}

function parseQuantity(token: string): number | null {
  let value = token.trim()
  if (!value) return null
  // Ranges use their lower bound, exactly like the previous parser.
  if (value.includes('-') || value.includes('–')) {
    value = (value.split(/[-–]/, 1)[0] ?? '').trim()
    if (!value) return null
  }
  if (value.includes(' ') && value.includes('/')) {
    const [whole, fraction] = value.split(/\s+/, 2)
    const wholeNumber = Number.parseFloat((whole ?? '').replace(',', '.'))
    const fractionValue = parseFraction(fraction ?? '')
    if (!Number.isFinite(wholeNumber) || fractionValue === null) return null
    return wholeNumber + fractionValue
  }
  if (value.includes('/')) return parseFraction(value)
  const parsed = Number.parseFloat(value.replace(',', '.'))
  return Number.isFinite(parsed) ? parsed : null
}

function parseFraction(value: string): number | null {
  const parts = value.split('/')
  if (parts.length !== 2) return null
  const numerator = Number.parseFloat(parts[0] ?? '')
  const denominator = Number.parseFloat(parts[1] ?? '')
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) return null
  return numerator / denominator
}

/** Split "<unit> <name>"; only take a unit when a non-empty ingredient name remains. */
function splitUnit(rest: string): { unit: string | null; name: string } {
  const text = rest.trim()
  if (!text) return { unit: null, name: '' }
  const parts = text.split(/\s+/)
  for (let count = Math.min(3, parts.length - 1); count >= 1; count -= 1) {
    const candidate = parts.slice(0, count).join(' ')
    const normalized = candidate
      .toLowerCase()
      .replace(/\.$/, '')
      .replace(/\/n$/, '')
      .replace(/\(n\)$/, '')
      .replace(/\(en\)$/, '')
    if (UNIT_WORDS.has(normalized)) {
      return {
        unit: candidate,
        name: parts.slice(count).join(' ').trim(),
      }
    }
  }
  return { unit: null, name: text }
}

function extractMarkdownLinks(value: string): IngredientLink[] {
  const links: IngredientLink[] = []
  const regex = /\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g
  for (const match of value.matchAll(regex)) {
    const label = match[1]?.trim()
    const url = match[2]?.trim()
    if (label && url) links.push({ label, url })
  }
  return links
}

export function stripInlineMarkdown(value: string): string {
  return value
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/(\*|_)(.*?)\1/g, '$2')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
}
