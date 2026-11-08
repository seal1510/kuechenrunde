/*
 * openCook Web
 * Copyright (C) 2026 openCook Web contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Ingredient amounts inside instruction texts.
 *
 * The imported instruction text is the source of truth. An explicit reference
 * marks one amount substring (its anchor) that may be replaced for display.
 * Cook mode can additionally opt into a conservative automatic detection:
 * only a quantity directly followed by a matching ingredient name and unit is
 * touched. Amounts are parsed and scaled with the existing `domain/scaling`
 * logic. There is no global search-and-replace, so temperatures, times, step
 * numbers and every other unlinked number stay untouched.
 *
 * Cook mode may also highlight ingredient mentions without an explicit amount.
 * The compact step list shows the scaled recipe amount for every reliably
 * identified ingredient whose list quantity is safely scalable. That value is
 * a reference to the ingredient list, not a claim about the current step.
 */

import {
  formatQuantityToken,
  formatScaledNumber,
  parseQuantityToken,
  scaleQuantityText,
} from '../domain/scaling'
import { canonicalUnitWord, isCountUnit, unitConversionFactor } from '../import/ingredients'
import type { Ingredient, Instruction, InstructionReference } from '../types'

export type ReferenceIssue =
  | 'missing-ingredient'
  | 'anchor-not-found'
  | 'missing-quantity'
  | 'unknown-original-servings'
  | 'invalid-target'
  | 'unsafe-remainder'
  | 'overlapping-anchor'

export interface RenderedReference {
  reference: InstructionReference
  ingredient: Ingredient | null
  /** Amount for display without unit; original amount when it cannot scale. */
  amountText: string | null
  /** True only when a numeric amount was actually recalculated. */
  scaled: boolean
  issue: ReferenceIssue | null
}

export interface IngredientMention {
  ingredient: Ingredient
  /** Range in the rendered instruction text. */
  start: number
  end: number
  /** True when an explicit numeric/spelled amount is already present. */
  hasAmount: boolean
  /** True for the one occurrence that should receive inline highlighting. */
  highlight: boolean
}

export interface StepIngredientInfo {
  ingredient: Ingredient
  /** Actual ingredient identity without usage or preparation notes. */
  displayName: string
  /** True when the step text itself already contains an amount. */
  hasAmountInText: boolean
  /** Scaled recipe amount from the ingredient list, or null if unreliable. */
  amountText: string | null
  /** Manual reference issue, if any. Display stays calm; details are hidden. */
  issue: ReferenceIssue | null
}

export interface RenderedInstruction {
  instruction: Instruction
  /** Instruction text with resolved anchors replaced, without display markup. */
  text: string
  /** Display text with safe inline ingredient highlighting. */
  annotatedText: string
  references: RenderedReference[]
  /** All factual mentions, including repetitions that are not highlighted. */
  mentions: IngredientMention[]
  /** Unique, reliably identified ingredients for the compact step list. */
  stepIngredients: StepIngredientInfo[]
}

export interface QuantityPrefix {
  /** Trimmed amount token, e.g. "400" or "ca. 2-3". */
  text: string
  /** Offset of `text` inside the searched string. */
  start: number
  end: number
}

const ANCHOR_ISSUE_ORDER: ReferenceIssue[] = [
  'missing-ingredient',
  'anchor-not-found',
  'missing-quantity',
  'unknown-original-servings',
  'invalid-target',
  'unsafe-remainder',
  'overlapping-anchor',
]

function firstIssue(issues: ReferenceIssue[]): ReferenceIssue | null {
  return ANCHOR_ISSUE_ORDER.find((issue) => issues.includes(issue)) ?? null
}

/** Quantity token stored on an ingredient, without unit or name. */
export function ingredientQuantityText(ingredient: Ingredient): string | null {
  const text = ingredient.quantityText?.trim()
  if (text) return text
  if (
    typeof ingredient.quantity === 'number' &&
    Number.isFinite(ingredient.quantity) &&
    ingredient.quantity > 0
  ) {
    return String(ingredient.quantity)
  }
  return null
}

const STRICT_BOUND = String.raw`(?:\d+\s+\d+\/\d+|\d+\/\d+|\d+\s*[½¼¾⅓⅔⅛⅜⅝⅞]|[½¼¾⅓⅔⅛⅜⅝⅞]|\d+(?:[.,]\d+)?)`
const STRICT_QUALIFIER = String.raw`(?:(?:ca\.?|etwa|circa|zirka|rund|ungefähr|gut)\s+)?`
const STRICT_QUANTITY_RE = new RegExp(
  `^${STRICT_QUALIFIER}${STRICT_BOUND}(?:\\s*[-–—]\\s*${STRICT_BOUND})?$`,
  'i',
)

/**
 * True only for a complete amount token without trailing unit or name text.
 * `parseQuantityToken` is intentionally tolerant elsewhere (a shopping hint
 * like "2 Packungen" must not crash), but remainder subtraction needs an exact
 * comparable amount.
 */
export function isStrictQuantityText(value: string | null | undefined): boolean {
  if (typeof value !== 'string') return false
  const trimmed = value.trim()
  if (!trimmed) return false
  return STRICT_QUANTITY_RE.test(trimmed)
}

/**
 * First complete amount inside `value` that the shared parser accepts. This is
 * used when the user marks a phrase like "400 g Hackfleisch" or "2 Zwiebeln":
 * only the amount part becomes the dynamic anchor, the unit and name stay
 * literal.
 */
export function parseQuantityPrefix(value: string): QuantityPrefix | null {
  if (typeof value !== 'string' || !value) return null

  // Search for the first complete amount inside the marked phrase. The user may
  // mark "Die 2-3 Zwiebeln" or "Anschließend 500 ml"; only the amount becomes
  // the anchor, everything else stays literal.
  for (let start = 0; start < value.length; start += 1) {
    if (/\s/.test(value.charAt(start))) continue
    for (let end = value.length; end > start; end -= 1) {
      const raw = value.slice(start, end)
      const trimmed = raw.trim()
      if (!trimmed || !isStrictQuantityText(trimmed)) continue
      const textStart = start + raw.indexOf(trimmed)
      const textEnd = textStart + trimmed.length
      const next = value.charAt(textEnd)
      if (next && /[\d.,/½¼¾⅓⅔⅛⅜⅝⅞]/.test(next)) continue
      return { text: trimmed, start: textStart, end: textEnd }
    }
  }
  return null
}

/** Compare two readable amount tokens by their parsed values. */
export function quantityTextsEqual(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  const left = parseQuantityToken(a ?? '')
  const right = parseQuantityToken(b ?? '')
  if (!left || !right) return false
  if (left.values.length !== right.values.length) return false
  return left.values.every((value, index) => {
    const other = right.values[index]
    return other !== undefined && Math.abs(value - other) < 1e-9
  })
}

export interface AnchorRange {
  start: number
  end: number
}

function overlaps(range: AnchorRange, used: readonly AnchorRange[]): boolean {
  return used.some((entry) => range.start < entry.end && range.end > entry.start)
}

/**
 * Find one reference anchor in the current instruction text. The saved offset
 * is preferred. If it moved, the saved surrounding context must identify a
 * single occurrence; an ambiguous amount is never reassigned. References never
 * influence each other's anchors.
 */
