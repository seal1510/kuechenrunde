/*
 * openCook Web
 * Copyright (C) 2026 openCook Web contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Explicit ingredient references inside instruction texts.
 *
 * The imported instruction text is the source of truth. A reference only marks
 * one amount substring (its anchor) that may be replaced for display. Amounts
 * are parsed and scaled with the existing `domain/scaling` logic. No global
 * search-and-replace is ever performed, so temperatures, times and every other
 * unlinked number stay untouched.
 */

import {
  formatQuantityToken,
  formatScaledNumber,
  parseQuantityToken,
  scaleQuantityText,
} from '../domain/scaling'
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

export interface RenderedInstruction {
  instruction: Instruction
  /** Instruction text with only resolved anchors replaced. */
  text: string
  references: RenderedReference[]
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

export interface RenderOptions {
  /** Recipe's original portion count; null keeps every value unchanged. */
  originalServings: number | null
  targetServings: number
}

/**
 * Render all instruction texts for one portion count. Only explicitly linked
 * anchors are touched. A missing ingredient, unknown amount, unsafe remainder
 * or stale anchor leaves the original text exactly as it is.
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

  return instructions.map((instruction, instructionIndex) => {
    const text = instruction.text
    const references = normalizeReferenceAnchors(text, instruction.references ?? [])
    const used: AnchorRange[] = []
    const replacements: Array<AnchorRange & { value: string }> = []
    const renderedReferences: RenderedReference[] = []

    for (const [referenceIndex, reference] of references.entries()) {
      const issues: ReferenceIssue[] = []
      const ingredient = ingredientById.get(reference.ingredientId) ?? null
      if (!ingredient) issues.push('missing-ingredient')

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
        const base = baseAmountFor(ingredient, reference, usage, unsafeRemainder)
        if (base.issue) issues.push(base.issue)
        amountText = base.text
        if (!base.text && !base.issue) issues.push('missing-quantity')
        if (base.text && !isStrictQuantityText(base.text)) {
          issues.push('missing-quantity')
          amountText = null
        } else if (base.text && factor !== null) {
          if (base.scaledFromRemainder !== undefined) {
            amountText = formatScaledNumber(base.scaledFromRemainder * factor)
            scaled = true
          } else {
            const scaledText = scaleQuantityText(base.text, factor)
            if (scaledText !== null) {
              amountText = scaledText
              scaled = true
            } else {
              issues.push('missing-quantity')
            }
          }
        } else if (base.text) {
          issues.push(
            options.originalServings === null
              ? 'unknown-original-servings'
              : 'invalid-target',
          )
        }
      }

      const anchor = resolveReferenceAnchor(text, reference, used)
      if (!anchor) issues.push('anchor-not-found')

      if (scaled && anchor && !overlaps(anchor, used)) {
        used.push(anchor)
        replacements.push({ ...anchor, value: amountText ?? reference.anchor })
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

    let renderedText = text
    for (const replacement of [...replacements].sort((a, b) => b.start - a.start)) {
      renderedText =
        renderedText.slice(0, replacement.start) +
        replacement.value +
        renderedText.slice(replacement.end)
    }

    return { instruction, text: renderedText, references: renderedReferences }
  })
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
