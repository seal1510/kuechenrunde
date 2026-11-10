/*
 * openCook Web
 * Copyright (C) 2026 openCook Web contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Small, centrally maintained deny-list for staple ingredients that are
 * assumed to be at home. Filtering happens only after demand and list
 * distribution have been calculated, so allocations and purchases for these
 * products stay untouched and no review conflict is created.
 *
 * Matching is deliberately exact: the full normalised product identity must
 * equal one of these terms. Ingredient compounds such as "Cayennepfeffer",
 * "Chiliöl", "Sesamöl", "Kreuzkümmel" or "Kurkuma" are never excluded.
 */

import { splitIngredientName } from '../domain/shopping'

/**
 * Add a complete term here to hide another staple from the automatically
 * generated list. Keep entries as full product names, not fragments.
 */
export const DEFAULT_EXCLUDED_INGREDIENTS: readonly string[] = [
  // Water
  'Wasser',
  'Leitungswasser',
  'Trinkwasser',

  // Salt
  'Salz',
  'Speisesalz',
  'Tafelsalz',
  'Kochsalz',
  'Meersalz',
  'Jodsalz',
  'Steinsalz',
  'Himalayasalz',
  'Salzflocken',
  'Meersalzflocken',
  'feines Salz',
  'grobes Salz',
  'Salz fein',
  'Salz grob',

  // Pepper
  'Pfeffer',
  'schwarzer Pfeffer',
  'frisch gemahlener Pfeffer',
  'gemahlener Pfeffer',
  'Pfeffer schwarz',
  'Pfeffer gemahlen',
  'frisch gemahlener schwarzer Pfeffer',

  // Salt and pepper together
  'Salz und Pfeffer',
  'Salz und schwarzer Pfeffer',
  'Salz Pfeffer',

  // Olive oil
  'Olivenöl',
  'natives Olivenöl',
  'natives Olivenöl extra',
  'Olivenöl nativ extra',
  'extra natives Olivenöl',
  'Olivenöl extra vergine',

  // Neutral oils
  'Öl',
  'Pflanzenöl',
  'pflanzliches Öl',
  'Pflanzenöle',
  'Rapsöl',
  'Sonnenblumenöl',

  // Sugar
  'Zucker',
  'weißer Zucker',
  'Weißzucker',
  'Haushaltszucker',
]

/** Leading amount/usage words do not change which product is meant. */
const LEADING_QUANTITY_WORDS =
  /^(?:ca|etwa|circa|zirka|rund|ungefahr|gut|etwas|ein wenig|ein bisschen|nach geschmack|nach bedarf|nach belieben)\s+/

/** Whole-word qualifiers that do not turn a listed staple into another product. */
const NEUTRAL_QUALIFIERS = new Set([
  'frisch', 'frische', 'frischer', 'frisches', 'frischen', 'frischem',
  'fein', 'feine', 'feiner', 'feines', 'feinen', 'feinem',
  'grob', 'grobe', 'grober', 'grobes', 'groben', 'grobem',
  'gemahlen', 'gemahlene', 'gemahlener', 'gemahlenes', 'gemahlenen', 'gemahlenem',
  'schwarzer', 'schwarze', 'schwarzes', 'schwarzen', 'schwarzem', 'schwarz',
  'weisser', 'weisse', 'weisses', 'weissen', 'weissem', 'weiss',
  'nativ', 'native', 'natives', 'nativen', 'nativem',
  'extra', 'vergine',
  'kaltgepresst', 'kaltgepresste', 'kaltgepresster', 'kaltgepresstes',
  'neutral', 'neutrale', 'neutraler', 'neutrales',
  'jodiert', 'jodierte', 'jodierter', 'jodiertes',
  'unjodiert', 'unjodierte', 'unjodierter', 'unjodiertes',
  'raffiniert', 'raffinierte', 'raffinierter', 'raffiniertes',
  'unraffiniert', 'unraffinierte', 'unraffinierter', 'unraffiniertes',
  'dose', 'dosen', 'glas', 'glaser', 'konserve', 'konserven',
])

const TRAILING_USAGE = /\s(?:zum|zur|fur|fuer|nach|als)\s.*$/

function normalizeIdentity(value: string): string {
  const normalized = value
    .toLocaleLowerCase('de')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(LEADING_QUANTITY_WORDS, '')
    .replace(TRAILING_USAGE, '')
  return normalized
    .split(' ')
    .filter((token) => token && !NEUTRAL_QUALIFIERS.has(token))
    .join(' ')
}

const EXCLUDED_IDENTITIES = new Set(
  DEFAULT_EXCLUDED_INGREDIENTS.map(normalizeIdentity),
)

/**
 * True only when the complete product identity (base name plus a
 * product-determining variant) is on the staple deny-list. Manually added
 * articles are never passed through this check.
 */
export function isDefaultExcludedIngredient(
  name: string,
  variant = '',
): boolean {
  const split = splitIngredientName(name)
  const identity = [split.name, split.variant, variant]
    .map((part) => part.trim())
    .filter(Boolean)
    .join(' ')
  return EXCLUDED_IDENTITIES.has(normalizeIdentity(identity))
}
