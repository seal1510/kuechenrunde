/*
 * openCook Web
 * Copyright (C) 2026 openCook Web contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Central, data-driven ingredient catalogue.
 *
 * One lookup decides, for every recognised food name, the canonical product
 * identity, its shopping category and the product form (fresh, dried, ground,
 * seed, paste, …). Shopping aggregation, item keys, category assignment and
 * the displayed article name all use this lookup, so the same ingredient can
 * no longer be interpreted differently in different code paths.
 *
 * Data provenance and the exact sources are documented in
 * `ingredientCatalogData.ts`.
 */

import { catalogText, normalizeUnitCandidate, shoppingItemKey } from './ingredientNames'
import { CATALOG_FAMILIES } from './ingredientCatalogData'

export type CatalogCategory =
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

/**
 * Product form of a concrete shopping product. Forms are deliberately coarse:
 * they describe what the shopper puts in the basket, not the full processing
 * history.
 */
export type CatalogForm =
  | 'fresh'
  | 'dried'
  | 'ground'
  | 'whole'
  | 'seed'
  | 'leaf'
  | 'root'
  | 'stick'
  | 'paste'
  | 'oil'
  | 'flour'
  | 'flakes'
  | 'sprouts'
  | 'canned'
  | 'frozen'
  | 'milk'
  | 'juice'
  | 'other'

/** Unit classes that may disambiguate an otherwise form-less name. */
export type CatalogUnitHint = 'spoon' | 'pinch' | 'count' | 'bunch' | 'can' | 'jar' | 'package'

export interface CatalogProductSpec {
  /** Stable identity id; also used in catalogue diagnostics. */
  id: string
  /** Canonical label shown on the shopping list unless the user renamed it. */
  label: string
  category: CatalogCategory
  /**
   * Forms this product represents. A matching form word ("gemahlen",
   * "getrocknet", a "…pulver" compound, …) selects the product.
   */
  forms: CatalogForm[]
  /** Complete names that only mean this product. */
  aliases?: string[]
  /** Variety/colour words that select this product inside its family. */
  qualifiers?: string[]
  /** Product for the bare family name. Exactly one per family. */
  default?: boolean
  /**
   * Units that may select this product when the name itself carries no form.
   * Used only for genuinely ambiguous bare names.
   */
  unitHints?: CatalogUnitHint[]
}

export interface CatalogFamilySpec {
  id: string
  /** Bare names and synonyms; every name resolves to the default product. */
  names: string[]
  products: CatalogProductSpec[]
}

export interface CatalogMatch {
  productId: string
  familyId: string
  /** Canonical display label. */
  label: string
  category: CatalogCategory
  form: CatalogForm
  /** True when the unit, not the name, selected the product form. */
  viaUnitHint: boolean
  /** True when this product is the bare family default. */
  isDefaultProduct: boolean
  /** Canonical shopping key of this identity. */
  key: string
}

interface ProductRecord extends CatalogProductSpec {
  familyId: string
  familyNames: string[]
  canonicalKey: string
}

interface FamilyRecord extends CatalogFamilySpec {
  defaultProduct: ProductRecord
  products: ProductRecord[]
}

export interface CatalogConflict {
  name: string
  kind: 'alias' | 'product-key' | 'canonical-key'
  winner: string
  loser: string
}

const conflicts: CatalogConflict[] = []
const productsById = new Map<string, ProductRecord>()
const familiesById = new Map<string, FamilyRecord>()
const productsByAlias = new Map<string, ProductRecord>()
const familiesByName = new Map<string, FamilyRecord>()
const canonicalKeys = new Set<string>()
const productByCanonicalKey = new Map<string, ProductRecord>()
const aliasKeyToCanonical = new Map<string, string>()
const canonicalToAliasKeys = new Map<string, Set<string>>()
const recordedAliasKeys = new Set<string>()

function registerAlias(name: string, product: ProductRecord): void {
  const alias = catalogText(name)
  if (!alias) return
  const existing = productsByAlias.get(alias)
  if (existing && existing.id !== product.id) {
    // A concrete product inside the same family owns the name; the family
    // name merely points at the default product. That is intended, not a
    // data-quality problem.
    if (existing.familyId !== product.familyId) {
      conflicts.push({
        name: alias,
        kind: 'alias',
        winner: existing.id,
        loser: product.id,
      })
    }
    return
  }
  productsByAlias.set(alias, product)
}