export function resolveReferenceAnchor(
  text: string,
  reference: Pick<
    InstructionReference,
    'anchor' | 'anchorOffset' | 'anchorBefore' | 'anchorAfter'
  >,
  used: readonly AnchorRange[] = [],
): AnchorRange | null {
  const anchor = reference.anchor
  if (!anchor) return null
  const offset = Number.isFinite(reference.anchorOffset)
    ? Math.max(0, Math.min(Math.trunc(reference.anchorOffset), text.length))
    : 0

  // The saved position is the strongest anchor. It is only accepted while the
  // amount itself is still present there.
  if (
    text.slice(offset, offset + anchor.length) === anchor &&
    !overlaps({ start: offset, end: offset + anchor.length }, used)
  ) {
    return { start: offset, end: offset + anchor.length }
  }

  const candidates: number[] = []
  let from = 0
  while (from <= text.length - anchor.length) {
    const index = text.indexOf(anchor, from)
    if (index < 0) break
    const range = { start: index, end: index + anchor.length }
    if (!overlaps(range, used)) candidates.push(index)
    from = index + Math.max(1, anchor.length)
  }
  if (candidates.length === 0) return null

  const hasContext =
    typeof reference.anchorBefore === 'string' ||
    typeof reference.anchorAfter === 'string'
  const contextual = hasContext
    ? candidates.filter((index) => {
        const before = reference.anchorBefore
        const after = reference.anchorAfter
        // Compare the saved context as a suffix/prefix. This tolerates edits
        // farther away and a changed capitalisation, but never moves a
        // reference to an amount with different surrounding words.
        if (typeof before === 'string' && before.length > 0) {
          const actual = text.slice(Math.max(0, index - before.length), index).toLocaleLowerCase('de')
          if (!actual.endsWith(before.toLocaleLowerCase('de'))) return false
        }
        if (typeof after === 'string' && after.length > 0) {
          const actual = text.slice(
            index + anchor.length,
            index + anchor.length + after.length,
          ).toLocaleLowerCase('de')
          if (!actual.startsWith(after.toLocaleLowerCase('de'))) return false
        }
        return true
      })
    : candidates

  // A moved-but-unique amount is safe. With several identical amounts and no
  // matching context, leave the reference invalid instead of silently moving
  // it to a different occurrence.
  if (contextual.length !== 1) return null
  const chosen = contextual[0]!
  return { start: chosen, end: chosen + anchor.length }
}

function sanitizeQuantity(
  value: InstructionReference['quantity'] | undefined,
): InstructionReference['quantity'] | null {
  if (!value || typeof value !== 'object') return null
  if (value.kind === 'full' || value.kind === 'remainder') {
    return { kind: value.kind }
  }
  if (value.kind === 'partial' && typeof value.quantityText === 'string') {
    return { kind: 'partial', quantityText: value.quantityText.trim() }
  }
  return null
}

/** Drop malformed entries, never invent a new relation. */
export function sanitizeInstructionReferences(
  value: unknown,
  idForIndex: (index: number) => string = (index) => `ref-${index + 1}`,
): InstructionReference[] {
  if (!Array.isArray(value)) return []
  const usedIds = new Set<string>()
  const result: InstructionReference[] = []
  value.forEach((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return
    const data = entry as Partial<InstructionReference>
    const ingredientId = typeof data.ingredientId === 'string' ? data.ingredientId.trim() : ''
    const anchor = typeof data.anchor === 'string' ? data.anchor.trim() : ''
    const quantity = sanitizeQuantity(data.quantity)
    if (!ingredientId || !anchor || !quantity) return
    let id = typeof data.id === 'string' ? data.id.trim() : ''
    if (!id || usedIds.has(id)) id = idForIndex(index)
    let suffix = 1
    while (usedIds.has(id)) {
      id = `${idForIndex(index)}-${suffix}`
      suffix += 1
    }
    usedIds.add(id)
    result.push({
      id,
      ingredientId,
      anchor,
      anchorOffset:
        typeof data.anchorOffset === 'number' && Number.isFinite(data.anchorOffset)
          ? Math.max(0, Math.trunc(data.anchorOffset))
          : 0,
      ...(typeof data.anchorBefore === 'string' ? { anchorBefore: data.anchorBefore } : {}),
      ...(typeof data.anchorAfter === 'string' ? { anchorAfter: data.anchorAfter } : {}),
      quantity,
    })
  })
  return result
}

function withContext(
  reference: InstructionReference,
  text: string,
  range: AnchorRange,
): InstructionReference {
  return {
    ...reference,
    anchorOffset: range.start,
    anchorBefore: text.slice(Math.max(0, range.start - 24), range.start),
    anchorAfter: text.slice(range.end, range.end + 24),
  }
}

function sortResolved(
  resolved: Array<{ reference: InstructionReference; range: AnchorRange | null }>,
): InstructionReference[] {
  return resolved
    .sort((a, b) => {
      if (a.range && b.range) return a.range.start - b.range.start
      if (a.range) return -1
      if (b.range) return 1
      return a.reference.anchorOffset - b.reference.anchorOffset
    })
    .map((entry) => entry.reference)
}

/**
 * Refresh anchor offsets against the current text and sort references by their
 * text position. Missing anchors keep their old offset and stay visible so the
 * editor can offer a correction instead of silently losing the link.
 */
export function normalizeReferenceAnchors(
  text: string,
  references: readonly InstructionReference[],
): InstructionReference[] {
  const sanitized = sanitizeInstructionReferences(references)
  const used: AnchorRange[] = []
  const resolved = sanitized.map((reference) => {
    const range = resolveReferenceAnchor(text, reference, used)
    if (range) used.push(range)
    return {
      reference: range ? withContext(reference, text, range) : reference,
      range,
    }
  })
  return sortResolved(resolved)
}

function countOccurrences(text: string, anchor: string): number {
  if (!anchor) return 0
  let count = 0
  let from = 0
  while (from <= text.length - anchor.length) {
    const index = text.indexOf(anchor, from)
    if (index < 0) break
    count += 1
    from = index + Math.max(1, anchor.length)
  }
  return count
}

/**
 * Reconcile references while the user types. A reference that was the only
 * occurrence of its amount may follow that amount when surrounding text grows
 * or shrinks; an ambiguous amount is never reassigned silently.
 */
export function reconcileReferenceAnchors(
  oldText: string,
  newText: string,
  references: readonly InstructionReference[],
): InstructionReference[] {
  const sanitized = sanitizeInstructionReferences(references)
  const used: AnchorRange[] = []
  const resolved = sanitized.map((reference) => {
    let range = resolveReferenceAnchor(newText, reference, used)
    if (!range) {
      const oldCount = countOccurrences(oldText, reference.anchor)
      const newCount = countOccurrences(newText, reference.anchor)
      if (oldCount === 1 && newCount === 1) {
        const index = newText.indexOf(reference.anchor)
        const candidate = { start: index, end: index + reference.anchor.length }
        if (!overlaps(candidate, used)) range = candidate
      }
    }
    if (range) used.push(range)
    return {
      reference: range ? withContext(reference, newText, range) : reference,
      range,
    }
  })
  return sortResolved(resolved)
}

interface UsageState {
  partialSum: number
  fullUsed: boolean
  safe: boolean
}

function newUsage(): UsageState {
  return { partialSum: 0, fullUsed: false, safe: true }
}

