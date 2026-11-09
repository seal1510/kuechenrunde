/*
 * openCook Web
 * Copyright (C) 2026 openCook Web contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Pure shopping-list rules. Demand is derived exactly once per planned
 * `CookSession`; manual articles, purchased amounts and learned product
 * corrections are merged on top for display. No React, Dexie or
 * recipe-specific special cases live here.
 */

import type {
  CookSession,
  FreeDish,
  Recipe,
  ShoppingCheck,
  ShoppingItemRule,
  ShoppingManualItem,
  ShoppingPurchase,
  ShoppingPurchasedAmount,
  ShoppingQuantityCorrection,
} from '../types'
import { addDays, formatWeekRange, startOfWeekOn } from './dates'
import { dishIdentityFor, dishShoppingNeeds, type DishSource } from './dishSource'
import { formatScaledNumber, parseQuantityToken } from './scaling'

export type ShoppingCategoryId =
  | 'produce'
  | 'meat'
  | 'dairy'
  | 'bakery'
  | 'grains'
  | 'canned'
  | 'spices'
  | 'frozen'
  | 'drinks'
  | 'household'
  | 'other'

export interface ShoppingCategory {
  id: ShoppingCategoryId
  label: string
}

export const SHOPPING_CATEGORIES: readonly ShoppingCategory[] = [
  { id: 'produce', label: 'Obst & Gemüse' },
  { id: 'meat', label: 'Fleisch & Fisch' },
  { id: 'dairy', label: 'Milchprodukte & Eier' },
  { id: 'bakery', label: 'Brot & Backwaren' },
  { id: 'grains', label: 'Nudeln, Reis & Getreide' },
  { id: 'canned', label: 'Konserven & Gläser' },
  { id: 'spices', label: 'Gewürze & Öle' },
  { id: 'frozen', label: 'Tiefkühlkost' },
  { id: 'drinks', label: 'Getränke' },
  { id: 'household', label: 'Haushalt & Drogerie' },
  { id: 'other', label: 'Sonstiges' },
]

export const DEFAULT_CATEGORY_ORDER: readonly ShoppingCategoryId[] =
  SHOPPING_CATEGORIES.map((category) => category.id)

export const CATEGORY_ORDER_SETTING_KEY = 'shoppingCategoryOrder'

const CATEGORY_BY_ID = new Map(SHOPPING_CATEGORIES.map((category) => [category.id, category]))

export function categoryLabel(id: ShoppingCategoryId): string {
  return CATEGORY_BY_ID.get(id)?.label ?? categoryLabel('other')
}

/** Known ids only, no duplicates; missing categories are appended. */
export function normalizeCategoryOrder(value: unknown): ShoppingCategoryId[] {
  const source = Array.isArray(value) ? value : []
  const seen = new Set<ShoppingCategoryId>()
  const order: ShoppingCategoryId[] = []
  for (const entry of source) {
    if (typeof entry !== 'string') continue
    if (!CATEGORY_BY_ID.has(entry as ShoppingCategoryId)) continue
    const id = entry as ShoppingCategoryId
    if (seen.has(id)) continue
    seen.add(id)
    order.push(id)
  }
  for (const id of DEFAULT_CATEGORY_ORDER) {
    if (!seen.has(id)) order.push(id)
  }
  return order
}

export function parseCategoryOrderSetting(value: unknown): ShoppingCategoryId[] {
  if (typeof value !== 'string' || !value.trim()) return [...DEFAULT_CATEGORY_ORDER]
  try {
    return normalizeCategoryOrder(JSON.parse(value))
  } catch {
    return [...DEFAULT_CATEGORY_ORDER]
  }
}

export function serializeCategoryOrder(order: readonly ShoppingCategoryId[]): string {
  return JSON.stringify(normalizeCategoryOrder(order))
}

export interface ShoppingWeek {
  /** Configured week start, "YYYY-MM-DD". */
  start: string
  end: string
  days: string[]
  label: string
}

export function shoppingWeek(anchor: string, weekStartDay: number): ShoppingWeek {
  const start = startOfWeekOn(anchor, weekStartDay)
  return shoppingWeekFromRange(start, addDays(start, 6))
}

/**
 * A persisted shopping period can be shorter than seven days when it fills the
 * gap left by an existing list under another rhythm. Its boundaries are
 * authoritative.
 */
export function shoppingWeekFromRange(start: string, end: string): ShoppingWeek {
  const last = end >= start ? end : start
  const days: string[] = []
  for (let index = 0; ; index += 1) {
    const day = addDays(start, index)
    days.push(day)
    if (day === last || index > 3660) break
  }
  return {
    start,
    end: days[days.length - 1] ?? start,
    days,
    label: formatWeekRange(start, days[days.length - 1] ?? start),
  }
}

export function isCurrentShoppingWeek(
  weekStart: string,
  today: string,
  weekStartDay: number,
): boolean {
  return startOfWeekOn(today, weekStartDay) === weekStart
}

/* ------------------------------------------------------------------ */
/* Names and product identity                                          */
/* ------------------------------------------------------------------ */

/** Lowercase, fold German umlauts, unify sharp s and spacing. */
function fold(value: string): string {
  return value
    .toLowerCase()
    .replace(/ä/g, 'a')
    .replace(/ö/g, 'o')
    .replace(/ü/g, 'u')
    .replace(/ß/g, 'ss')
    .replace(/soße/g, 'sauce')
    .replace(/sosse/g, 'sauce')
    .replace(/\s+/g, ' ')
    .trim()
}

function stemWord(word: string): string {
  if (word.length <= 4) return word
  // One conservative plural/singular sweep. The same rule is applied to both
  // directions, so "Tomaten" and "Tomate" land on the same key.
  for (const suffix of ['en', 'er', 'n', 'e', 's']) {
    if (!word.endsWith(suffix)) continue
    if (suffix === 's' && word.endsWith('ss')) continue
    const stem = word.slice(0, -suffix.length)
    if (stem.length >= 3) return stem
  }
  return word
}

/**
 * Stable product identity, independent from the rendered label. Only the
 * spelling is normalised; unknown parentheses stay part of the identity so
 * different product variants are never merged by accident.
 */
export function shoppingItemKey(name: string): string {
  const folded = fold(name)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!folded) return ''
  return folded
    .split(' ')
    .map(stemWord)
    .filter(Boolean)
    .join(' ')
}

const STRONG_PREPARATION_WORDS = new Set([
  'gehackt',
  'gewurfelt',
  'gewürfelt',
  'geschnitten',
  'gemahlen',
  'gerieben',
  'gezupft',
  'gewaschen',
  'abgetropft',
  'geschalt',
  'geschält',
  'geputzt',
  'entkernt',
  'entsteint',
  'halbiert',
  'geviertelt',
  'zerteilt',
  'zerkleinert',
  'zerdruckt',
  'zerdrückt',
  'zerstossen',
  'zerstoßen',
  'ausgedruckt',
  'ausgedrückt',
  'abgerieben',
  'abgespult',
  'abgespült',
  'gepresst',
  'geraspelt',
  'gestiftet',
  'geblanchiert',
  'geviertelt',
])

const STRONG_PREPARATION_PREFIXES = [
  'gehackt',
  'gewurfelt',
  'geschnitten',
  'gemahlen',
  'gerieben',
  'gezupft',
  'gewaschen',
  'abgetropft',
  'geschalt',
  'geputzt',
  'entkernt',
  'entsteint',
  'halbiert',
  'geviertelt',
  'zerteilt',
  'zerkleinert',
  'zerdruckt',
  'zerstossen',
  'ausgedruckt',
  'abgerieben',
  'abgespult',
  'gepresst',
  'geraspelt',
  'gestiftet',
  'geblanchiert',
]

const WEAK_PREPARATION_WORDS = new Set([
  'fein',
  'feine',
  'feinen',
  'feiner',
  'feines',
  'grob',
  'grobe',
  'groben',
  'grober',
  'grobes',
  'klein',
  'kleine',
  'kleinen',
  'kleiner',
  'kleines',
  'mittelgross',
  'mittelgroß',
  'gross',
  'groß',
  'frisch',
  'in',
  'streifen',
  'wurfel',
  'würfel',
  'scheiben',
  'stucke',
  'stücke',
  'ringe',
  'stifte',
  'mundgerechte',
  'mundgerecht',
])