function registerKey(alias: string, product: ProductRecord): void {
  const key = shoppingItemKey(alias)
  if (!key) return
  const existing = aliasKeyToCanonical.get(key)
  if (existing && existing !== product.canonicalKey) {
    // A legacy key that would resolve to two products is not usable for
    // compatibility. The canonical key itself always wins, and the ambiguous
    // legacy key is simply not registered.
    return
  }
  aliasKeyToCanonical.set(key, product.canonicalKey)
  const reverse = canonicalToAliasKeys.get(product.canonicalKey) ?? new Set<string>()
  reverse.add(key)
  canonicalToAliasKeys.set(product.canonicalKey, reverse)
  recordedAliasKeys.add(key)
}

function buildCatalogue(): void {
  for (const family of CATALOG_FAMILIES) {
    const records: ProductRecord[] = family.products.map((product) => ({
      ...product,
      familyId: family.id,
      familyNames: family.names,
      canonicalKey: shoppingItemKey(product.label),
    }))
    const defaultProduct = records.find((product) => product.default)
    if (!defaultProduct) {
      throw new Error(`Ingredient catalogue family ${family.id} has no default product.`)
    }
    const familyRecord: FamilyRecord = { ...family, defaultProduct, products: records }
    familiesById.set(family.id, familyRecord)
    for (const product of records) {
      if (productsById.has(product.id)) {
        throw new Error(`Duplicate ingredient catalogue product id ${product.id}.`)
      }
      productsById.set(product.id, product)
      if (canonicalKeys.has(product.canonicalKey)) {
        conflicts.push({
          name: product.canonicalKey,
          kind: 'product-key',
          winner: product.canonicalKey,
          loser: product.id,
        })
      }
      canonicalKeys.add(product.canonicalKey)
      productByCanonicalKey.set(product.canonicalKey, product)
    }
    // Canonical labels own their name first; aliases and family names can only
    // fill gaps. Without this order a default product's alias could steal the
    // label of a more specific product in the same family.
    for (const product of records) registerAlias(product.label, product)
    for (const product of records) {
      for (const alias of product.aliases ?? []) registerAlias(alias, product)
    }
    for (const name of family.names) {
      const alias = catalogText(name)
      if (!alias) continue
      const existingFamily = familiesByName.get(alias)
      if (existingFamily && existingFamily.id !== family.id) {
        conflicts.push({
          name: alias,
          kind: 'alias',
          winner: existingFamily.defaultProduct.id,
          loser: defaultProduct.id,
        })
      } else {
        familiesByName.set(alias, familyRecord)
      }
      registerAlias(name, defaultProduct)
    }
    for (const product of records) {
      for (const alias of [product.label, ...(product.aliases ?? [])]) registerKey(alias, product)
    }
    for (const name of family.names) registerKey(name, defaultProduct)
  }
}

buildCatalogue()

/* ------------------------------------------------------------------ */
/* Form and qualifier vocabulary                                       */
/* ------------------------------------------------------------------ */

const FORM_WORD_ROOTS: ReadonlyArray<readonly [string, CatalogForm]> = [
  ['frisch', 'fresh'],
  ['getrocknet', 'dried'],
  ['gerebelt', 'dried'],
  ['gemahlen', 'ground'],
  ['pulverisiert', 'ground'],
  ['zerstossen', 'ground'],
  ['zerrieben', 'ground'],
  ['gerieben', 'ground'],
  ['ganz', 'whole'],
  ['samen', 'seed'],
  ['saat', 'seed'],
  ['korner', 'seed'],
  ['korn', 'seed'],
  ['kerne', 'seed'],
  ['blatter', 'leaf'],
  ['blatt', 'leaf'],
  ['wurzeln', 'root'],
  ['wurzel', 'root'],
  ['stangen', 'stick'],
  ['stange', 'stick'],
  ['paste', 'paste'],
  ['mark', 'paste'],
  ['ol', 'oil'],
  ['oel', 'oil'],
  ['mehl', 'flour'],
  ['flocken', 'flakes'],
  ['sprossen', 'sprouts'],
  ['keime', 'sprouts'],
  ['milch', 'milk'],
  ['saft', 'juice'],
]

const QUALIFIER_ROOTS = new Set([
  'edelsuss',
  'rosenscharf',
  'scharf',
  'mild',
  'gerauchert',
  'rauchig',
  'schwarz',
  'weiss',
  'grun',
  'rot',
  'gelb',
  'braun',
  'rosa',
])

/** Strip one German adjective ending; used only to compare known roots. */
function stripAdjectiveEnding(word: string): string {
  if (word.length <= 4) return word
  for (const suffix of ['es', 'er', 'en', 'em', 'e']) {
    if (!word.endsWith(suffix)) continue
    const stem = word.slice(0, -suffix.length)
    if (stem.length >= 3) return stem
  }
  return word
}