function totalAmount(ingredient: Ingredient): number | null {
  const text = ingredientQuantityText(ingredient)
  if (!isStrictQuantityText(text)) return null
  const parsed = parseQuantityToken(text)
  if (!parsed || parsed.values.length !== 1 || parsed.range || parsed.qualifier) return null
  const value = parsed.values[0]
  if (value === undefined || !Number.isFinite(value) || value <= 0) return null
  return value
}

function remainingAmount(ingredient: Ingredient, usage: UsageState): number | null {
  if (!usage.safe || usage.fullUsed) return null
  const total = totalAmount(ingredient)
  if (total === null) return null
  const remaining = total - usage.partialSum
  if (!Number.isFinite(remaining) || remaining <= 0) return null
  return Math.round(remaining * 1000) / 1000
}

function updateUsage(usage: UsageState, ingredient: Ingredient, reference: InstructionReference): void {
  if (reference.quantity.kind === 'full') {
    usage.fullUsed = true
    return
  }
  if (reference.quantity.kind === 'remainder') {
    // A remainder already consumes everything that is left; a later remainder
    // would depend on an unknown intermediate state.
    usage.safe = false
    return
  }
  if (!isStrictQuantityText(reference.quantity.quantityText)) {
    usage.safe = false
    return
  }
  const parsed = parseQuantityToken(reference.quantity.quantityText)
  if (!parsed || parsed.range || parsed.values.length !== 1 || parsed.qualifier) {
    usage.safe = false
    return
  }
  const value = parsed.values[0]
  if (value === undefined || !Number.isFinite(value) || value <= 0) {
    usage.safe = false
    return
  }
  usage.partialSum += value
  const total = totalAmount(ingredient)
  if (total !== null && usage.partialSum > total + 1e-9) usage.safe = false
}

function baseAmountFor(
  ingredient: Ingredient,
  reference: InstructionReference,
  usage: UsageState,
  unsafeRemainder = false,
): { text: string | null; issue: ReferenceIssue | null; scaledFromRemainder?: number } {
  if (reference.quantity.kind === 'full') {
    return { text: ingredientQuantityText(ingredient), issue: null }
  }
  if (reference.quantity.kind === 'partial') {
    return { text: reference.quantity.quantityText.trim(), issue: null }
  }
  if (unsafeRemainder) return { text: null, issue: 'unsafe-remainder' }
  const remaining = remainingAmount(ingredient, usage)
  if (remaining === null) {
    return { text: null, issue: 'unsafe-remainder' }
  }
  return { text: formatScaledNumber(remaining), issue: null, scaledFromRemainder: remaining }
}

interface AutoIngredientMatcher {
  ingredientId: string
  /** Canonical unit, or null when the ingredient is counted without a unit. */
  unit: string | null
  /** Upper bound of the stored amount, used only to reject contradictions. */
  maxQuantity: number
  /** Variants already normalised to lower-case words. */
  variants: string[][]
}

interface AutoCandidate {
  ingredientId: string
  nameRange: AnchorRange
  quantityRange: AnchorRange
  value: string
}

interface InstructionReplacement extends AnchorRange {
  value: string
  ingredientId: string
}

/**
 * Quantities are only considered when they sit directly before an ingredient
 * name. This keeps temperatures, times, step numbers and geometry out of the
 * replacement path instead of trying to blacklist every possible number.
 */
const AUTO_QUANTITY_RE = new RegExp(
  `${STRICT_QUALIFIER}${STRICT_BOUND}(?:\\s*[-–—]\\s*${STRICT_BOUND})?`,
  'giu',
)

const AUTO_PRECEDING_STOPWORDS = new Set([
  'schritt',
  'schritte',
  'punkt',
  'punkte',
  'phase',
  'phasen',
  'stufe',
  'stufen',
  'teil',
  'teile',
  'variante',
  'varianten',
  'nr',
  'nummer',
  'nummern',
  'bis',
  'oder',
  'von',
  'vom',
  'je',
  'pro',
  'mal',
  'x',
  'tag',
  'tage',
  'tagen',
  'woche',
  'wochen',
  'monat',
  'monate',
  'monaten',
  'jahr',
  'jahre',
  'jahren',
])

const AUTO_MODIFIER_STOPWORDS = new Set([
  'der',
  'die',
  'das',
  'den',
  'dem',
  'des',
  'ein',
  'eine',
  'einen',
  'einem',
  'einer',
  'eines',
  'und',
  'oder',
  'sowie',
  'mit',
  'ohne',
  'von',
  'vom',
  'für',
  'fuer',
  'auf',
  'aus',
  'in',
  'im',
  'am',
  'an',
  'zu',
  'zum',
  'zur',
  'bei',
  'bis',
  'je',
  'pro',
  'mal',
  'x',
  'ca',
  'circa',
  'etwa',
  'zirka',
  'rund',
  'ungefähr',
  'ungefaehr',
  'gut',
])

/** Words that unambiguously describe time, temperature or geometry. */
const AUTO_BLOCKED_CONTEXT_WORDS = new Set([
  'cm',
  'mm',
  'm',
  'meter',
  'zentimeter',
  'millimeter',
  'zoll',
  'inch',
  'inches',
  'grad',
  'celsius',
  'fahrenheit',
  'prozent',
  'uhr',
  'person',
  'personen',
  'minute',
  'minuten',
  'min',
  'stunde',
  'stunden',
  'std',
  'sekunde',
  'sekunden',
  'sek',
  'tag',
  'tage',
  'tagen',
  'woche',
  'wochen',
  'monat',
  'monate',
  'monaten',
  'jahr',
  'jahre',
  'jahren',
  'stufe',
  'stufen',
  'schritt',
  'schritte',
  'punkt',
  'punkte',
  'phase',
  'phasen',
])

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function normalizeMatchWord(value: string): string {
  return value.trim().toLocaleLowerCase('de').replace(/\.+$/, '')
}

/** Same length as the source so replacement offsets stay valid. */
function searchableInstructionText(text: string): string {
  const blank = (value: string) => ' '.repeat(value.length)
  return text
    // Code must never receive ingredient markup or amount replacements.
    .replace(/```[\s\S]*?```/g, blank)
    .replace(/~~~[\s\S]*?~~~/g, blank)
    .replace(/`[^`\n]*`/g, blank)
    // Image alt text is not visible prose; link destinations are not prose.
    .replace(/!\[[^\]]*\]\((?:[^()]|\([^()]*\))*\)/g, blank)
    .replace(/\]\((?:[^()]|\([^()]*\))*\)/g, (match) =>
      `]${' '.repeat(Math.max(0, match.length - 1))}`,
    )
    // Raw HTML tags (including attributes) are never part of the matched text.
    .replace(/<[^>]*>/g, blank)
    .replace(/^\[[^\]]+\]:.*$/gm, blank)
    .replace(/[*_`~]/g, ' ')
}

