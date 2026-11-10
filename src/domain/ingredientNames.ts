/*
 * openCook Web
 * Copyright (C) 2026 openCook Web contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Shared, pure ingredient-name and unit-spelling normalisation. The import
 * parser and the shopping identity use the same rules so repaired legacy data
 * and freshly imported data cannot drift apart.
 */

const SIZE_ADJECTIVE_ROOTS = [
  'gross',
  'klein',
  'mittelgross',
  'daumengross',
  'riesig',
  'mehligkochend',
]

/** "große", "kleiner", "daumengroßes", … – but not arbitrary longer words. */
export function isSizeAdjectiveToken(token: string): boolean {
  const clean = token
    .toLocaleLowerCase('de')
    .replace(/ä/g, 'a')
    .replace(/ö/g, 'o')
    .replace(/ü/g, 'u')
    .replace(/ß/g, 'ss')
    .replace(/[.,;:!?]+$/g, '')
  return SIZE_ADJECTIVE_ROOTS.some(
    (root) => clean === root || (clean.startsWith(root) && clean.length - root.length <= 2),
  )
}

/** Drop leading size adjectives, but never the only remaining word. */
function stripLeadingSizeAdjectives(value: string): string {
  const parts = value.split(/\s+/).filter(Boolean)
  let index = 0
  while (index < parts.length - 1 && isSizeAdjectiveToken(parts[index] ?? '')) {
    index += 1
  }
  return parts.slice(index).join(' ')
}

/** Drop a redundant leading "Stück" left over from "1 daumengroßes Stück …". */
function stripLeadingPieceWord(value: string): string {
  const parts = value.split(/\s+/).filter(Boolean)
  const first = (parts[0] ?? '')
    .toLocaleLowerCase('de')
    .replace(/ä/g, 'a')
    .replace(/ö/g, 'o')
    .replace(/ü/g, 'u')
    .replace(/ß/g, 'ss')
    .replace(/[.,;:!?]+$/g, '')
  if (parts.length > 1 && (first === 'stuck' || first === 'stueck' || first === 'stk')) {
    return parts.slice(1).join(' ')
  }
  return value
}

/**
 * Expand German plural shorthand: "Zwiebel(n)" → "Zwiebeln",
 * "Mango(s)" → "Mangos", "Ei(er)" → "Eier". A space before the parenthesis is
 * deliberately not matched, so a grade such as "Eier (s)" is not pluralised.
 */
export function expandPluralSuffix(value: string): string {
  return value.replace(
    /(\S)\((n|en|e|er|s)\)/gi,
    (_match, before: string, suffix: string) => {
      const suffixLower = suffix.toLocaleLowerCase('de')
      return before.toLocaleLowerCase('de').endsWith(suffixLower)
        ? before
        : `${before}${suffixLower}`
    },
  )
}

const LEADING_APPROXIMATE =
  /^(?:etwas|ein\s+wenig|ein\s+bisschen|ein\s+paar|einige|manche)\s+/i
const LEADING_AMOUNT_DESCRIPTOR =
  /^(?:leicht\s+gehäuft|leicht\s+gehaeuft|gestrichen|gestr|gehäuft|gehaeuft|knapp|voll|ca|etwa|circa|rund|zirka|gut)\.?\s+/i
const LEADING_SEPARATOR = /^[\s,;:–—-]+/

/**
 * "Rindsuppe/-brühe/ -fond" is one product with alternative spellings. Keep
 * the first full name; only slash alternatives that start with a hyphen are
 * collapsed, so a real "Tomaten/Basilikum" mix is not silently truncated.
 */
function collapseSlashAlternatives(value: string): string {
  const match = /^([^/]+?)\s*\/\s*-[^/]*(?:\s*\/\s*-[^/]*)*$/.exec(value)
  return match?.[1]?.trim() || value
}

/**
 * Normalise a parsed ingredient name without touching its product variant.
 * Commas and other trailing annotations stay for `splitIngredientName`.
 */
export function normalizeIngredientName(value: string): string {
  let name = String(value ?? '').replace(LEADING_SEPARATOR, '').trim()
  for (let round = 0; round < 4; round += 1) {
    const before = name
    name = name
      .replace(LEADING_APPROXIMATE, '')
      .replace(LEADING_AMOUNT_DESCRIPTOR, '')
      .replace(LEADING_SEPARATOR, '')
    name = stripLeadingPieceWord(stripLeadingSizeAdjectives(name))
    if (name === before) break
  }
  return collapseSlashAlternatives(
    expandPluralSuffix(name).replace(/\s+/g, ' ').trim(),
  )
}

/** Lowercase, fold German umlauts, unify sharp s and spacing. */
export function foldIngredientText(value: string): string {
  return String(value ?? '')
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

/**
 * Conservative one-step plural/singular sweep shared by every identity key.
 * The same rule is applied to products and legends, so "Tomaten" and "Tomate"
 * land on the same key.
 */
export function stemIngredientWord(word: string): string {
  if (word.length <= 4) return word
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
  const folded = foldIngredientText(name)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!folded) return ''
  return folded
    .split(' ')
    .map(stemIngredientWord)
    .filter(Boolean)
    .join(' ')
}

/** Comparison form for catalogue lookups: no case, accents or punctuation. */
export function catalogText(value: string): string {
  return foldIngredientText(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Lowercase/canonical spelling used to recognise units. */
export function normalizeUnitCandidate(value: string): string {
  return String(value ?? '')
    .trim()
    .toLocaleLowerCase('de')
    .replace(/[.,;:]+$/g, '')
    .replace(/\/(?:n|e|en)$/, '')
    .replace(/\((?:n|e|en)\)$/i, '')
}

/** Unit spelling suitable for display ("Zehe/n" → "Zehe", "TL," → "TL"). */
export function displayUnitCandidate(value: string): string {
  return String(value ?? '')
    .trim()
    .replace(/[.,;:]+$/g, '')
    .replace(/\/(?:n|e|en)$/i, '')
    .replace(/\((?:n|e|en)\)$/i, '')
}