function formForWord(word: string): CatalogForm | null {
  const variants = [word, stripAdjectiveEnding(word)]
  for (const [root, form] of FORM_WORD_ROOTS) {
    if (variants.includes(root)) return form
  }
  return null
}

function qualifierForWord(word: string): string | null {
  // Product types are often written as a bare number ("Mehl (550)"). A number
  // is only a qualifier when the matched family actually declares it, so
  // package sizes and vintages cannot select a product by themselves.
  if (/^\d{2,4}$/.test(word)) return word
  const variants = [word, stripAdjectiveEnding(word)]
  for (const variant of variants) {
    if (QUALIFIER_ROOTS.has(variant)) return variant
  }
  return null
}

/**
 * German compounds carry the product base first and the processing form last
 * ("Korianderpulver", "Kreuzkümmelsamen", "Kurkumawurzel"). Only curated form
 * suffixes are split; arbitrary compounds stay untouched.
 */
const COMPOUND_SUFFIXES: ReadonlyArray<readonly [string, CatalogForm]> = [
  ['pulverisiert', 'ground'],
  ['pulver', 'ground'],
  ['sprossen', 'sprouts'],
  ['flocken', 'flakes'],
  ['kornern', 'seed'],
  ['korner', 'seed'],
  ['korn', 'seed'],
  ['kerne', 'seed'],
  ['samen', 'seed'],
  ['saat', 'seed'],
  ['blatter', 'leaf'],
  ['blatt', 'leaf'],
  ['wurzeln', 'root'],
  ['wurzel', 'root'],
  ['stangen', 'stick'],
  ['stange', 'stick'],
  ['paste', 'paste'],
  ['mark', 'paste'],
  ['milch', 'milk'],
  ['saft', 'juice'],
  ['mehl', 'flour'],
  ['ol', 'oil'],
  ['oel', 'oil'],
]

function splitCompound(token: string): { head: string; form: CatalogForm } | null {
  for (const [suffix, form] of COMPOUND_SUFFIXES) {
    if (token.length <= suffix.length + 2) continue
    if (!token.endsWith(suffix)) continue
    return { head: token.slice(0, -suffix.length), form }
  }
  return null
}

/* ------------------------------------------------------------------ */
/* Unit hints                                                          */
/* ------------------------------------------------------------------ */

const SPOON_UNITS = new Set([
  'tl',
  'teeloffel',
  'teeloeffel',
  'el',
  'essloffel',
  'essloeffel',
  'msp',
  'messerspitze',
])

const PINCH_UNITS = new Set(['prise', 'prisen'])

const COUNT_UNITS = new Set([
  'stuck',
  'stueck',
  'stk',
  'zehe',
  'zehen',
  'stange',
  'stangen',
  'zweig',
  'zweige',
  'knolle',
  'knollen',
  'kopf',
  'kopfe',
  'koepfe',
  'scheibe',
  'scheiben',
  'blatt',
  'blatter',
  'blaetter',
  'handvoll',
  'kugel',
  'kugeln',
])

const BUNCH_UNITS = new Set(['bund', 'bunde', 'buende'])
const CAN_UNITS = new Set(['dose', 'dosen', 'konserve', 'konserven'])
const JAR_UNITS = new Set(['glas', 'glaser', 'glaeser'])
const PACKAGE_UNITS = new Set(['packung', 'packungen', 'pck', 'beutel', 'tube', 'tuben', 'flasche', 'flaschen'])

/** Classify an explicit unit string; null when it carries no form hint. */
function unitHintFor(unit: string | null | undefined): CatalogUnitHint | null {
  const normalized = catalogText(normalizeUnitCandidate(unit ?? ''))
  if (!normalized) return null
  if (SPOON_UNITS.has(normalized)) return 'spoon'
  if (PINCH_UNITS.has(normalized)) return 'pinch'
  if (BUNCH_UNITS.has(normalized)) return 'bunch'
  if (CAN_UNITS.has(normalized)) return 'can'
  if (JAR_UNITS.has(normalized)) return 'jar'
  if (PACKAGE_UNITS.has(normalized)) return 'package'
  if (COUNT_UNITS.has(normalized)) return 'count'
  return null
}

const FORM_PRIORITY: Record<CatalogForm, number> = {
  paste: 9,
  oil: 8,
  ground: 7,
  dried: 6,
  fresh: 6,
  flour: 6,
  milk: 6,
  juice: 6,
  canned: 5,
  frozen: 5,
  seed: 4,
  whole: 3,
  leaf: 2,
  root: 2,
  stick: 2,
  flakes: 2,
  sprouts: 2,
  other: 1,
}