function nameWords(value: string): string[] {
  return value
    .toLocaleLowerCase('de')
    .replace(/[^\p{L}\p{N}\s'-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter((word) => /[\p{L}\p{N}]/u.test(word))
}

const INGREDIENT_USAGE_MARKER_RE =
  /\s+(?:zum|zur|für|fuer|mit|ohne|aus|in|im|am|an|auf|als|nach|vom|von|beim)\s+/i

/**
 * Strip parenthetical, comma-separated and usage/preparation notes from an
 * ingredient line while preserving original spelling and casing.
 */
function ingredientHeadText(name: string): string {
  const withoutParens = name.replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim()
  if (!withoutParens) return ''

  const beforeComma = withoutParens.split(',')[0]?.trim() ?? ''
  const source = beforeComma || withoutParens
  const marker = INGREDIENT_USAGE_MARKER_RE.exec(source)
  const head = marker && marker.index > 0 ? source.slice(0, marker.index).trim() : source
  return head || source
}

/** Human-readable identity without usage or preparation notes. */
export function ingredientDisplayName(name: string): string {
  return ingredientHeadText(name) || name.trim()
}

function ingredientHeadWords(name: string): string[] {
  return nameWords(ingredientHeadText(name))
}

/**
 * Conservative German variants. Positive plurals are only generated for
 * nouns ending in "e"/"el" (plus "s" for loanwords), which avoids creating
 * common verb forms such as "salzen", "zuckern" or "buttern".
 */
function lastWordVariants(words: string[]): string[][] {
  const last = words[words.length - 1]!
  const alternatives = new Set<string>([last])
  const add = (value: string) => {
    if (value.length >= 2) alternatives.add(value)
  }

  if (last.length >= 4) {
    if (last.endsWith('n')) add(last.slice(0, -1))
    if (last.endsWith('en')) add(last.slice(0, -2))
    if (last.endsWith('s')) add(last.slice(0, -1))
    if (last.endsWith('e') || last.endsWith('el')) add(`${last}n`)
    add(`${last}s`)
  }
  if (last === 'ei') add('eier')
  if (last === 'eier') add('ei')

  return [...alternatives].map((alternative) => [...words.slice(0, -1), alternative])
}

/** Very conservative variants for shortened compound heads. */
function shortenedWordVariants(word: string): string[] {
  const alternatives = new Set<string>([word])
  const add = (value: string) => {
    if (value.length >= 2) alternatives.add(value)
  }
  if (word.length >= 4) {
    if (word.endsWith('n')) add(word.slice(0, -1))
    add(`${word}s`)
  }
  if (word === 'ei') add('eier')
  if (word === 'eier') add('ei')
  return [...alternatives]
}

/**
 * Ingredient names often carry a note ("Zwiebeln, fein gewürfelt",
 * "Hähnchen (Brust)", "Öl zum Braten"). Only the real head is used as an
 * identity phrase; trailing usage verbs are never turned into aliases.
 */
function ingredientNamePhrases(name: string): string[][] {
  const words = ingredientHeadWords(name)
  if (words.length === 0) return []
  if (words.length === 1 && words[0]!.length < 2) return []
  return lastWordVariants(words)
}

function nameMatchRanges(searchText: string, words: string[]): AnchorRange[] {
  const phrase = words.map(escapeRegExp).join('\\s+')
  const pattern = new RegExp(
    `(?:^|[^\\p{L}\\p{N}-])(${phrase})(?![\\p{L}\\p{N}-])`,
    'giu',
  )
  const ranges: AnchorRange[] = []
  for (const match of searchText.matchAll(pattern)) {
    const value = match[1] ?? ''
    if (!value) continue
    const start = (match.index ?? 0) + match[0].length - value.length
    ranges.push({ start, end: start + value.length })
  }
  return ranges
}

/**
 * Validate the text between a quantity and the following ingredient name and
 * return the factor needed to compare its unit with the stored unit.
 * The first word may be a matching unit; at most two further words may be
 * descriptive adjectives. Anything time-, temperature-, geometry- or
 * article-like rejects the match. Null means "not safe".
 */
function autoQuantityConversion(
  between: string,
  matcher: AutoIngredientMatcher,
): number | null {
  if (between.includes('\n')) return null
  if (!/\s/.test(between)) return null

  const trimmed = between.trim()
  const words = trimmed ? trimmed.split(/\s+/) : []
  if (words.length > 3) return null
  for (const word of words) {
    if (!/^[\p{L}]+(?:[-'’][\p{L}]+)*\.?$/u.test(word)) return null
  }
  if (words.some((word) => AUTO_BLOCKED_CONTEXT_WORDS.has(normalizeMatchWord(word)))) {
    return null
  }

  let cursor = 0
  let textUnit: string | null = null
  const firstUnit = words[0] ? canonicalUnitWord(words[0]) : null
  if (firstUnit !== null) {
    textUnit = firstUnit
    cursor = 1
  }

  const modifiers = words.slice(cursor)
  if (modifiers.length > 2) return null
  if (modifiers.some((word) => AUTO_MODIFIER_STOPWORDS.has(normalizeMatchWord(word)))) {
    return null
  }
  if (modifiers.some((word) => canonicalUnitWord(word) !== null)) return null

  if (textUnit !== null) {
    if (matcher.unit === null) return isCountUnit(textUnit) ? 1 : null
    return unitConversionFactor(textUnit, matcher.unit)
  }
  if (matcher.unit === null) return 1
  // "Stück" is routinely omitted: "2 Zwiebeln" for "2 Stück Zwiebeln".
  return matcher.unit === 'stück' ? 1 : null
}

function hasBlockedPrecedingWord(searchText: string, amountStart: number): boolean {
  const before = searchText
    .slice(Math.max(0, amountStart - 32), amountStart)
    .toLocaleLowerCase('de')
    .replace(/[.,:;!?()[\]{}]/g, ' ')
    .trim()
  if (!before) return false
  const words = before.split(/\s+/)
  const last = words[words.length - 1]
  if (!last) return false
  // A preceding number can be a thousands separator ("1 500 g"), a multiplier
  // ("2x 500 g") or a step number; none is a safe amount context. A preceding
  // unit indicates a compound amount such as "1 kg 500 g" as well.
  const numericToken = /\d/.test(last) && !/^\p{L}/u.test(last)
  return (
    numericToken ||
    AUTO_PRECEDING_STOPWORDS.has(last) ||
    canonicalUnitWord(last) !== null
  )
}

function findAutoQuantityBefore(
  searchText: string,
  nameStart: number,
  matcher: AutoIngredientMatcher,
): { range: AnchorRange; text: string } | null {
  const windowStart = Math.max(0, nameStart - 96)
  const prefix = searchText.slice(windowStart, nameStart)
  AUTO_QUANTITY_RE.lastIndex = 0
  const matches = [...prefix.matchAll(AUTO_QUANTITY_RE)]

  for (let index = matches.length - 1; index >= 0; index -= 1) {
    const match = matches[index]!
    const start = windowStart + (match.index ?? 0)
    const end = start + match[0].length
    if (nameStart <= end) continue

    const beforeChar = start > 0 ? searchText.charAt(start - 1) : ''
    if (beforeChar && /[\p{L}\p{N}.,/]/u.test(beforeChar)) continue
    if (beforeChar === '-' || beforeChar === '+') continue

    const afterText = searchText.slice(end)
    const afterChar = afterText.charAt(0)
    if (afterChar && /[\p{N}.,/]/u.test(afterChar)) continue
    if (afterChar && /[\p{L}]/u.test(afterChar)) {
      const attachedUnit = /^[\p{L}]+/u.exec(afterText)?.[0] ?? ''
      if (canonicalUnitWord(attachedUnit) === null) continue
    }

    const conversion = autoQuantityConversion(
      searchText.slice(end, nameStart),
      matcher,
    )
    if (conversion === null) continue
    if (hasBlockedPrecedingWord(searchText, start)) continue

    const quantityText = match[0].trim()
    if (!isStrictQuantityText(quantityText)) continue
    // "1.500" is a common German thousands separator, not a decimal value.
    // The shared parser accepts dots as decimals, so this ambiguity is skipped.
    if (/\d{1,3}(?:\.\d{3})+/.test(quantityText)) continue
    const parsed = parseQuantityToken(quantityText)
    if (!parsed) continue
    // A partial amount is safe, but an amount larger than the complete stored
    // ingredient quantity is contradictory and must stay untouched. Compatible
    // mass/volume units are converted only for this comparison.
    if (Math.max(...parsed.values) * conversion > matcher.maxQuantity + 1e-9) {
      continue
    }
    return { range: { start, end }, text: quantityText }
  }

  return null
}

function buildAutoMatchers(
  ingredients: readonly Ingredient[],
  phrases: readonly MentionPhrase[],
): AutoIngredientMatcher[] {
  const variantsById = new Map<string, string[][]>()
  for (const phrase of phrases) {
    const variants = variantsById.get(phrase.ingredient.id) ?? []
    variants.push(phrase.words)
    variantsById.set(phrase.ingredient.id, variants)
  }

  const matchers: AutoIngredientMatcher[] = []
  for (const ingredient of ingredients) {
    const storedQuantity = ingredientQuantityText(ingredient)
    if (!isStrictQuantityText(storedQuantity)) continue
    const parsedStored = parseQuantityToken(storedQuantity)
    if (!parsedStored || parsedStored.values.length === 0) continue

    const rawUnit = ingredient.unit?.trim() ?? ''
    const unit = rawUnit ? canonicalUnitWord(rawUnit) : null
    // An unknown unit cannot be compared reliably, so leave the text alone.
    if (rawUnit && unit === null) continue

    const variants = variantsById.get(ingredient.id) ?? []
    if (variants.length === 0) continue
    matchers.push({
      ingredientId: ingredient.id,
      unit,
      maxQuantity: Math.max(...parsedStored.values),
      variants,
    })
  }
  return matchers
}

function automaticReplacements(
  searchText: string,
  matchers: readonly AutoIngredientMatcher[],
  factor: number,
  blockedIngredientIds: ReadonlySet<string>,
  blockedRanges: readonly AnchorRange[],
): InstructionReplacement[] {
  const candidates: AutoCandidate[] = []
  for (const matcher of matchers) {
    if (blockedIngredientIds.has(matcher.ingredientId)) continue
    for (const variant of matcher.variants) {
      for (const nameRange of nameMatchRanges(searchText, variant)) {
        const quantity = findAutoQuantityBefore(searchText, nameRange.start, matcher)
        if (!quantity) continue
        if (overlaps(quantity.range, blockedRanges)) continue
        const value = scaleQuantityText(quantity.text, factor)
        if (value === null || value === quantity.text) continue
        candidates.push({
          ingredientId: matcher.ingredientId,
          nameRange,
          quantityRange: quantity.range,
          value,
        })
      }
    }
  }

  const deduped = new Map<string, AutoCandidate>()
  for (const candidate of candidates) {
    const key = [
      candidate.ingredientId,
      candidate.nameRange.start,
      candidate.nameRange.end,
      candidate.quantityRange.start,
      candidate.quantityRange.end,
    ].join(':')
    if (!deduped.has(key)) deduped.set(key, candidate)
  }

  // If two different ingredients match exactly the same name phrase, the
  // relation is ambiguous and both stay untouched.
  const byNameRange = new Map<string, AutoCandidate[]>()
  for (const candidate of deduped.values()) {
    const key = `${candidate.nameRange.start}:${candidate.nameRange.end}`
    const group = byNameRange.get(key)
    if (group) group.push(candidate)
    else byNameRange.set(key, [candidate])
  }
  const ambiguousNames = new Set<string>()
  for (const [key, group] of byNameRange) {
    if (new Set(group.map((candidate) => candidate.ingredientId)).size > 1) {
      ambiguousNames.add(key)
    }
  }

  const selected: AutoCandidate[] = []
  const sorted = [...deduped.values()]
    .filter(
      (candidate) =>
        !ambiguousNames.has(`${candidate.nameRange.start}:${candidate.nameRange.end}`),
    )
    .sort((a, b) => {
      const nameLength = b.nameRange.end - b.nameRange.start
      const otherNameLength = a.nameRange.end - a.nameRange.start
      if (nameLength !== otherNameLength) return nameLength - otherNameLength
      return (
        b.quantityRange.end -
        b.quantityRange.start -
        (a.quantityRange.end - a.quantityRange.start)
      )
    })

  for (const candidate of sorted) {
    // A longer name ("brauner Zucker") wins over its shorter substring
    // ("Zucker"). Candidates sharing an amount are equally ambiguous.
    if (
      selected.some(
        (entry) =>
          overlaps(candidate.nameRange, [entry.nameRange]) ||
          overlaps(candidate.quantityRange, [entry.quantityRange]),
      )
    ) {
      continue
    }
    selected.push(candidate)
  }

  return selected.map((candidate) => ({
    ...candidate.quantityRange,
    value: candidate.value,
    ingredientId: candidate.ingredientId,
  }))
}

interface MentionPhrase {
  words: string[]
  ingredient: Ingredient
  exact: boolean
}

interface MentionCandidate extends AnchorRange {
  ingredient: Ingredient
  exact: boolean
}

/** Short compound heads that are common enough to be safe standalone names. */
const SHORT_HEAD_WORDS = new Set([
  'öl',
  'oel',
  'ei',
  'eier',
  'salz',
  'reis',
  'mark',
  'brot',
  'wein',
  'saft',
  'tee',
  'dill',
  'fett',
  'fond',
  'sud',
  'mus',
  'korn',
  'gin',
  'rum',
  'obst',
  'pilz',
  'käse',
  'mehl',
  'soße',
])

const MENTION_MEAT_CUES = [
  'fleisch',
  'filet',
  'brust',
  'hack',
  'schnitzel',
  'hähnchen',
  'haehnchen',
  'huhn',
  'hühner',
  'huehner',
  'rind',
  'rinder',
  'schwein',
  'schweine',
  'pute',
  'puten',
  'lamm',
  'kalb',
  'wurst',
  'speck',
  'schinken',
  'geflügel',
  'gefluegel',
]

const MENTION_FISH_CUES = [
  'fisch',
  'lachs',
  'thunfisch',
  'forelle',
  'garnele',
  'garnelen',
  'meeresfrüchte',
  'meeresfruechte',
  'kabeljau',
  'dorsch',
  'hering',
  'sardine',
  'sardinen',
  'makrele',
]

const MENTION_POULTRY_CUES = [
  'hähnchen',
  'haehnchen',
  'huhn',
  'hühner',
  'huehner',
  'geflügel',
  'gefluegel',
]

const MENTION_NON_FOOD_HINTS = [
  'brühe',
  'bruehe',
  'fond',
  'suppe',
  'sud',
  'gewürz',
  'gewuerz',
  'pulver',
  'sauce',
  'soße',
  'sosse',
  'öl',
  'oel',
  'essig',
  'eiweiß',
  'eiweiss',
  'eigelb',
  'eidotter',
]

function containsCue(value: string, cues: readonly string[]): boolean {
  return cues.some((cue) => value.includes(cue))
}

/**
 * Conservative shortened names for compound ingredient names. The head noun
 * or a short compound head may be used only when the phrase is unique across
 * the whole recipe. This is what makes "Brühe" point at "Hühnerbrühe".
 */
function shortenedNamePhrases(name: string): string[][] {
  const headWords = ingredientHeadWords(name)
  if (headWords.length === 0) return []

  const variants = new Map<string, string[]>()
  const addWord = (word: string) => {
    if (word.length < 2) return
    for (const variant of shortenedWordVariants(word)) {
      variants.set(variant, [variant])
    }
  }

  const last = headWords[headWords.length - 1]
  if (!last) return []

  if (headWords.length > 1 && (last.length >= 3 || SHORT_HEAD_WORDS.has(last))) {
    addWord(last)
  }

  if (last.length >= 9) {
    for (let start = 1; start < last.length - 3; start += 1) {
      const suffix = last.slice(start)
      if (suffix.length >= 5) addWord(suffix)
    }
  }

  if (last.length >= 6) {
    for (const head of SHORT_HEAD_WORDS) {
      if (last.length > head.length && last.endsWith(head)) addWord(head)
    }
  }

  const normalizedName = headWords.join(' ')
  const looksLikeEgg = /(?:ei|eier|eiern)$/.test(normalizedName)
  if (!looksLikeEgg && !containsCue(normalizedName, MENTION_NON_FOOD_HINTS)) {
    if (containsCue(normalizedName, MENTION_FISH_CUES)) {
      addWord('fisch')
    } else {
      if (containsCue(normalizedName, MENTION_MEAT_CUES)) addWord('fleisch')
      if (containsCue(normalizedName, MENTION_POULTRY_CUES)) {
        addWord('hähnchen')
        addWord('huhn')
        addWord('geflügel')
      }
    }
  }

  return [...variants.values()]
}

function buildMentionPhrases(ingredients: readonly Ingredient[]): MentionPhrase[] {
  const ingredientById = new Map(ingredients.map((ingredient) => [ingredient.id, ingredient]))
  const exactWords = new Map<string, string[]>()
  const exactOwners = new Map<string, Set<string>>()

  for (const ingredient of ingredients) {
    for (const words of ingredientNamePhrases(ingredient.name)) {
      const key = words.join(' ')
      if (!exactWords.has(key)) exactWords.set(key, words)
      const owners = exactOwners.get(key) ?? new Set<string>()
      owners.add(ingredient.id)
      exactOwners.set(key, owners)
    }
  }

  const exactKeys = new Set(exactWords.keys())
  const shortenedWords = new Map<string, string[]>()
  const shortenedOwners = new Map<string, Set<string>>()
  for (const ingredient of ingredients) {
    for (const words of shortenedNamePhrases(ingredient.name)) {
      const key = words.join(' ')
      // Exact ingredient names always win over a shortened form of another
      // ingredient, even if that exact name is itself ambiguous.
      if (exactKeys.has(key)) continue
      if (!shortenedWords.has(key)) shortenedWords.set(key, words)
      const owners = shortenedOwners.get(key) ?? new Set<string>()
      owners.add(ingredient.id)
      shortenedOwners.set(key, owners)
    }
  }

  const phrases: MentionPhrase[] = []
  for (const [key, owners] of exactOwners) {
    if (owners.size !== 1) continue
    const ingredientId = [...owners][0]
    const ingredient = ingredientId ? ingredientById.get(ingredientId) : undefined
    const words = exactWords.get(key)
    if (ingredient && words) phrases.push({ words, ingredient, exact: true })
  }
  for (const [key, owners] of shortenedOwners) {
    if (owners.size !== 1) continue
    const ingredientId = [...owners][0]
    const ingredient = ingredientId ? ingredientById.get(ingredientId) : undefined
    const words = shortenedWords.get(key)
    if (ingredient && words) phrases.push({ words, ingredient, exact: false })
  }
  return phrases
}

function containsSentenceBoundary(value: string): number {
  return value.search(/[.!?;\n]/)
}

const SPELLED_QUANTITY_RE =
  /\b(?:zwei|drei|vier|fünf|sechs|sieben|acht|neun|zehn|elf|zwölf|halb|halbe|halben|halber|halbes|viertel|dreiviertel|anderthalb|eineinhalb)\b/iu

const INDEFINITE_QUANTITY_BEFORE_RE =
  /(?:^|[^\p{L}])(?:ein|eine|einen|einem|einer|eines)\s+$/iu

function hasQuantityInClause(value: string): boolean {
  AUTO_QUANTITY_RE.lastIndex = 0
  return AUTO_QUANTITY_RE.test(value) || SPELLED_QUANTITY_RE.test(value)
}

function clauseAroundMention(searchText: string, start: number, end: number): string {
  const beforeWindow = searchText.slice(Math.max(0, start - 64), start)
  const lastBoundary = Math.max(
    beforeWindow.lastIndexOf('.'),
    beforeWindow.lastIndexOf('!'),
    beforeWindow.lastIndexOf('?'),
    beforeWindow.lastIndexOf(';'),
    beforeWindow.lastIndexOf('\n'),
  )
  const beforeClause = beforeWindow.slice(lastBoundary + 1)

  const afterWindow = searchText.slice(end, Math.min(searchText.length, end + 64))
  const firstBoundary = containsSentenceBoundary(afterWindow)
  const afterClause = firstBoundary === -1 ? afterWindow : afterWindow.slice(0, firstBoundary)
  return `${beforeClause} ${afterClause}`
}

/**
 * Describes whether the step text already contains an explicit amount.
 * It never suppresses the recipe reference shown in the step list.
 */
function hasExplicitAmountNearMention(
  searchText: string,
  start: number,
  end: number,
): boolean {
  const beforeMention = searchText.slice(Math.max(0, start - 24), start)
  if (INDEFINITE_QUANTITY_BEFORE_RE.test(beforeMention)) return true
  return hasQuantityInClause(clauseAroundMention(searchText, start, end))
}

function detectMentions(
  searchText: string,
  phrases: readonly MentionPhrase[],
): MentionCandidate[] {
  const candidates: MentionCandidate[] = []
  for (const phrase of phrases) {
    for (const range of nameMatchRanges(searchText, phrase.words)) {
      candidates.push({
        ...range,
        ingredient: phrase.ingredient,
        exact: phrase.exact,
      })
    }
  }

  const deduped = new Map<string, MentionCandidate>()
  for (const candidate of candidates) {
    const key = `${candidate.ingredient.id}:${candidate.start}:${candidate.end}`
    const existing = deduped.get(key)
    if (!existing || (candidate.exact && !existing.exact)) {
      deduped.set(key, candidate)
    }
  }

  const byRange = new Map<string, MentionCandidate[]>()
  for (const candidate of deduped.values()) {
    const key = `${candidate.start}:${candidate.end}`
    const group = byRange.get(key)
    if (group) group.push(candidate)
    else byRange.set(key, [candidate])
  }
  const ambiguous = new Set<string>()
  for (const [key, group] of byRange) {
    if (new Set(group.map((candidate) => candidate.ingredient.id)).size > 1) {
      ambiguous.add(key)
    }
  }

  const selected: MentionCandidate[] = []
  const sorted = [...deduped.values()]
    .filter((candidate) => !ambiguous.has(`${candidate.start}:${candidate.end}`))
    .sort((a, b) => {
      if (a.exact !== b.exact) return a.exact ? -1 : 1
      return b.end - b.start - (a.end - a.start)
    })

  for (const candidate of sorted) {
    if (selected.some((entry) => overlaps(candidate, [entry]))) continue
    selected.push(candidate)
  }

  return selected.sort((a, b) => a.start - b.start)
}

/** Leading Markdown heading or formatted block that already provides emphasis. */
function leadingFormattedRange(text: string): AnchorRange | null {
  const atx = /^\s*(?:>\s*)*#{1,6}\s+/.exec(text)
  if (atx) {
    const start = atx.index + atx[0].length
    const lineEnd = text.indexOf('\n', start)
    return { start, end: lineEnd === -1 ? text.length : lineEnd }
  }

  const html = /^\s*(?:>\s*)*<(strong|b)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/i.exec(text)
  if (html && html[2] !== undefined) {
    const content = html[2]
    const start = html.index + html[0].indexOf(content)
    return { start, end: start + content.length }
  }

  const markerMatch = /^\s*(?:>\s*)*(\*\*\*|___|\*\*|__)/.exec(text)
  const marker = markerMatch?.[1]
  if (!markerMatch || !marker) return null
  const start = markerMatch.index + markerMatch[0].length
  const close = text.indexOf(marker, start)
  return close === -1 ? null : { start, end: close }
}

/**
 * Highlight at most one non-heading occurrence per ingredient and step.
 * All factual mentions remain in the result for usage and amount decisions.
 */
function markMentionHighlights(
  mentions: readonly IngredientMention[],
  heading: AnchorRange | null,
): IngredientMention[] {
  const highlighted = new Set<string>()
  return mentions.map((mention) => {
    const inHeading =
      heading !== null && mention.start >= heading.start && mention.end <= heading.end
    if (inHeading || highlighted.has(mention.ingredient.id)) {
      return { ...mention, highlight: false }
    }
    highlighted.add(mention.ingredient.id)
    return { ...mention, highlight: true }
  })
}

/** Unique, safely identified ingredients for the compact step list. */
function buildStepIngredients(
  references: readonly RenderedReference[],
  mentions: readonly IngredientMention[],
  factor: number | null,
): StepIngredientInfo[] {
  const manualById = new Map<string, RenderedReference[]>()
  for (const reference of references) {
    if (!reference.ingredient) continue
    const list = manualById.get(reference.ingredient.id) ?? []
    list.push(reference)
    manualById.set(reference.ingredient.id, list)
  }

  const mentionsById = new Map<string, IngredientMention[]>()
  for (const mention of mentions) {
    const list = mentionsById.get(mention.ingredient.id) ?? []
    list.push(mention)
    mentionsById.set(mention.ingredient.id, list)
  }

  const result: StepIngredientInfo[] = []
  const seen = new Set<string>()
  const add = (ingredient: Ingredient) => {
    if (seen.has(ingredient.id)) return
    seen.add(ingredient.id)

    const manualRefs = manualById.get(ingredient.id) ?? []
    const ingredientMentions = mentionsById.get(ingredient.id) ?? []
    const issue =
      manualRefs
        .map((reference) => reference.issue)
        .find((value): value is ReferenceIssue => value !== null) ?? null
    const hasManualAmount = manualRefs.some(
      (reference) => reference.issue !== 'anchor-not-found',
    )
    const hasAmountInText =
      hasManualAmount || ingredientMentions.some((mention) => mention.hasAmount)
    const amountText = scaledTotalAmountText(ingredient, factor)

    result.push({
      ingredient,
      displayName: ingredientDisplayName(ingredient.name),
      hasAmountInText,
      amountText,
      issue,
    })
  }

  for (const mention of mentions) add(mention.ingredient)
  for (const refs of manualById.values()) {
    const ingredient = refs[0]?.ingredient
    if (ingredient) add(ingredient)
  }
  return result
}

function scaledTotalAmountText(
  ingredient: Ingredient,
  factor: number | null,
): string | null {
  if (factor === null) return null
  const quantityText = ingredientQuantityText(ingredient)
  if (typeof quantityText !== 'string' || !isStrictQuantityText(quantityText)) {
    return null
  }
  // Do not turn an ambiguous thousands separator into a precise total.
  if (/\d{1,3}(?:\.\d{3})+/.test(quantityText)) return null
  const scaled = scaleQuantityText(quantityText, factor)
  if (scaled === null) return null
  const unit = ingredient.unit?.trim() ?? ''
  return [scaled, unit].filter(Boolean).join(' ')
}

function annotateInstructionText(
  text: string,
  mentions: readonly IngredientMention[],
): string {
  let annotated = text
  for (const mention of [...mentions]
    .filter((entry) => entry.highlight)
    .sort((a, b) => b.start - a.start)) {
    const label = text.slice(mention.start, mention.end)
    const wrapped = `<span class="cook-ingredient-mention">${label}</span>`
    annotated =
      annotated.slice(0, mention.start) + wrapped + annotated.slice(mention.end)
  }
  return annotated
}

export interface RenderOptions {
  /** Recipe's original portion count; null keeps every value unchanged. */
  originalServings: number | null
  targetServings: number
  /** Cook mode opts into conservative automatic detection of instruction amounts. */
  autoScale?: boolean
  /** Cook mode opts into display-only ingredient highlighting inside instructions. */
  linkIngredients?: boolean
}

/**
 * Render all instruction texts for one portion count. Explicit references win
 * and are never auto-scaled again. When `autoScale` is enabled (cook mode),
 * every other ingredient amount that sits directly before a matching
 * ingredient name is replaced through the same shared quantity parser.
 * `linkIngredients` additionally adds display-only, conservative ingredient
 * highlighting. A missing ingredient, unknown amount, unsafe remainder,
 * ambiguous name or stale anchor leaves the original text exactly as it is.
 */
export function renderRecipeInstructions(
  instructions: readonly Instruction[],
  ingredients: readonly Ingredient[],
  options: RenderOptions,
): RenderedInstruction[] {
  const ingredientById = new Map(ingredients.map((ingredient) => [ingredient.id, ingredient]))
  const factor =
    typeof options.originalServings === 'number' &&
    Number.isFinite(options.originalServings) &&
    options.originalServings > 0 &&
    typeof options.targetServings === 'number' &&
    Number.isFinite(options.targetServings) &&
    options.targetServings > 0
      ? options.targetServings / options.originalServings
      : null
  const usageByIngredient = new Map<string, UsageState>()
  const mentionPhrases =
    options.autoScale || options.linkIngredients ? buildMentionPhrases(ingredients) : []
  const autoMatchers =
    options.autoScale && factor !== null && factor !== 1
      ? buildAutoMatchers(ingredients, mentionPhrases)
      : []

  const base = instructions.map((instruction, instructionIndex) => {
    const text = instruction.text
    const references = normalizeReferenceAnchors(text, instruction.references ?? [])
    const used: AnchorRange[] = []
    const manualRanges: AnchorRange[] = []
    const manualIngredientIds = new Set<string>()
    const replacements: InstructionReplacement[] = []
    const renderedReferences: RenderedReference[] = []

    for (const [referenceIndex, reference] of references.entries()) {
      const issues: ReferenceIssue[] = []
      const ingredient = ingredientById.get(reference.ingredientId) ?? null
      if (!ingredient) issues.push('missing-ingredient')
      manualIngredientIds.add(reference.ingredientId)

      const usage = usageByIngredient.get(reference.ingredientId) ?? newUsage()
      if (!usageByIngredient.has(reference.ingredientId)) {
        usageByIngredient.set(reference.ingredientId, usage)
      }

      let amountText: string | null = null
      let scaled = false
      if (ingredient) {
        const unsafeRemainder =
          reference.quantity.kind === 'remainder' &&
          hasLaterReferenceForIngredient(instructions, reference.ingredientId, {
            instructionIndex,
            referenceIndex: referenceIndex + 1,
          })
        const baseAmount = baseAmountFor(ingredient, reference, usage, unsafeRemainder)
        if (baseAmount.issue) issues.push(baseAmount.issue)
        amountText = baseAmount.text
        if (!baseAmount.text && !baseAmount.issue) issues.push('missing-quantity')
        if (baseAmount.text && !isStrictQuantityText(baseAmount.text)) {
          issues.push('missing-quantity')
          amountText = null
        } else if (baseAmount.text && factor !== null) {
          if (baseAmount.scaledFromRemainder !== undefined) {
            amountText = formatScaledNumber(baseAmount.scaledFromRemainder * factor)
            scaled = true
          } else {
            const scaledText = scaleQuantityText(baseAmount.text, factor)
            if (scaledText !== null) {
              amountText = scaledText
              scaled = true
            } else {
              issues.push('missing-quantity')
            }
          }
        } else if (baseAmount.text) {
          issues.push(
            options.originalServings === null
              ? 'unknown-original-servings'
              : 'invalid-target',
          )
        }
      }

      const anchor = resolveReferenceAnchor(text, reference, used)
      if (anchor) manualRanges.push(anchor)
      if (!anchor) issues.push('anchor-not-found')

      if (scaled && anchor && !overlaps(anchor, used)) {
        used.push(anchor)
        replacements.push({
          ...anchor,
          value: amountText ?? reference.anchor,
          ingredientId: reference.ingredientId,
        })
      } else if (scaled && anchor) {
        issues.push('overlapping-anchor')
      }

      if (ingredient) updateUsage(usage, ingredient, reference)

      renderedReferences.push({
        reference,
        ingredient,
        amountText,
        scaled,
        issue: firstIssue(issues),
      })
    }

    if (autoMatchers.length > 0 && factor !== null) {
      const automatic = automaticReplacements(
        searchableInstructionText(text),
        autoMatchers,
        factor,
        manualIngredientIds,
        manualRanges,
      )
      replacements.push(...automatic)
    }

    let renderedText = text
    for (const replacement of [...replacements].sort((a, b) => b.start - a.start)) {
      renderedText =
        renderedText.slice(0, replacement.start) +
        replacement.value +
        renderedText.slice(replacement.end)
    }

    return { instruction, text: renderedText, references: renderedReferences }
  })

  if (!options.linkIngredients) {
    return base.map((entry) => ({
      ...entry,
      annotatedText: entry.text,
      mentions: [],
      stepIngredients: [],
    }))
  }

  const withMentions = base.map((entry) => {
    const searchText = searchableInstructionText(entry.text)
    const rawMentions: IngredientMention[] = detectMentions(
      searchText,
      mentionPhrases,
    ).map((candidate) => ({
      ingredient: candidate.ingredient,
      start: candidate.start,
      end: candidate.end,
      hasAmount: hasExplicitAmountNearMention(
        searchText,
        candidate.start,
        candidate.end,
      ),
      highlight: false,
    }))
    return {
      ...entry,
      mentions: markMentionHighlights(
        rawMentions,
        leadingFormattedRange(entry.text),
      ),
    }
  })

  return withMentions.map((entry) => ({
    instruction: entry.instruction,
    text: entry.text,
    annotatedText: annotateInstructionText(entry.text, entry.mentions),
    references: entry.references,
    mentions: entry.mentions,
    stepIngredients: buildStepIngredients(entry.references, entry.mentions, factor),
  }))
}

/**
 * Original "remaining" amount for a to-be-created remainder reference. Only
 * safe when all earlier references of the same ingredient are explicit,
 * single-value partial amounts and their sum is smaller than the total.
 */
export function computeRemainingQuantity(
  instructions: readonly Pick<Instruction, 'text' | 'references'>[],
  ingredients: readonly Ingredient[],
  ingredientId: string,
  before: { instructionIndex: number; referenceIndex: number },
): { text: string; remaining: number } | null {
  const ingredient = ingredients.find((entry) => entry.id === ingredientId)
  if (!ingredient) return null
  const usage = newUsage()
  for (let instructionIndex = 0; instructionIndex <= before.instructionIndex; instructionIndex += 1) {
    const instruction = instructions[instructionIndex]
    if (!instruction) break
    const references = instruction.references ?? []
    const limit =
      instructionIndex === before.instructionIndex ? before.referenceIndex : references.length
    for (let index = 0; index < limit; index += 1) {
      const reference = references[index]
      if (!reference || reference.ingredientId !== ingredientId) continue
      updateUsage(usage, ingredient, reference)
    }
  }
  const remaining = remainingAmount(ingredient, usage)
  if (remaining === null) return null
  return { text: formatScaledNumber(remaining), remaining }
}

/** True when a later reference uses the same ingredient, making a remainder unsound. */
export function hasLaterReferenceForIngredient(
  instructions: readonly Pick<Instruction, 'references'>[],
  ingredientId: string,
  after: { instructionIndex: number; referenceIndex: number },
): boolean {
  for (let index = after.instructionIndex; index < instructions.length; index += 1) {
    const references = instructions[index]?.references ?? []
    const start = index === after.instructionIndex ? after.referenceIndex : 0
    for (let refIndex = start; refIndex < references.length; refIndex += 1) {
      if (references[refIndex]?.ingredientId === ingredientId) return true
    }
  }
  return false
}

/**
 * Keep only structurally valid references and refresh offsets. Used by the
 * database migration, backup import and the recipe editor.
 */
export function normalizeInstructionList(
  value: unknown,
  idForIndex: (index: number) => string = (index) => `step-${index + 1}`,
): Instruction[] {
  // Legacy/unstructured instruction text is split only at line boundaries,
  // never at sentences, and every line keeps its exact content.
  const entries: unknown[] =
    typeof value === 'string'
      ? value
          .replace(/\r\n?/g, '\n')
          .split('\n')
          .filter((line) => line.trim().length > 0)
      : Array.isArray(value)
        ? value
        : []
  if (entries.length === 0) return []
  const usedIds = new Set<string>()
  return entries
    .map((entry, index): Instruction | null => {
      if (typeof entry === 'string') {
        const text = entry.trim()
        if (!text) return null
        entry = { raw: text, text }
      }
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null
      const data = entry as Record<string, unknown>
      const text =
        typeof data.text === 'string'
          ? data.text
          : typeof data.raw === 'string'
            ? data.raw
            : ''
      const raw = typeof data.raw === 'string' ? data.raw : text
      let id = typeof data.id === 'string' ? data.id.trim() : ''
      if (!id || usedIds.has(id)) {
        let candidate = idForIndex(index)
        let suffix = 1
        while (usedIds.has(candidate)) {
          candidate = `${idForIndex(index)}-${suffix}`
          suffix += 1
        }
        id = candidate
      }
      usedIds.add(id)
      const references = normalizeReferenceAnchors(
        text,
        sanitizeInstructionReferences(data.references, (refIndex) => `${id}-ref-${refIndex + 1}`),
      )
      return {
        ...(data as Partial<Instruction>),
        id,
        position: index,
        raw,
        text,
        references,
      }
    })
    .filter((instruction): instruction is Instruction => instruction !== null)
}