/**
 * A parenthetical is only treated as preparation when every token is a known,
 * generic kitchen descriptor and at least one real cutting/grinding verb is
 * present. Everything else (brands, product varieties, unclear notes) stays
 * part of the shopping name.
 */
const CUT_FORM_WORDS = new Set([
  'scheiben',
  'stifte',
  'streifen',
  'ringe',
  'wurfel',
  'würfel',
  'stucke',
  'stücke',
])

export function isPreparationPhrase(value: string): boolean {
  const tokens = fold(value)
    .replace(/[.,;:]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
  if (tokens.length === 0) return false
  let strong = 0
  for (const token of tokens) {
    if (
      STRONG_PREPARATION_WORDS.has(token) ||
      STRONG_PREPARATION_PREFIXES.some(
        (prefix) => token.startsWith(prefix) && token.length - prefix.length <= 2,
      )
    ) {
      strong += 1
      continue
    }
    if (WEAK_PREPARATION_WORDS.has(token)) continue
    return false
  }
  if (strong > 0) return true
  // "in Scheiben", "in Würfel", "in Streifen" has no participle but is still
  // an unambiguous preparation instruction.
  return tokens.includes('in') && tokens.some((token) => CUT_FORM_WORDS.has(token))
}

const PURCHASE_MARKERS = [
  /\bbevorzugt\b/,
  /\bz\s*\.?\s*b\s*\.?\b/,
  /\bzum\s+beispiel\b/,
  /\bmarke\b/,
  /\balternativ\b/,
]

function isPurchasePhrase(value: string): boolean {
  const folded = fold(value)
  return PURCHASE_MARKERS.some((pattern) => pattern.test(folded))
}

const COOKING_PURPOSE_VERBS = [
  'nachgiessen',
  'nachgießen',
  'abschmecken',
  'bestreuen',
  'garnieren',
  'servieren',
  'dekorieren',
  'einfetten',
  'ausstreichen',
  'binden',
  'abloschen',
  'ablöschen',
  'betraufeln',
  'braten',
  'backen',
  'frittieren',
  'kochen',
  'dunsten',
  'dünsten',
  'andicken',
  'verfeinern',
  'marinieren',
  'bestreichen',
  'belegen',
  'bestauben',
  'bestäuben',
  'unterruhren',
  'unterrühren',
  'aufgiessen',
  'aufgießen',
  'würzen',
  'wurzen',
  'nachwurzen',
]

const COOKING_PURPOSE = new RegExp(
  `\\b(?:zum|zur)\\s+(?:${COOKING_PURPOSE_VERBS.join('|')})\\b`,
)
const TRAILING_PURPOSE = new RegExp(
  `[\\s,;]*(?:zum|zur)\\s+(?:${COOKING_PURPOSE_VERBS.join('|')})\\s*$`,
  'i',
)
const TRAILING_AMOUNT_HINT = /[\s,;]*nach\s+(?:geschmack|bedarf|belieben)\s*$/i
const LEADING_OPTIONAL = /^(?:evtl\.?|eventuell|optional|ggf\.?|gegebenenfalls)\s+/i

/**
 * A number with a real unit, e.g. "400 g", "ca. 0,5 l" or "2 Stück". Such a
 * parenthetical describes the package/amount and must not become part of the
 * product identity.
 */
function isMeasurementPhrase(value: string): boolean {
  const amount = String.raw`(?:\d+\s*\/\s*\d+|\d+(?:[.,]\d+)?|[½¼¾⅓⅔⅛⅜⅝⅞])`
  const pattern = new RegExp(
    String.raw`^(?:ca\.?|etwa|circa|rund|zirka)?\s*${amount}(?:\s*[-–]\s*${amount})?\s*(?:g|kg|mg|ml|l|cl|dl|stück|stk\.?|x|el|tl|msp|prise|bund|packung|pck\.?|dose|glas|beutel|tube|flasche|scheibe|zehe|kopf|knolle|stange|zweig|handvoll)\s*$`,
    'i',
  )
  return pattern.test(value.trim())
}

/**
 * A phrase that describes what an ingredient is used for in the kitchen, not
 * something the shopper needs to put in the basket. Applied to trailing
 * parentheses and to trailing clauses of a whole line.
 */
export function isCookingPurposePhrase(value: string): boolean {
  const folded = fold(value).replace(/[.,;:!?]+$/g, '').trim()
  if (!folded) return false
  return COOKING_PURPOSE.test(folded)
}

/** Strip a usage clause from the end; returns the remaining name. */
function stripTrailingUsage(value: string): { name: string; removed: string } {
  let name = value.trim()
  const removed: string[] = []
  for (let round = 0; round < 3; round += 1) {
    const purpose = TRAILING_PURPOSE.exec(name)
    if (purpose) {
      removed.push(purpose[0].replace(/^[\s,;]+/, '').trim())
      name = name.slice(0, purpose.index).trim().replace(/[,;]+$/, '').trim()
      continue
    }
    const amount = TRAILING_AMOUNT_HINT.exec(name)
    if (amount) {
      removed.push(amount[0].replace(/^[\s,;]+/, '').trim())
      name = name.slice(0, amount.index).trim().replace(/[,;]+$/, '').trim()
      continue
    }
    break
  }
  return { name, removed: removed.join(', ') }
}

/** Strip "evtl.", "optional", ... from the start of an ingredient line. */
function stripLeadingOptional(value: string): { name: string; removed: string } {
  const match = LEADING_OPTIONAL.exec(value)
  if (!match) return { name: value, removed: '' }
  return {
    name: value.slice(match[0].length).trim(),
    removed: match[0].trim(),
  }
}

export type ShoppingIngredientDecision = 'product' | 'cleaned' | 'instruction'

export interface SplitIngredientName {
  /** Visible base name without preparation or variant parentheses. */
  name: string
  /** Product-determining variant, e.g. "grün" or "Type 405". */
  variant: string
  /** Name used for the automatic product identity (base + variant). */
  identityName: string
  /** Removed preparation hint (not shown on the shopping list). */
  preparationNote: string
  /** Reliable purchase/description hint, e.g. "bevorzugt Mutti". */
  embeddedPurchaseNote: string
  /** True when at least one part of the original line was cleaned/removed. */
  cleaned: boolean
}

export interface ShoppingIngredientClassification {
  decision: ShoppingIngredientDecision
  split: SplitIngredientName
  /** Human-readable reason for an excluded instruction line. */
  reason: string
}

/**
 * Split an imported ingredient line into the four shopping-relevant parts:
 *
 * 1. base product name,
 * 2. product-determining variant (must influence identity),
 * 3. preparation hint (never shown as a purchase preference),
 * 4. reliable purchase hint.
 *
 * Unknown parentheticals are handled conservatively: they stay part of the
 * product identity as a variant instead of being discarded as decoration.
 */
export function splitIngredientName(rawName: string): SplitIngredientName {
  let name = String(rawName ?? '').trim()
  let cleaned = false
  const preparation: string[] = []
  const purchase: string[] = []
  const variants: string[] = []

  const leading = stripLeadingOptional(name)
  if (leading.removed) {
    cleaned = true
    preparation.push(leading.removed)
    name = leading.name
  }

  for (let round = 0; round < 4; round += 1) {
    const match = /\(([^()]*)\)\s*[.,;]?\s*$/.exec(name)
    if (!match) break
    const content = (match[1] ?? '').trim()
    if (!content) break
    if (isPreparationPhrase(content) || isCookingPurposePhrase(content)) {
      preparation.push(content)
      cleaned = true
    } else if (isMeasurementPhrase(content)) {
      purchase.push(content)
      cleaned = true
    } else if (isPurchasePhrase(content)) {
      purchase.push(content)
      cleaned = true
    } else {
      // Unknown: could be a variety, type, fat level, brand or composition.
      // Never throw it away; it defines the product identity.
      variants.push(content)
      cleaned = true
    }
    name = name.slice(0, match.index).trim().replace(/[,;]+$/, '').trim()
  }

  // "Zwiebeln, fein gewürfelt" / "Rotwein, trocken" without parentheses.
  const comma = /^(.*),\s*([^,]+)$/.exec(name)
  if (comma) {
    const tail = (comma[2] ?? '').trim()
    if (isPreparationPhrase(tail) || isCookingPurposePhrase(tail)) {
      preparation.push(tail)
      cleaned = true
      name = (comma[1] ?? '').trim()
    } else if (isPurchasePhrase(tail)) {
      purchase.push(tail)
      cleaned = true
      name = (comma[1] ?? '').trim()
    }
  }

  const usage = stripTrailingUsage(name)
  if (usage.removed) {
    preparation.push(usage.removed)
    cleaned = true
    name = usage.name
  }

  name = name.replace(/\s+/g, ' ').trim()
  const variant = variants.join(' · ').trim()
  return {
    name: name || String(rawName ?? '').trim(),
    variant,
    identityName: [name, variants.join(' ')].filter(Boolean).join(' ').trim(),
    preparationNote: preparation.join(', '),
    embeddedPurchaseNote: purchase.join(', '),
    cleaned,
  }
}

/**
 * Decide whether an ingredient line is a product, a product that only needs
 * cleaning, or a pure instruction. Concrete products are never dropped just
 * because they contain a usage clause.
 */
export function classifyIngredientForShopping(
  rawName: string,
): ShoppingIngredientClassification {
  const text = String(rawName ?? '').replace(/\s+/g, ' ').trim()
  if (!text) {
    return {
      decision: 'instruction',
      split: splitIngredientName(text),
      reason: 'Leere Zeile',
    }
  }
  if (text.endsWith(':')) {
    return {
      decision: 'instruction',
      split: splitIngredientName(text),
      reason: 'Abschnittsüberschrift',
    }
  }
  const letters = text.replace(/[^A-Za-zÄÖÜäöüß]/g, '')
  if (letters.length > 0 && text === text.toLocaleUpperCase('de')) {
    const heading = fold(text)
    if (
      text.split(/\s+/).length <= 6 &&
      /\b(fur|fuer|zutaten|marinade|dressing|sosse|sauce|teig|belag|garnitur|zubereitung|beilage|vorspeise|dessert|nachtisch)\b/.test(
        heading,
      )
    ) {
      return {
        decision: 'instruction',
        split: splitIngredientName(text),
        reason: 'Abschnittsüberschrift',
      }
    }
  }

  const split = splitIngredientName(text)
  const folded = fold(split.name).replace(/[.,;:!?]+$/g, '').trim()
  if (!folded) {
    return { decision: 'instruction', split, reason: 'Reine Zubereitungsanweisung' }
  }
  if (
    /^(fur|fuer)\s+(die|den|das|alle|unsere|unseren)\b/.test(folded) ||
    /^(fur|fuer)\s+\d+\s+(personen|portionen)\b/.test(folded)
  ) {
    return { decision: 'instruction', split, reason: 'Abschnittsüberschrift' }
  }
  if (/^(nach bedarf|nach geschmack|bei bedarf|optional|wer mag)\b/.test(folded)) {
    return { decision: 'instruction', split, reason: 'Reine Verwendungsanweisung' }
  }
  if (/^(zutaten|zubereitung|marinade|dressing)$/.test(folded)) {
    return { decision: 'instruction', split, reason: 'Abschnittsüberschrift' }
  }

  // "Eventuell etwas Wasser zum Nachgießen": after removing optional and usage
  // clauses, only water remains. Water is the one base that is reliably a
  // cooking aid in this context; plain "Wasser" without a purpose stays a
  // product.
  const core = folded.replace(/^(etwas|ein wenig|etwas mehr)\s+/, '').trim()
  const rawFolded = fold(text)
  const hadUsageClause =
    COOKING_PURPOSE.test(rawFolded) || TRAILING_AMOUNT_HINT.test(rawFolded)
  if (core === 'wasser' && hadUsageClause) {
    return {
      decision: 'instruction',
      split,
      reason: 'Wasser ist hier nur eine Zubereitungsanweisung',
    }
  }

  return {
    decision: split.cleaned ? 'cleaned' : 'product',
    split,
    reason: '',
  }
}

/** Backwards-compatible helper: true only for pure instructions. */
export function isNonShoppingIngredient(name: string): boolean {
  return classifyIngredientForShopping(name).decision === 'instruction'
}

/**
 * Base-name -> unique new identity mapping for rule migration. A base is
 * ambiguous when current data also contains the plain base product or more
 * than one product variant. Ambiguous bases are never mapped automatically.
 */
export function shoppingIdentityMappings(names: readonly string[]): {
  unique: Map<string, string>
  ambiguous: Set<string>
  candidates: Map<string, Set<string>>
} {
  const variantsByBase = new Map<string, Set<string>>()
  const plainBases = new Set<string>()
  for (const value of names) {
    const split = splitIngredientName(value)
    const base = shoppingItemKey(split.name)
    const identity = shoppingItemKey(split.identityName)
    if (!base || !identity) continue
    if (base === identity) {
      plainBases.add(base)
      continue
    }
    const variants = variantsByBase.get(base) ?? new Set<string>()
    variants.add(identity)
    variantsByBase.set(base, variants)
  }
  const unique = new Map<string, string>()
  const ambiguous = new Set<string>()
  for (const [base, variants] of variantsByBase) {
    if (plainBases.has(base) || variants.size !== 1) {
      ambiguous.add(base)
      continue
    }
    const identity = Array.from(variants)[0]
    if (identity) unique.set(base, identity)
  }
  return { unique, ambiguous, candidates: variantsByBase }
}

/* ------------------------------------------------------------------ */
/* Units and amounts                                                   */
/* ------------------------------------------------------------------ */

interface UnitSpec {
  dimension: string
  factor: number
  /** Explicit unit for count/container units; null for g/ml (auto display). */
  displayUnit: string | null
  explicitUnit: boolean
}

const MASS_UNITS: Record<string, number> = {
  g: 1,
  gr: 1,
  gramm: 1,
  kg: 1000,
  kilogramm: 1000,
  mg: 0.001,
}

const VOLUME_UNITS: Record<string, number> = {
  ml: 1,
  milliliter: 1,
  l: 1000,
  liter: 1000,
  cl: 10,
  dl: 100,
}

const COUNT_UNITS = new Set(['stuck', 'stueck', 'stk', 'st', 'x', 'stuck.'])

const CONTAINER_UNITS: Record<string, string> = {
  el: 'EL',
  essloffel: 'EL',
  esslöffel: 'EL',
  tl: 'TL',
  teeloffel: 'TL',
  teelöffel: 'TL',
  msp: 'MSP',
  messerspitze: 'MSP',
  prise: 'Prise',
  prisen: 'Prise',
  bund: 'Bund',
  becher: 'Becher',
  dose: 'Dose',
  dosen: 'Dose',
  glas: 'Glas',
  glaser: 'Glas',
  gläser: 'Glas',
  pck: 'Packung',
  packung: 'Packung',
  packchen: 'Packung',
  päckchen: 'Packung',
  beutel: 'Beutel',
  tube: 'Tube',
  flasche: 'Flasche',
  flaschen: 'Flasche',
  kugel: 'Kugel',
  kugeln: 'Kugel',
  zehe: 'Zehe',
  zehen: 'Zehe',
  scheibe: 'Scheibe',
  scheiben: 'Scheibe',
  blatt: 'Blatt',
  blätter: 'Blatt',
  tasse: 'Tasse',
  tassen: 'Tasse',
  tropfen: 'Tropfen',
  cm: 'cm',
  kopf: 'Kopf',
  kopfe: 'Kopf',
  köpfe: 'Kopf',
  knolle: 'Knolle',
  knollen: 'Knolle',
  stange: 'Stange',
  stangen: 'Stange',
  zweig: 'Zweig',
  zweige: 'Zweig',
  handvoll: 'Handvoll',
  schuss: 'Schuss',
  spritzer: 'Spritzer',
  portion: 'Portion',
  portionen: 'Portion',
  ecke: 'Ecke',
  ecken: 'Ecke',
  riegel: 'Riegel',
  topf: 'Topf',
  cup: 'Cup',
  cups: 'Cup',
  tbsp: 'EL',
  tsp: 'TL',
  clove: 'Zehe',
  cloves: 'Zehe',
  pinch: 'Prise',
  can: 'Dose',
  slice: 'Scheibe',
  slices: 'Scheibe',
  pfund: 'Pfund',
  oz: 'oz',
  lb: 'lb',
}

function normalizedUnit(unit: string | null | undefined): string {
  return fold(unit ?? '')
    .replace(/\.+$/g, '')
    .trim()
}

function unitSpec(unit: string | null | undefined): UnitSpec {
  const clean = normalizedUnit(unit)
  if (!clean) {
    return { dimension: 'count', factor: 1, displayUnit: null, explicitUnit: false }
  }
  if (clean in MASS_UNITS) {
    return { dimension: 'mass', factor: MASS_UNITS[clean] ?? 1, displayUnit: null, explicitUnit: false }
  }
  if (clean in VOLUME_UNITS) {
    return {
      dimension: 'volume',
      factor: VOLUME_UNITS[clean] ?? 1,
      displayUnit: null,
      explicitUnit: false,
    }
  }
  if (COUNT_UNITS.has(clean)) {
    return { dimension: 'count', factor: 1, displayUnit: 'Stück', explicitUnit: true }
  }
  const display = CONTAINER_UNITS[clean]
  if (display) {
    return {
      dimension: `unit:${display.toLowerCase()}`,
      factor: 1,
      displayUnit: display,
      explicitUnit: true,
    }
  }
  // An unknown but explicit unit stays its own dimension; it is never merged
  // with grams, millilitres or pieces by guesswork.
  return {
    dimension: `unit:${clean}`,
    factor: 1,
    displayUnit: unit?.trim() ?? clean,
    explicitUnit: true,
  }
}

export interface ShoppingAmountPosition {
  /** "mass", "volume", "count" or "unit:<label>". */
  dimension: string
  /** Display unit for count/container positions; null for g/ml (auto). */
  unit: string | null
  /** Amounts in the dimension's base unit (g, ml, pieces). */
  lower: number
  upper: number
  qualifier: string
}

function positionUnitLabel(dimension: string): string | null {
  if (dimension.startsWith('unit:')) {
    const raw = dimension.slice('unit:'.length)
    const match = Object.entries(CONTAINER_UNITS).find(
      ([key, value]) => value.toLowerCase() === raw,
    )
    return match?.[1] ?? raw
  }
  return dimension === 'count' ? null : null
}

/** Readable amount, converting g→kg and ml→l at 1000. Ranges keep both bounds. */
export function formatShoppingAmount(position: ShoppingAmountPosition): string {
  const unit = position.unit ?? positionUnitLabel(position.dimension)
  let lower = position.lower
  let upper = position.upper
  let displayUnit = unit

  if (position.dimension === 'mass' || position.dimension === 'volume') {
    const threshold = 1000
    if (Math.max(Math.abs(lower), Math.abs(upper)) >= threshold) {
      lower /= 1000
      upper /= 1000
      displayUnit = position.dimension === 'mass' ? 'kg' : 'l'
    } else {
      displayUnit = position.dimension === 'mass' ? 'g' : 'ml'
    }
  }

  const lowText = formatScaledNumber(lower)
  const highText = formatScaledNumber(upper)
  const body = lower === upper ? lowText : `${lowText}–${highText}`
  const qualifier = position.qualifier.trim()
  return [qualifier ? `${qualifier} ${body}` : body, displayUnit ?? '']
    .filter(Boolean)
    .join(' ')
}

/** Editable display form of one amount; used by the correction dialog. */
export interface EditableShoppingAmount {
  quantityText: string
  unit: string
}

/** Convert a stored base-unit amount back into a human editable value. */
export function editableShoppingAmount(position: ShoppingAmountPosition): EditableShoppingAmount {
  let lower = position.lower
  let upper = position.upper
  let unit = position.unit ?? positionUnitLabel(position.dimension) ?? ''
  if (position.dimension === 'mass' || position.dimension === 'volume') {
    if (Math.max(Math.abs(lower), Math.abs(upper)) >= 1000) {
      lower /= 1000
      upper /= 1000
      unit = position.dimension === 'mass' ? 'kg' : 'l'
    } else {
      unit = position.dimension === 'mass' ? 'g' : 'ml'
    }
  }
  const lowText = formatScaledNumber(lower)
  const highText = formatScaledNumber(upper)
  const body = lower === upper ? lowText : `${lowText}–${highText}`
  const qualifier = position.qualifier.trim()
  return {
    quantityText: qualifier ? `${qualifier} ${body}` : body,
    unit,
  }
}

/** Human label for the dimension a quantity correction belongs to. */
export function quantityDimensionLabel(dimension: string): string {
  if (dimension === 'mass') return 'Gewicht'
  if (dimension === 'volume') return 'Flüssigkeit'
  if (dimension === 'count') return 'Stückzahl'
  if (dimension.startsWith('unit:')) {
    const label = dimension.slice('unit:'.length)
    return label.charAt(0).toLocaleUpperCase('de') + label.slice(1)
  }
  return dimension
}

/** Stable signature of one uncorrected demand position. */
export function shoppingPositionSignature(position: ShoppingAmountPosition | undefined): string {
  if (!position) return ''
  return [
    position.dimension,
    roundAmount(position.lower),
    roundAmount(position.upper),
    position.qualifier.trim(),
  ].join('|')
}

/** Dimension produced by a unit; used to keep corrections dimension-safe. */
export function shoppingUnitDimension(unit: string | null | undefined): string | null {
  return parseAmount('1', unit)?.spec.dimension ?? null
}

/** Parse a user-entered amount for one specific correction position. */
export function parseShoppingQuantityPosition(
  text: string,
  unit: string | null | undefined,
): ShoppingAmountPosition | null {
  const amount = parseAmount(text, unit)
  return amount ? positionFromAmount(amount) : null
}

function roundAmount(value: number): number {
  return Math.round(value * 1000) / 1000
}

/* ------------------------------------------------------------------ */
/* Automatic category assignment                                       */
/* ------------------------------------------------------------------ */

const CATEGORY_KEYWORDS: Array<[ShoppingCategoryId, string[]]> = [
  [
    'household',
    [
      'toilettenpapier', 'kuchenrolle', 'küchenrolle', 'spulmittel', 'spülmittel',
      'waschmittel', 'weichspuler', 'weichspüler', 'reiniger', 'seife', 'shampoo',
      'zahnpasta', 'zahnburste', 'zahnbürste', 'mullbeutel', 'müllbeutel',
      'alufolie', 'frischhaltefolie', 'backpapier', 'serviette', 'servietten',
      'putzlappen', 'schwamm', 'kerze', 'kerzen', 'batterie', 'batterien',
      'kaffeefilter', 'filtertute', 'filtertüte', 'duschgel', 'deodorant',
      'wc',
    ],
  ],
  [
    'frozen',
    ['tiefkuhl', 'tiefkühl', 'gefroren', 'gefrier', 'eiswurfel', 'eiswürfel'],
  ],
  [
    'drinks',
    [
      'wasser', 'mineralwasser', 'saft', 'orangensaft', 'apfelsaft', 'wein', 'rotwein',
      'weisswein', 'weißwein', 'bier', 'limonade', 'cola', 'schorle', 'kaffee',
      'espresso', 'tee', 'teebeutel', 'kaffeebohnen', 'kakao', 'getrank', 'getränk',
      'prosecco', 'sekt', 'likor', 'likör',
    ],
  ],
  [
    'meat',
    [
      'fleisch', 'hack', 'hackfleisch', 'rind', 'rinder', 'schwein', 'schweine',
      'huhn', 'huhner', 'hühner', 'hahnchen', 'hähnchen', 'haehnchen', 'pute',
      'puten', 'lamm', 'steak', 'schnitzel', 'wurst', 'wurste', 'würste',
      'schinken', 'speck', 'bacon', 'salami', 'chorizo', 'fisch', 'lachs',
      'thunfisch', 'forelle', 'kabeljau', 'garnele', 'garnelen', 'scampi',
      'shrimp', 'muschel', 'muscheln', 'tintenfisch', 'matjes', 'hering',
      'bratwurst', 'aufschnitt', 'geflugel', 'geflügel', 'gulasch',
      'gehacktes', 'hackepeter', 'faschiertes',
    ],
  ],
  [
    'canned',
    [
      'dose', 'dosen', 'konserve', 'konserven', 'passierte tomate', 'passierte tomaten',
      'tomatenmark', 'pesto', 'marmelade', 'konfiture', 'konfitüre', 'kokosmilch',
      'kokosnussmilch', 'mais', 'kichererbse', 'kichererbsen', 'linsen', 'bohnen',
      'sauce', 'sosse', 'soße', 'brühe', 'bruhe', 'fond', 'suppe', 'fertiggericht',
      'oliven', 'kapern', 'artischocke', 'artischocken', 'sonnengetrocknete',
      'thunfischdose', 'sardine', 'sardinen', 'sardellen', 'würzsauce', 'ketchup',
      'senfgurke', 'senfgurken', 'essiggurke', 'essiggurken', 'mandeln', 'nusse',
      'nüsse', 'rosinen',
    ],
  ],
  [
    'dairy',
    [
      'milch', 'butter', 'kase', 'käse', 'quark', 'joghurt', 'jogurt', 'sahne',
      'creme', 'creme fraiche', 'crème fraîche', 'schmand', 'mascarpone',
      'mozzarella', 'parmesan', 'feta', 'ricotta', 'huettenkase', 'hüttenkäse',
      'frischkase', 'frischkäse', 'ei', 'eier', 'eigelb', 'eiweiss', 'buttermilch',
      'kondensmilch', 'sauerrahm', 'skyr', 'gouda', 'emmentaler', 'bergkase',
      'bergkäse', 'pudding',
    ],
  ],
  [
    'bakery',
    [
      'brot', 'brote', 'brotchen', 'brötchen', 'baguette', 'toast', 'croissant',
      'brezel', 'bagel', 'kuchen', 'torte', 'gebäck', 'geback', 'semmel',
      'semmeln', 'laugengeback', 'zwieback', 'knackebrot', 'knäckebrot',
    ],
  ],
  [
    'spices',
    [
      'salz', 'pfeffer', 'gewurz', 'gewürz', 'gewurze', 'gewürze', 'olivenol',
      'olivenöl', 'rapsol', 'rapsöl', 'sonnenblumenol', 'sonnenblumenöl',
      'pflanzenol', 'pflanzenöl', 'kokosol', 'kokosöl', 'sesamol', 'sesamöl',
      'erdnussol', 'erdnussöl', 'leinol', 'leinöl', 'kurbiskernol', 'kürbiskernöl',
      'walnussol', 'walnussöl', 'traubenkernol', 'traubenkernöl', 'avocadoöl',
      'balsamico', 'balsamicoessig', 'mayonnaise', 'mayo', 'essig', 'senf', 'curry',
      'paprikapulver', 'zimt', 'muskat', 'vanille', 'curcuma', 'kurkuma',
      'kreuzkummel', 'kreuzkümmel', 'kummel', 'kümmel', 'chilipulver',
      'zucker', 'backpulver', 'natron', 'hefe', 'trockenhefe', 'vanillezucker',
      'speisestarke', 'speisestärke', 'starke', 'stärke', 'agar', 'gelatine',
      'safran', 'majoran', 'estragon', 'lorbeer',
    ],
  ],
  [
    'grains',
    [
      'nudel', 'nudeln', 'pasta', 'spaghetti', 'penne', 'fusilli', 'makkaroni',
      'lasagne', 'reis', 'reisnudel', 'reisnudeln', 'getreide', 'mehl', 'hafer',
      'haferflocke', 'haferflocken', 'quinoa', 'couscous', 'bulgur', 'polenta',
      'grieß', 'griess', 'hirse', 'gerste', 'dinkel', 'roggen', 'weizen',
      'cornflakes', 'müsli', 'musli', 'flocke', 'flocken', 'granola',
    ],
  ],
  [
    'produce',
    [
      'obst', 'gemuse', 'gemüse', 'zwiebel', 'zwiebeln', 'tomate', 'tomaten',
      'kartoffel', 'kartoffeln', 'karotte', 'karotten', 'mohre', 'möhre', 'mohren',
      'möhren', 'paprika', 'gurke', 'gurken', 'salat', 'apfel', 'äpfel', 'banane',
      'bananen', 'zitrone', 'zitronen', 'limette', 'limetten', 'orange', 'orangen',
      'beere', 'beeren', 'erdbeere', 'erdbeeren', 'himbeere', 'himbeeren',
      'blaubeere', 'blaubeeren', 'traube', 'trauben', 'birne', 'birnen',
      'pfirsich', 'pfirsiche', 'pflaume', 'pflaumen', 'avocado', 'avocados',
      'spinat', 'brokkoli', 'broccoli', 'blumenkohl', 'kohl', 'lauch', 'porree',
      'sellerie', 'pilz', 'pilze', 'champignon', 'champignons', 'zucchini',
      'aubergine', 'auberginen', 'kurbis', 'kürbis', 'knoblauch', 'krauter',
      'kräuter', 'petersilie', 'basilikum', 'koriander', 'dill', 'minze',
      'rosmarin', 'thymian', 'oregano', 'frühlingszwiebel', 'frühlingszwiebeln',
      'fenchel', 'rote beete', 'mangold', 'rucola', 'rukkola', 'ingwer', 'chili',
      'erbsen', 'spargel', 'radieschen', 'rettich', 'okra', 'pak choi',
    ],
  ],
]

/** Keywords too short/ambiguous to be matched inside a compound word. */
const EXACT_KEYWORDS = new Set(['ei', 'eier', 'eigelb', 'eiweiss', 'wc', 'tk', 'ol'])

interface CategoryKeyword {
  category: ShoppingCategoryId
  keyword: string
  words: string[]
}

const CATEGORY_KEYWORD_INDEX: CategoryKeyword[] = CATEGORY_KEYWORDS.flatMap(
  ([category, keywords]) =>
    keywords.map((keyword) => {
      const normalized = categoryText(keyword)
      return { category, keyword: normalized, words: normalized.split(' ').filter(Boolean) }
    }),
)

function categoryText(value: string): string {
  return fold(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * How strongly one keyword describes the product. German compound nouns carry
 * their head noun at the end ("Rinderbrühe", "Hackfleisch"), so a suffix match
 * outranks a prefix; a full multi-word match outranks a single word.
 */
function keywordScore(name: string, tokens: readonly string[], keyword: CategoryKeyword): number {
  if (keyword.words.length === 0) return 0
  if (keyword.words.length > 1) {
    if (name === keyword.keyword) return 1200 + keyword.keyword.length
    if (name.includes(` ${keyword.keyword} `)) return 900 + keyword.keyword.length
    if (name.startsWith(`${keyword.keyword} `) || name.endsWith(` ${keyword.keyword}`)) {
      return 800 + keyword.keyword.length
    }
    return 0
  }
  const word = keyword.keyword
  const exactOnly = EXACT_KEYWORDS.has(word) || word.length <= 2
  let best = 0
  for (const token of tokens) {
    if (token === word) {
      best = Math.max(best, 1000 + word.length)
      continue
    }
    if (exactOnly) continue
    if (token.endsWith(word) && token.length > word.length) {
      best = Math.max(best, 700 + word.length)
      continue
    }
    if (token.startsWith(word) && token.length > word.length) {
      best = Math.max(best, 450 + word.length)
      continue
    }
    if (word.length >= 4 && token.includes(word)) {
      best = Math.max(best, 150 + word.length)
    }
  }
  return best
}

/** General product-type heuristic; user corrections always take precedence. */
export function guessShoppingCategory(name: string): ShoppingCategoryId {
  const normalized = categoryText(name)
  if (!normalized) return 'other'
  // Explicit freezing markers describe the storage form, not the base product.
  if (
    /(^|\s)tiefkuhl/.test(normalized) ||
    /(^|\s)gefroren/.test(normalized) ||
    /(^|\s)tk(\s|$)/.test(normalized)
  ) {
    return 'frozen'
  }
  const tokens = normalized.split(' ').filter(Boolean)
  let bestCategory: ShoppingCategoryId = 'other'
  let bestScore = 0
  for (const keyword of CATEGORY_KEYWORD_INDEX) {
    const score = keywordScore(normalized, tokens, keyword)
    if (score > bestScore) {
      bestScore = score
      bestCategory = keyword.category
    }
  }
  return bestCategory
}

/* ------------------------------------------------------------------ */
/* Demand derivation                                                   */
/* ------------------------------------------------------------------ */

export interface ShoppingSource {
  kind: 'cook' | 'manual'
  label: string
  refId: string
}

interface MutablePosition {
  dimension: string
  unit: string | null
  lower: number
  upper: number
  qualifier: string
}

interface MutableGroup {
  key: string
  rawKeys: Set<string>
  names: string[]
  variants: Set<string>
  purchaseNotes: string[]
  positions: Map<string, MutablePosition>
  unparsedAmounts: Set<string>
  missingQuantity: boolean
  sources: ShoppingSource[]
  manualItems: ShoppingManualItem[]
  manualCategoryId: string | null
  scaleWarnings: Set<string>
}

export interface ShoppingMergedFrom {
  key: string
  name: string
}

export type ShoppingQuantityCorrectionStatus = 'applied' | 'stale'

export interface ShoppingQuantityCorrectionView extends ShoppingQuantityCorrection {
  /** Applied corrections match the current demand; stale ones need review. */
  status: ShoppingQuantityCorrectionStatus
}

export interface ShoppingListItem {
  key: string
  name: string
  /** Product-determining variant(s), e.g. "grün" or "Type 405". */
  variant: string
  categoryId: ShoppingCategoryId
  /** Original calculated demand before week-scoped quantity corrections. */
  derivedPositions: ShoppingAmountPosition[]
  /** Numeric demand before purchases, after valid quantity corrections. */
  requiredPositions: ShoppingAmountPosition[]
  /** Open numeric demand after purchased amounts were subtracted. */
  positions: ShoppingAmountPosition[]
  /** Unstructured amounts that are kept verbatim. */
  unparsedAmounts: string[]
  /** True when at least one contribution had no usable quantity. */
  missingQuantity: boolean
  /** Purchased totals from all individual purchase actions. */
  purchased: ShoppingAmountPosition[]
  purchases: ShoppingPurchase[]
  /** True when a learned rule exists for this product identity. */
  hasItemRule: boolean
  /** Week-scoped corrections, including stale ones that need review. */
  quantityCorrections: ShoppingQuantityCorrectionView[]
  /** Legacy product-wide quantity correction; never applied automatically. */
  legacyQuantityText: string
  legacyUnit: string
  /** Hints coming from recipes/manual articles, before user corrections. */
  derivedPurchaseNotes: string[]
  /** Single user-owned hint; with override it replaces recipe hints. */
  customPurchaseNote: string
  hiddenPurchaseNotes: string[]
  purchaseNoteOverride: boolean
  /** Effective hints after the user's hide/replace corrections. */
  purchaseNotes: string[]
  checked: boolean
  status: 'open' | 'done'
  sources: ShoppingSource[]
  manualItems: ShoppingManualItem[]
  /** Identities explicitly merged into this product; can be split again. */
  mergedFrom: ShoppingMergedFrom[]
  warnings: string[]
}

export interface ShoppingListResult {
  week: ShoppingWeek
  items: ShoppingListItem[]
  counts: { open: number; done: number }
  warnings: string[]
}

export interface ShoppingListInput {
  anchor: string
  /** Required for a computed regular week; ignored when persisted bounds are supplied. */
  weekStartDay?: number
  /**
   * Persisted period boundaries. When both are supplied they decide the visible
   * window, including a shortened gap period; `weekStartDay` is then only a
   * compatibility field and must not move the period.
   */
  periodStart?: string
  periodEnd?: string
  recipes: readonly Recipe[]
  freeDishes: readonly FreeDish[]
  cookSessions: readonly CookSession[]
  manualItems: readonly ShoppingManualItem[]
  /** Individual confirmed purchases. */
  purchases?: readonly ShoppingPurchase[]
  /** Legacy v10 checks; only converted when no purchases are supplied. */
  checks?: readonly ShoppingCheck[]
  rules: readonly ShoppingItemRule[]
  /** Week-scoped quantity corrections. */
  quantityCorrections?: readonly ShoppingQuantityCorrection[]
  /** Today, for current-week checks; defaults to the anchor. */
  today?: string
}

function parseAmount(text: string | null | undefined, unit: string | null | undefined) {
  const parsed = parseQuantityToken(text)
  if (!parsed) return null
  const spec = unitSpec(unit)
  const values = parsed.values
  if (
    values.length === 0 ||
    values.some((value) => !Number.isFinite(value) || value < 0) ||
    values.every((value) => value === 0)
  ) {
    return null
  }
  const lower = roundAmount((values[0] ?? 0) * spec.factor)
  const upper = roundAmount((values[1] ?? values[0] ?? 0) * spec.factor)
  return {
    spec,
    lower,
    upper: Math.max(lower, upper),
    qualifier: parsed.qualifier,
  }
}

function positionFromAmount(amount: NonNullable<ReturnType<typeof parseAmount>>): ShoppingAmountPosition {
  return {
    dimension: amount.spec.dimension,
    unit: amount.spec.displayUnit,
    lower: amount.lower,
    upper: amount.upper,
    qualifier: amount.qualifier,
  }
}

function safeSource(
  sources: Map<string, DishSource>,
  session: CookSession,
): DishSource | null {
  const identity = dishIdentityFor(session)
  if (!identity) return null
  return sources.get(
    identity.kind === 'recipe' ? `recipe:${identity.recipeId}` : `free:${identity.freeDishId}`,
  ) ?? null
}

function dishLabel(source: DishSource): string {
  return source.kind === 'recipe' ? source.recipe.title : source.freeDish.name
}

/** Follow persisted product aliases. Cycles stop at the last safe identity. */
function resolveKey(key: string, byKey: ReadonlyMap<string, ShoppingItemRule>): string {
  let current = key
  const seen = new Set<string>()
  for (let index = 0; index < 16; index += 1) {
    seen.add(current)
    const next = byKey.get(current)?.canonicalKey?.trim()
    if (!next || next === current || seen.has(next)) break
    current = next
  }
  return current
}

/** Public pure helper used by services/tests to resolve a product identity. */
export function resolveCanonicalKey(
  key: string,
  rules: readonly ShoppingItemRule[],
): string {
  return resolveKey(key, new Map(rules.map((rule) => [rule.key, rule])))
}

function legacyPurchase(check: ShoppingCheck): ShoppingPurchase {
  const amounts = Array.isArray(check.purchased) ? check.purchased : []
  return {
    id: `legacy-${check.id}`,
    shoppingDate: check.shoppingDate || check.weekStart,
    itemKey: check.itemKey,
    amounts,
    confirmedTotal: amounts,
    snapshot: [],
    qualitative: amounts.length === 0,
    createdAt: typeof check.updatedAt === 'number' ? check.updatedAt : 0,
    updatedAt: typeof check.updatedAt === 'number' ? check.updatedAt : 0,
  }
}

function purchasedTotals(purchases: readonly ShoppingPurchase[]): ShoppingAmountPosition[] {
  const byDimension = new Map<string, ShoppingAmountPosition>()
  for (const purchase of purchases) {
    for (const entry of purchase.amounts) {
      if (!Number.isFinite(entry.lower) || !Number.isFinite(entry.upper)) continue
      const existing = byDimension.get(entry.dimension)
      if (!existing) {
        byDimension.set(entry.dimension, {
          dimension: entry.dimension,
          unit: entry.dimension === 'count' ? 'Stück' : null,
          lower: Math.max(0, entry.lower),
          upper: Math.max(0, entry.upper),
          qualifier: '',
        })
      } else {
        existing.lower = roundAmount(existing.lower + Math.max(0, entry.lower))
        existing.upper = roundAmount(existing.upper + Math.max(0, entry.upper))
      }
    }
  }
  return sortPositions(Array.from(byDimension.values()))
}

function subtractPurchased(
  positions: readonly ShoppingAmountPosition[],
  purchased: readonly ShoppingAmountPosition[],
): ShoppingAmountPosition[] {
  const result: ShoppingAmountPosition[] = []
  for (const position of positions) {
    let current: ShoppingAmountPosition = { ...position }
    for (const entry of purchased.filter((item) => item.dimension === position.dimension)) {
      current = {
        ...current,
        lower: Math.max(0, roundAmount(current.lower - entry.lower)),
        upper: Math.max(0, roundAmount(current.upper - entry.upper)),
      }
    }
    result.push(current)
  }
  return result
}

function sortPositions(positions: readonly ShoppingAmountPosition[]): ShoppingAmountPosition[] {
  return positions
    .filter((position) => position.lower > 0 || position.upper > 0)
    .slice()
    .sort(
      (a, b) =>
        dimensionRank(a.dimension) - dimensionRank(b.dimension) ||
        a.dimension.localeCompare(b.dimension),
    )
}

function positionsEqual(
  left: readonly ShoppingPurchasedAmount[],
  right: readonly ShoppingAmountPosition[],
): boolean {
  if (left.length !== right.length) return false
  const byDimension = new Map(left.map((entry) => [entry.dimension, entry]))
  for (const position of right) {
    const entry = byDimension.get(position.dimension)
    if (!entry) return false
    if (Math.abs(entry.lower - position.lower) > 0.001) return false
    if (Math.abs(entry.upper - position.upper) > 0.001) return false
  }
  return true
}

/**
 * Build the complete visible list for one shopping week.
 *
 * Every planned cooking event contributes once, regardless of how many meal
 * appointments share it. Manual articles are dated and mapped into the current
 * week start. Product aliases are resolved before grouping. A learned quantity
 * correction replaces the aggregated demand for that product; no pantry stock
 * is involved in this calculation.
 */
export function buildShoppingList(input: ShoppingListInput): ShoppingListResult {
  const week =
    input.periodStart && input.periodEnd
      ? shoppingWeekFromRange(input.periodStart, input.periodEnd)
      : input.weekStartDay === undefined
        ? (() => {
            throw new Error('buildShoppingList needs a weekStartDay or explicit period bounds.')
          })()
        : shoppingWeek(input.anchor, input.weekStartDay)
  const warnings = new Set<string>()
  const groups = new Map<string, MutableGroup>()
  const rulesByKey = new Map(input.rules.map((rule) => [rule.key, rule]))
  const canonical = (key: string) => resolveKey(key, rulesByKey)
  const inWeek = (date: string) => date >= week.start && date <= week.end

  const sourceById = new Map<string, DishSource>()
  for (const recipe of input.recipes) sourceById.set(`recipe:${recipe.id}`, { kind: 'recipe', recipe })
  for (const freeDish of input.freeDishes) {
    sourceById.set(`free:${freeDish.id}`, { kind: 'free', freeDish })
  }

  const sessions = input.cookSessions
    .filter((session) => session.status === 'planned')
    .slice()
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id < b.id ? -1 : 1))

  for (const session of sessions) {
    const viewed = inWeek(session.date)
    const source = safeSource(sourceById, session)
    if (!source) {
      if (viewed) warnings.add('Ein geplantes Gericht fehlt in der Bibliothek und wurde übersprungen.')
      continue
    }
    const { scaling, needs } = dishShoppingNeeds(source, session)
    if (viewed) {
      for (const message of scaling.warnings) warnings.add(message)
    }
    for (const need of needs) {
      // Only pure instructions are dropped. A real product with "zum Braten"
      // or "nach Geschmack" stays a product; the usage clause is cleaned off.
      const classification = classifyIngredientForShopping(need.name)
      if (classification.decision === 'instruction') continue
      const split = classification.split
      const rawKey = shoppingItemKey(split.identityName)
      if (!rawKey) continue
      const key = canonical(rawKey)
      if (!viewed) continue
      const group = ensureGroup(groups, key, split.name)
      group.rawKeys.add(rawKey)
      group.names.push(split.name)
      if (split.variant) group.variants.add(split.variant)
      group.sources.push({ kind: 'cook', label: dishLabel(source), refId: session.id })
      const note = [need.purchaseNote.trim(), split.embeddedPurchaseNote.trim()]
        .filter(Boolean)
        .join(' · ')
      if (note) group.purchaseNotes.push(note)
      if (scaling.factor === null) {
        group.scaleWarnings.add(
          `Die Original-Portionszahl von „${dishLabel(source)}“ ist unklar; die Mengen wurden nicht skaliert.`,
        )
      }
      addContribution(group, need.quantityText, need.unit)
    }
  }

  for (const manual of input.manualItems) {
    const date = manual.shoppingDate || manual.weekStart || ''
    if (!date) continue
    const split = splitIngredientName(manual.name)
    const rawKey = shoppingItemKey(split.identityName)
    if (!rawKey) continue
    const key = canonical(rawKey)
    if (!inWeek(date)) continue
    const group = ensureGroup(groups, key, split.name)
    group.rawKeys.add(rawKey)
    group.names.push(split.name)
    if (split.variant) group.variants.add(split.variant)
    group.manualItems.push(manual)
    if (manual.categoryId) group.manualCategoryId = manual.categoryId
    if (manual.purchaseNote.trim()) group.purchaseNotes.push(manual.purchaseNote.trim())
    if (split.embeddedPurchaseNote.trim()) group.purchaseNotes.push(split.embeddedPurchaseNote.trim())
    group.sources.push({ kind: 'manual', label: split.name, refId: manual.id })
    addContribution(group, manual.quantityText, manual.unit)
  }

  const suppliedPurchases = input.purchases ?? []
  const purchases: ShoppingPurchase[] =
    suppliedPurchases.length > 0
      ? [...suppliedPurchases]
      : (input.checks ?? []).filter((check) => check.checked).map(legacyPurchase)

  const purchasesByKey = new Map<string, ShoppingPurchase[]>()
  for (const purchase of purchases) {
    if (!purchase.shoppingDate || !inWeek(purchase.shoppingDate)) continue
    const key = canonical(purchase.itemKey)
    const list = purchasesByKey.get(key) ?? []
    list.push(purchase)
    purchasesByKey.set(key, list)
  }
  for (const list of purchasesByKey.values()) {
    list.sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id))
  }

  const correctionsByKey = new Map<string, ShoppingQuantityCorrection[]>()
  for (const correction of input.quantityCorrections ?? []) {
    if (!correction.shoppingDate || !inWeek(correction.shoppingDate)) continue
    const key = canonical(correction.itemKey)
    const list = correctionsByKey.get(key) ?? []
    list.push(correction)
    correctionsByKey.set(key, list)
  }

  const items: ShoppingListItem[] = []
  for (const group of groups.values()) {
    const groupRules = input.rules.filter((rule) => canonical(rule.key) === group.key)
    const primary =
      rulesByKey.get(group.key) ??
      groupRules.find(
        (rule) => rule.displayName || rule.categoryId || rule.purchaseNote,
      ) ??
      groupRules[0]
    const name = primary?.displayName.trim() || bestName(group.names)
    const categoryId = normalizeCategoryId(
      primary?.categoryId ??
        groupRules.find((rule) => rule.categoryId)?.categoryId ??
        group.manualCategoryId ??
        guessShoppingCategory(name),
    )

    const derivedPositions = sortPositions(
      Array.from(group.positions.values(), (position) => ({ ...position })),
    )
    const derivedByDimension = new Map(
      derivedPositions.map((position) => [position.dimension, position]),
    )
    const correctedByDimension = new Map(derivedByDimension)
    const quantityCorrections: ShoppingQuantityCorrectionView[] = []
    for (const correction of correctionsByKey.get(group.key) ?? []) {
      const base = derivedByDimension.get(correction.dimension)
      const parsed = parseAmount(correction.quantityText, correction.unit)
      const dimensionMatches = parsed?.spec.dimension === correction.dimension
      const signatureMatches =
        base !== undefined && shoppingPositionSignature(base) === correction.sourceSignature
      const status: ShoppingQuantityCorrectionStatus =
        base && parsed && dimensionMatches && signatureMatches ? 'applied' : 'stale'
      quantityCorrections.push({ ...correction, status })
      if (status === 'applied' && parsed) {
        correctedByDimension.set(correction.dimension, positionFromAmount(parsed))
      }
    }
    const requiredPositions = sortPositions(Array.from(correctedByDimension.values()))
    const itemWarnings = Array.from(group.scaleWarnings)
    const unparsedAmounts = Array.from(group.unparsedAmounts).sort()
    const missingQuantity = group.missingQuantity

    const purchasesForItem = purchasesByKey.get(group.key) ?? []
    const purchased = purchasedTotals(purchasesForItem)
    const openPositions = sortPositions(subtractPurchased(requiredPositions, purchased))

    const latest = purchasesForItem[0]
    const settled =
      latest !== undefined &&
      positionsEqual(latest.snapshot, requiredPositions) &&
      positionsEqual(latest.confirmedTotal ?? [], purchased)
    const hasPurchases = purchasesForItem.length > 0
    const openEmpty = openPositions.length === 0
    const status: ShoppingListItem['status'] =
      hasPurchases && (openEmpty || settled) ? 'done' : 'open'
    // A confirmed range may leave a mathematical upper remainder (2 bought of
    // 2–3). It is settled, so no open quantity is shown; a later plan increase
    // makes the snapshot differ and the remainder becomes open again.
    const visibleOpen = status === 'done' ? [] : openPositions

    const derivedPurchaseNotes = dedupeNotes(group.purchaseNotes)
    const hiddenPurchaseNotes = primary?.hiddenPurchaseNotes ?? []
    const purchaseNoteOverride = primary?.purchaseNoteOverride === true
    const customNote = primary?.purchaseNote.trim() ?? ''
    const purchaseNotes = purchaseNoteOverride
      ? dedupeNotes(customNote ? [customNote] : [])
      : dedupeNotes([
          customNote,
          ...derivedPurchaseNotes.filter((note) => !hiddenPurchaseNotes.includes(note)),
        ])

    const mergedFrom = groupRules
      .filter((rule) => rule.key !== group.key)
      .map((rule) => ({ key: rule.key, name: rule.displayName.trim() || rule.key }))

    items.push({
      key: group.key,
      name,
      variant: dedupeNotes(Array.from(group.variants)).join(' · '),
      categoryId,
      derivedPositions,
      requiredPositions,
      positions: visibleOpen,
      unparsedAmounts,
      missingQuantity,
      purchased,
      purchases: purchasesForItem.slice(),
      hasItemRule: groupRules.some((rule) => rule.key === group.key) || groupRules.length > 0,
      quantityCorrections,
      legacyQuantityText: primary?.legacyQuantityText?.trim() ?? '',
      legacyUnit: primary?.legacyUnit?.trim() ?? '',
      derivedPurchaseNotes,
      customPurchaseNote: customNote,
      hiddenPurchaseNotes: [...hiddenPurchaseNotes],
      purchaseNoteOverride,
      purchaseNotes,
      checked: status === 'done',
      status,
      sources: group.sources,
      manualItems: group.manualItems,
      mergedFrom,
      warnings: itemWarnings,
    })
  }

  items.sort((a, b) => a.name.localeCompare(b.name, 'de'))
  const counts = {
    open: items.filter((item) => item.status === 'open').length,
    done: items.filter((item) => item.status === 'done').length,
  }
  return { week, items, counts, warnings: Array.from(warnings) }
}