/* ------------------------------------------------------------------ */
/* Matching                                                            */
/* ------------------------------------------------------------------ */

function toMatch(product: ProductRecord, viaUnitHint: boolean): CatalogMatch {
  return {
    productId: product.id,
    familyId: product.familyId,
    label: product.label,
    category: product.category,
    form: product.forms[0] ?? 'other',
    viaUnitHint,
    isDefaultProduct: product.default === true,
    key: product.canonicalKey,
  }
}

function includesAllQualifiers(product: ProductRecord, qualifiers: ReadonlySet<string>): boolean {
  const own = new Set(product.qualifiers ?? [])
  for (const qualifier of qualifiers) {
    if (!own.has(qualifier)) return false
  }
  return true
}

function selectByForm(
  family: FamilyRecord,
  forms: ReadonlySet<CatalogForm>,
  qualifiers: ReadonlySet<string>,
): ProductRecord | null {
  let candidates = family.products
  if (qualifiers.size > 0) {
    const qualified = candidates.filter((product) => includesAllQualifiers(product, qualifiers))
    if (qualified.length > 0) candidates = qualified
    else return null
  }
  if (forms.size > 0) {
    const matching = candidates.filter((product) =>
      product.forms.some((form) => forms.has(form)),
    )
    if (matching.length === 0) return null
    let best = 0
    for (const product of matching) {
      for (const form of product.forms) {
        if (forms.has(form)) best = Math.max(best, FORM_PRIORITY[form])
      }
    }
    const top = matching.filter((product) =>
      product.forms.some((form) => forms.has(form) && FORM_PRIORITY[form] === best),
    )
    return top.find((product) => product.default) ?? top[0] ?? null
  }
  return candidates.find((product) => product.default) ?? candidates[0] ?? null
}

function selectBare(
  family: FamilyRecord,
  unitHint: CatalogUnitHint | null,
): CatalogMatch {
  if (unitHint) {
    const hinted = family.products.find((product) =>
      (product.unitHints ?? []).includes(unitHint),
    )
    if (hinted) return toMatch(hinted, true)
  }
  return toMatch(family.defaultProduct, false)
}

export interface ResolveCatalogOptions {
  /** Explicit unit of the ingredient line, if any. */
  unit?: string | null
}

/**
 * Resolve a (already cleaned) ingredient name to one canonical product.
 * Returns null when the name is unknown or the written form cannot be resolved
 * without guessing; callers then keep their previous, conservative behaviour.
 */
export function resolveCatalogMatch(
  rawName: string,
  options: ResolveCatalogOptions = {},
): CatalogMatch | null {
  const text = catalogText(rawName)
  if (!text) return null

  const exactProduct = productsByAlias.get(text)
  if (exactProduct) {
    // A bare family name is still ambiguous with respect to the product form;
    // an explicit unit may resolve it ("1 TL Koriander" is the ground spice).
    const bareFamily = familiesByName.get(text)
    const isBareDefault =
      exactProduct.default === true &&
      bareFamily !== undefined &&
      bareFamily.id === exactProduct.familyId &&
      bareFamily.defaultProduct.id === exactProduct.id
    if (isBareDefault) {
      const family = familiesById.get(exactProduct.familyId)
      const hint = unitHintFor(options.unit)
      const hinted = hint
        ? family?.products.find((product) => (product.unitHints ?? []).includes(hint))
        : undefined
      if (hinted) return toMatch(hinted, true)
    }
    return toMatch(exactProduct, false)
  }

  const exactFamily = familiesByName.get(text)
  if (exactFamily) return selectBare(exactFamily, unitHintFor(options.unit))

  const tokens = text.split(' ').filter(Boolean)
  const forms = new Set<CatalogForm>()
  const qualifiers = new Set<string>()
  const rest: string[] = []
  for (const token of tokens) {
    const form = formForWord(token)
    // Some form words are also real product names ("Mehl", "Milch", "Öl").
    // They stay the base of the name instead of being consumed as a suffix.
    if (form && !productsByAlias.has(token) && !familiesByName.has(token)) {
      forms.add(form)
      continue
    }
    const qualifier = qualifierForWord(token)
    if (qualifier) {
      qualifiers.add(qualifier)
      continue
    }
    rest.push(token)
  }
  if (rest.length === 0) return null

  const restText = rest.join(' ')
  const restProduct = productsByAlias.get(restText)
  if (restProduct) {
    if (forms.size === 0 && qualifiers.size === 0) return toMatch(restProduct, false)
    const family = familiesById.get(restProduct.familyId)
    if (family) {
      const selected = selectByForm(family, forms, qualifiers)
      if (selected) return toMatch(selected, false)
    }
    return null
  }
  const restFamily = familiesByName.get(restText)
  if (restFamily) {
    const selected = forms.size > 0 ? selectByForm(restFamily, forms, qualifiers) : null
    if (selected) return toMatch(selected, false)
    if (qualifiers.size > 0) {
      const selectedByQualifier = selectByForm(restFamily, forms, qualifiers)
      if (selectedByQualifier) return toMatch(selectedByQualifier, false)
    }
    return selectBare(restFamily, forms.size > 0 || qualifiers.size > 0 ? null : unitHintFor(options.unit))
  }

  if (rest.length === 1) {
    const compound = splitCompound(rest[0] ?? '')
    if (compound) {
      forms.add(compound.form)
      const compoundFamily = familiesByName.get(compound.head)
      if (compoundFamily) {
        const selected = selectByForm(compoundFamily, forms, qualifiers)
        if (selected) return toMatch(selected, false)
      }
      const compoundProduct = productsByAlias.get(compound.head)
      if (compoundProduct) {
        const family = familiesById.get(compoundProduct.familyId)
        if (family) {
          const selected = selectByForm(family, forms, qualifiers)
          if (selected) return toMatch(selected, false)
        }
      }
    }
  }

  return null
}