function dimensionRank(dimension: string): number {
  if (dimension === 'mass') return 0
  if (dimension === 'volume') return 1
  if (dimension === 'count') return 2
  return 3
}

function ensureGroup(
  groups: Map<string, MutableGroup>,
  key: string,
  name: string,
): MutableGroup {
  const existing = groups.get(key)
  if (existing) return existing
  const created: MutableGroup = {
    key,
    rawKeys: new Set(),
    names: [],
    variants: new Set(),
    purchaseNotes: [],
    positions: new Map(),
    unparsedAmounts: new Set(),
    missingQuantity: false,
    sources: [],
    manualItems: [],
    manualCategoryId: null,
    scaleWarnings: new Set(),
  }
  groups.set(key, created)
  return created
}

function dedupeNotes(notes: readonly string[]): string[] {
  return Array.from(new Set(notes.map((note) => note.trim()).filter(Boolean)))
}

function bestName(names: readonly string[]): string {
  const counts = new Map<string, number>()
  for (const raw of names) {
    const name = raw.trim()
    if (!name) continue
    counts.set(name, (counts.get(name) ?? 0) + 1)
  }
  const candidates = Array.from(counts.entries())
  candidates.sort((a, b) => {
    const parenthesesA = /[()[\]]/.test(a[0]) ? 1 : 0
    const parenthesesB = /[()[\]]/.test(b[0]) ? 1 : 0
    if (parenthesesA !== parenthesesB) return parenthesesA - parenthesesB
    if (a[1] !== b[1]) return b[1] - a[1]
    // Prefer the plural form when the only difference is a plural suffix
    // ("Zwiebel" / "Zwiebeln"); otherwise prefer the shorter, base name
    // ("Tomaten" over "Tomaten Dose").
    if (isPluralPair(a[0], b[0])) return b[0].length - a[0].length
    if (a[0].length !== b[0].length) return a[0].length - b[0].length
    return 0
  })
  return candidates[0]?.[0] ?? ''
}