/**
 * Read-time compatibility for shopping keys written by older versions. The
 * catalogue knows every alias key that belongs to a canonical identity, so a
 * historical purchase or rule keeps matching without a database migration.
 */
export function catalogShoppingKey(key: string): string {
  const clean = String(key ?? '').trim()
  if (!clean) return clean
  const direct = canonicalKeys.has(clean) ? clean : aliasKeyToCanonical.get(clean)
  if (direct) return direct
  return compositeKeyTarget(clean) ?? clean
}

/**
 * Older identities could append a translated synonym to the base name
 * ("Kreuzkümmel" + "Cumin"). Both parts are known catalogue products of the
 * same family; the key is therefore a valid legacy spelling of one identity.
 */
function productForKeySegment(segment: string): ProductRecord | null {
  const canonical = canonicalKeys.has(segment)
    ? segment
    : aliasKeyToCanonical.get(segment)
  if (!canonical) return null
  return productByCanonicalKey.get(canonical) ?? null
}

function compositeKeyTarget(key: string): string | null {
  const tokens = key.split(' ').filter(Boolean)
  for (let index = tokens.length - 1; index >= 1; index -= 1) {
    const left = productForKeySegment(tokens.slice(0, index).join(' '))
    const right = productForKeySegment(tokens.slice(index).join(' '))
    if (!left || !right || left.familyId !== right.familyId) continue
    // A more specific variant beats a bare family default; an explicit base
    // form beats a plain translation.
    return left.default === true && right.default !== true
      ? right.canonicalKey
      : left.canonicalKey
  }
  return null
}

/** Canonical key plus every legacy alias key that maps to it. */
export function catalogKeyVariants(key: string): string[] {
  const canonical = catalogShoppingKey(key)
  const variants = canonicalToAliasKeys.get(canonical)
  if (!variants || variants.size === 0) return [canonical]
  return Array.from(new Set([canonical, ...variants])).sort()
}

export interface CatalogStats {
  families: number
  products: number
  /** Family-level names (bare synonyms that resolve to the default product). */
  names: number
  /** Explicit product aliases declared in the data file. */
  explicitAliases: number
  /** Distinct normalised names in the lookup index. */
  distinctNames: number
  /** Distinct legacy shopping keys that map onto a canonical identity. */
  legacyKeys: number
  forms: number
  categories: Record<string, number>
}

/** Factual coverage numbers, used by tests and the project documentation. */
export function catalogStats(): CatalogStats {
  const forms = new Set<CatalogForm>()
  const categories: Record<string, number> = {}
  let explicitAliases = 0
  let names = 0
  for (const family of familiesById.values()) {
    names += family.names.length
    for (const product of family.products) {
      explicitAliases += product.aliases?.length ?? 0
      for (const form of product.forms) forms.add(form)
      categories[product.category] = (categories[product.category] ?? 0) + 1
    }
  }
  return {
    families: familiesById.size,
    products: productsById.size,
    names,
    explicitAliases,
    distinctNames: productsByAlias.size,
    legacyKeys: recordedAliasKeys.size,
    forms: forms.size,
    categories,
  }
}

/** Data-quality report; the catalogue test asserts that it stays empty. */
export function catalogConflicts(): CatalogConflict[] {
  return conflicts.slice()
}

export function catalogFamilies(): readonly CatalogFamilySpec[] {
  return CATALOG_FAMILIES
}