function isPluralPair(left: string, right: string): boolean {
  const [short, long] = left.length <= right.length ? [left, right] : [right, left]
  if (!short || long.length <= short.length) return false
  const suffix = long.slice(short.length)
  return suffix === 'n' || suffix === 'en' || suffix === 'e' || suffix === 's' || suffix === 'er'
}

function normalizeCategoryId(value: string | null | undefined): ShoppingCategoryId {
  return CATEGORY_BY_ID.has(value as ShoppingCategoryId)
    ? (value as ShoppingCategoryId)
    : 'other'
}

function addContribution(
  group: MutableGroup,
  quantityText: string | null | undefined,
  unit: string | null | undefined,
): void {
  const text = quantityText?.trim() ?? ''
  const amount = parseAmount(text, unit)
  if (!amount) {
    if (text && !parseQuantityToken(text)) {
      group.unparsedAmounts.add(text)
    } else {
      group.missingQuantity = true
    }
    return
  }
  const existing = group.positions.get(amount.spec.dimension)
  if (!existing) {
    group.positions.set(amount.spec.dimension, {
      dimension: amount.spec.dimension,
      unit: amount.spec.displayUnit,
      lower: amount.lower,
      upper: amount.upper,
      qualifier: amount.qualifier,
    })
    return
  }
  existing.lower = roundAmount(existing.lower + amount.lower)
  existing.upper = roundAmount(existing.upper + amount.upper)
  if (!existing.qualifier && amount.qualifier) existing.qualifier = amount.qualifier
  if (amount.spec.explicitUnit && amount.spec.dimension === 'count') {
    existing.unit = 'Stück'
  }
}

/**
 * Convert a user-entered confirmed amount into the base unit of an open
 * position. Only a single number is accepted; ranges must be confirmed as one
 * concrete quantity.
 */
export function parsePurchaseAmountInput(
  text: string,
  position: ShoppingAmountPosition,
): number | null {
  const parsed = parseQuantityToken(text)
  if (!parsed || parsed.values.length !== 1) return null
  const value = parsed.values[0]
  if (!Number.isFinite(value) || value <= 0) return null
  let factor = 1
  if (position.dimension === 'mass') {
    factor = Math.max(position.lower, position.upper) >= 1000 ? 1000 : 1
  } else if (position.dimension === 'volume') {
    factor = Math.max(position.lower, position.upper) >= 1000 ? 1000 : 1
  }
  return roundAmount(value * factor)
}

/** Group only open items by the saved category order; empty groups disappear. */
export function groupOpenItems(
  items: readonly ShoppingListItem[],
  order: readonly ShoppingCategoryId[],
): Array<{ category: ShoppingCategory; items: ShoppingListItem[] }> {
  const normalized = normalizeCategoryOrder(order)
  return normalized
    .map((id) => ({
      category: CATEGORY_BY_ID.get(id) ?? { id: 'other' as const, label: 'Sonstiges' },
      items: items.filter((item) => item.status === 'open' && item.categoryId === id),
    }))
    .filter((group) => group.items.length > 0)
}

export function categoryOrderWithMove(
  order: readonly ShoppingCategoryId[],
  id: ShoppingCategoryId,
  direction: -1 | 1,
): ShoppingCategoryId[] {
  const next = normalizeCategoryOrder(order)
  const index = next.indexOf(id)
  const target = index + direction
  if (index < 0 || target < 0 || target >= next.length) return next
  const current = next[index]
  const other = next[target]
  if (!current || !other) return next
  next[index] = other
  next[target] = current
  return next
}
