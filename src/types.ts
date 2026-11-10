/*
 * openCook Web
 * Copyright (C) 2026 openCook Web contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Data model for the local recipe library. The model deliberately keeps the
 * complete original Mela object in `raw` so fields that cannot be structured
 * reliably are never lost.
 */

import type { ReasonContribution } from './domain/planner'

export interface IngredientGroup {
  id: string
  title: string
  position: number
  rawHeading: string
}

export type IngredientParseStatus = 'parsed' | 'plain'

export interface IngredientLink {
  label: string
  url: string
}

export interface Ingredient {
  id: string
  groupId: string | null
  position: number
  /** The original line exactly as it appeared in the Mela export. */
  raw: string
  /** Cleaned, human-readable name (markdown removed). */
  name: string
  quantity: number | null
  /** Original quantity token, e.g. "1/2" or "2-3", for lossless display. */
  quantityText: string | null
  unit: string | null
  /** Shopping-relevant note, e.g. "bevorzugt Mutti". Empty when unknown. */
  purchaseNote?: string
  /** Preparation note, e.g. "fein gewürfelt". Empty when unknown. */
  preparationNote?: string
  parseStatus: IngredientParseStatus
  links: IngredientLink[]
}

/**
 * How a linked instruction amount relates to the stored ingredient quantity.
 *
 * Amounts are always expressed for the recipe's original portion count. The
 * scaled value is derived only for display; neither the ingredient nor the
 * instruction text is ever rewritten.
 */
export type InstructionReferenceQuantity =
  | { kind: 'full' }
  | { kind: 'partial'; quantityText: string }
  | { kind: 'remainder' }

/**
 * One explicit link between an amount inside an instruction text and exactly
 * one stored ingredient. `anchor` is the amount substring that may be replaced
 * for display; everything around it stays untouched. `anchorOffset` is a
 * best-effort position used to disambiguate identical anchors after edits.
 */
export interface InstructionReference {
  id: string
  ingredientId: string
  /** Exact amount substring inside the instruction text, e.g. "400" or "2-3". */
  anchor: string
  /** Character offset of the anchor in the saved instruction text. */
  anchorOffset: number
  /** Up to 24 characters immediately before the anchor, for safe re-anchoring. */
  anchorBefore?: string
  /** Up to 24 characters immediately after the anchor, for safe re-anchoring. */
  anchorAfter?: string
  quantity: InstructionReferenceQuantity
}

export interface Instruction {
  id: string
  position: number
  /** Original line (markdown preserved). */
  raw: string
  /** Same as raw; renderable markdown. */
  text: string
  /**
   * Explicit ingredient links. Optional for backward compatibility; recipes
   * without references keep working exactly as before.
   */
  references?: InstructionReference[]
}

export interface RecipeImage {
  id: string
  recipeId: string
  position: number
  mimeType: string
  bytes: ArrayBuffer
}

/**
 * Metadata for one image stored in the private Supabase Storage bucket. The
 * bytes never live in PostgreSQL and signed URLs are never persisted.
 *
 * `storagePath` is the object key inside `recipe-images`, normally
 * `${recipeId}/${imageId}`. A replacement upload uses a fresh path so the old
 * object is never overwritten before the metadata transaction succeeds.
 */
export interface RecipeImageMeta {
  id: string
  recipeId: string
  position: number
  mimeType: string
  /** Exact byte length of the stored object. */
  size: number
  storagePath: string
  createdAt: number
  updatedAt: number
}

/** Metadata for a recipe imported from a public web page via JSON-LD. */
export interface RecipeImportMeta {
  source: 'url'
  /** URL the user entered, before redirects. */
  originalUrl: string
  /** Final page URL after redirects; also used as the duplicate source. */
  finalUrl: string
  /** Stable identity of the chosen JSON-LD recipe inside the page. */
  candidateKey: string
  fetchedAt: number
  /** Absolute image URLs that were offered by the page. */
  imageSourceUrls: string[]
  /** Image-specific warnings, e.g. a failed download. */
  imageWarnings: string[]
}

export interface Recipe {
  id: string
  /** Stable Mela id (or a content hash when Mela supplied no id); manual ids are prefixed. */
  importId: string
  importSource: 'mela' | 'manual' | 'url'
  title: string
  description: string
  ingredientGroups: IngredientGroup[]
  ingredients: Ingredient[]
  instructions: Instruction[]
  servingsText: string
  servingsNumber: number | null
  prepTime: string
  cookTime: string
  totalTime: string
  /** Categories exactly as imported (Mela); never rewritten by the editor. */
  categories: string[]
  /** Editable classification: cuisine, dish type, effort and free tags. */
  cuisine: string[]
  dishType: string[]
  effort: string
  tags: string[]
  notes: string
  /** Mela's nutrition field is markdown, not structured data. Keep it verbatim. */
  nutrition: string
  sourceUrl: string
  /** Normalised source URL for URL imports; indexed for duplicate detection. */
  importUrl?: string
  /** Extra metadata for URL imports. Preserved by backup/restore. */
  importMeta?: RecipeImportMeta
  favorite: boolean
  wantToCook: boolean
  /** Mela date: seconds since 2001-01-01 UTC, when present. */
  melaDate: number | null
  /**
   * Complete original JSON object. Image payloads are replaced by markers because
   * the bytes are stored losslessly in the `images` table; keeping the base64
   * strings here would double the storage.
   */
  raw: Record<string, unknown>
  createdAt: number
  updatedAt: number
}

export interface ParsedImage {
  mimeType: string
  bytes: ArrayBuffer
}

/** A parsed Mela recipe, not yet written to the database. */
export interface ParsedMelaRecipe {
  importId: string
  title: string
  description: string
  ingredientGroups: IngredientGroup[]
  ingredients: Ingredient[]
  instructions: Instruction[]
  servingsText: string
  servingsNumber: number | null
  prepTime: string
  cookTime: string
  totalTime: string
  categories: string[]
  notes: string
  nutrition: string
  sourceUrl: string
  favorite: boolean
  wantToCook: boolean
  melaDate: number | null
  images: ParsedImage[]
  warnings: string[]
  raw: Record<string, unknown>
}

export interface ImportIssue {
  file: string
  severity: 'error' | 'warning'
  message: string
}

export interface MelaInspection {
  recipes: ParsedMelaRecipe[]
  issues: ImportIssue[]
}

export interface ImportProgress {
  current: number
  total: number
  title: string
}

export interface ImportFailure {
  title: string
  message: string
}

export interface ImportWarning {
  title: string
  message: string
}

export interface ImportResult {
  imported: number
  duplicates: number
  failed: ImportFailure[]
  warnings: ImportWarning[]
  images: number
}

/** Meal slots offered by the manual calendar (legacy rows may use other values). */
export type MealSlot = 'breakfast' | 'lunch' | 'dinner'

/** A meal appointment is either still planned or has been eaten. */
export type MealEntryStatus = 'planned' | 'eaten'

/** A real cooking event is either planned or has actually happened. */
export type CookSessionStatus = 'planned' | 'cooked'

export type DishKind = 'recipe' | 'free'

/**
 * One meal appointment: a dish on one day in one meal slot.
 *
 * Multiple entries may share the same date+slot. Portions are the portions
 * eaten/planned for this appointment; the prepared quantity lives on the
 * linked `CookSession`, so the same cooking event can feed several days.
 */
export interface MealPlanEntry {
  id: string
  /** Local calendar date, "YYYY-MM-DD". */
  date: string
  /** Meal slot, e.g. "breakfast", "lunch" or "dinner". */
  slot: string
  /** Library recipe; `null` for a free dish. */
  recipeId: string | null
  /** Set only for a free dish stored in the meal plan itself. */
  freeDishId?: string | null
  /** Portions planned or eaten at this appointment. */
  servings?: number
  /** Order inside a slot when several dishes share it. */
  position?: number
  /** Stable reference to the cooking event that provides these portions. */
  cookSessionId?: string | null
  /** Meal status; the legacy `cooked` flag is kept in sync for old data. */
  status?: MealEntryStatus
  /** True when the planner generated it; false when a person picked it. */
  auto: boolean
  /** Locked entries survive a regeneration. */
  pinned: boolean
  /** Portions come from an earlier cooking event instead of a new one. */
  leftover: boolean
  /** Optional "we actually cooked this" confirmation (legacy, kept in sync). */
  cooked: boolean
  reasons: ReasonContribution[]
  createdAt: number
  updatedAt: number
}

/**
 * A cooking event. It owns the actually prepared portions. Meal appointments
 * consume portions from it, possibly on several days and across week/year
 * boundaries. Remaining portions are derived, never stored twice.
 */
export interface CookSession {
  id: string
  /** Library recipe; `null` for a free dish. */
  recipeId: string | null
  /** Set only when this cooking event belongs to a free dish. */
  freeDishId?: string | null
  /** Local date on which cooking is planned / happened, "YYYY-MM-DD". */
  date: string
  /** Portions actually to prepare (the scaling target). */
  servings: number
  status: CookSessionStatus
  /** True when the automatic planner created it; manual sessions are protected. */
  auto: boolean
  createdAt: number
  updatedAt: number
}

/**
 * A dish that exists only in the meal plan. Its name, ingredient reference
 * quantities and original portion count live here, not in the recipe library.
 * Every linked `MealPlanEntry` points to the common `CookSession`; the
 * ingredients are stored exactly once.
 */
export interface FreeDish {
  id: string
  name: string
  /** Portions the stored ingredient quantities refer to. Never auto-rewritten. */
  referenceServings: number
  /** Stored reference quantities; scaling happens only for display/demand. */
  ingredients: Ingredient[]
  createdAt: number
  updatedAt: number
}

/** Per-day flag; the row id is the date itself. */
export interface MealDay {
  date: string
  /** Day deliberately left free: it is not planned and not shopped for. */
  skipped: boolean
  createdAt: number
  updatedAt: number
}

/**
 * Free text note for one calendar day. The date is the primary key; notes are
 * never recipes, meals or cooking events and never consume portions.
 */
export interface DayNote {
  date: string
  text: string
  createdAt: number
  updatedAt: number
}

/** Last opened step of one planned cooking event, stored locally only. */
export interface CookProgress {
  cookSessionId: string
  stepIndex: number
  updatedAt: number
}

export interface SettingRecord {
  key: string
  value: string | number | boolean
}

/**
 * One independent shopping list. A `standard` list always represents exactly
 * one persisted shopping period and has a deterministic id derived
 * from that period. A `free` list has no mandatory period and can be renamed
 * or deleted at any time.
 */
export type ShoppingListKind = 'standard' | 'free'

export interface ShoppingList {
  id: string
  kind: ShoppingListKind
  name: string
  /** First day of the persisted shopping period; `null` for free lists. */
  periodStart: string | null
  /** Last day of the persisted shopping period; `null` for free lists. */
  periodEnd: string | null
  /**
   * Legacy marker from the removed transition-period handling. It is kept only
   * so older rows survive a backup roundtrip unchanged; period resolution no
   * longer interprets it.
   */
  isTransition?: boolean
  createdAt: number
  updatedAt: number
}

/**
 * How an automatically calculated demand position is distributed to a list.
 *
 * - `partial`: a fixed amount the user assigned to this list. The remainder
 *   stays on the standard list and grows/shrinks with the current demand.
 * - `full`: the complete position (including future demand changes) belongs to
 *   this list. A `dimension` of `"*"` means every dimension of the item.
 */
export type ShoppingAllocationMode = 'partial' | 'full'

/**
 * A persisted user decision that moves part or all of an automatically
 * calculated demand position to one shopping list. The demand itself is never
 * stored here; it is always recomputed from the planned cooking events.
 */
export interface ShoppingDemandAllocation {
  /** Deterministic: `${periodStart}|${itemKey}|${dimension}|${listId}`. */
  id: string
  /** First day of the persisted shopping period, "YYYY-MM-DD". */
  periodStart: string
  /** Canonical product identity from the existing shopping rules. */
  itemKey: string
  /** "mass", "volume", "count", "unit:<label>" or "*" for the whole item. */
  dimension: string
  listId: string
  mode: ShoppingAllocationMode
  /**
   * Exact amount in thousandths of the dimension's base unit. Only present for
   * `partial` allocations; integer storage keeps every split lossless.
   */
  quantityMilli?: number
  createdAt: number
  updatedAt: number
}

/**
 * A manually added shopping article. It belongs to exactly one shopping list
 * and is never derived from a recipe. Its numeric/text quantity is stored as
 * entered; aggregation with recipe demand happens only for display.
 */
export interface ShoppingManualItem {
  id: string
  /**
   * Legacy shopping-week start from v10. Kept so old rows/backups remain
   * readable; new rows also store the actual `shoppingDate` below.
   */
  weekStart?: string
  /**
   * Actual date the article belongs to. The visible shopping week is derived
   * from this date with the currently configured week start.
   */
  shoppingDate?: string
  /**
   * Owning shopping list. Missing on legacy rows; readers resolve such rows to
   * the standard list of the persisted period containing the date.
   */
  listId?: string
  /**
   * Historical week grouping could not be reconstructed unambiguously. The row
   * is preserved verbatim and is surfaced as a review conflict, never silently
   * re-assigned to another shopping period.
   */
  legacyWeekAmbiguous?: boolean
  name: string
  quantityText: string | null
  unit: string | null
  purchaseNote: string
  /** Optional category the user picked; null means "guess from the name". */
  categoryId: string | null
  createdAt: number
  updatedAt: number
}

/**
 * Quantities already bought for one shopping week. Amounts are stored in the
 * base unit of their dimension (g, ml, pieces) so they stay comparable when
 * the recipe demand changes later. Ranges keep both bounds.
 */
export interface ShoppingPurchasedAmount {
  dimension: string
  lower: number
  upper: number
}

/**
 * Legacy v10 aggregate check. It is only read during migration/backup import
 * and converted into one historical `ShoppingPurchase`.
 */
export interface ShoppingCheck {
  /** `${weekStart}|${itemKey}`; one row per week and product. */
  id: string
  weekStart: string
  itemKey: string
  checked: boolean
  purchased: ShoppingPurchasedAmount[]
  /** Optional actual date; falls back to weekStart for v10 data. */
  shoppingDate?: string
  updatedAt: number
}

/**
 * One confirmed purchase action. `amounts` are the quantities the user
 * explicitly bought in this action (lower=upper for confirmed numbers; a
 * migrated legacy range keeps both bounds). `snapshot` stores the required
 * demand at confirmation time so a confirmed amount inside a range can settle
 * that demand without inventing the upper bound.
 */
export interface ShoppingPurchase {
  id: string
  /** Actual date; the shopping week is derived from it. */
  shoppingDate: string
  itemKey: string
  /**
   * Shopping list the purchase belongs to. Missing on legacy rows; readers
   * resolve those to the standard list of their shopping period.
   */
  listId?: string
  /**
   * Set when this purchase belongs to one explicit manual article. Such a row
   * is never counted again as automatic recipe demand.
   */
  manualItemId?: string
  /** See `ShoppingManualItem.legacyWeekAmbiguous`. */
  legacyWeekAmbiguous?: boolean
  /**
   * Where this row came from. Rows written by the current application carry
   * `recorded`; older rows without a value keep an unknown historical origin
   * and are never silently treated as certain.
   */
  provenance?: 'recorded' | 'legacy'
  amounts: ShoppingPurchasedAmount[]
  /** Cumulative purchased totals for this week after this action. */
  confirmedTotal?: ShoppingPurchasedAmount[]
  snapshot: ShoppingPurchasedAmount[]
  /** True when the article was marked done without any numeric amount. */
  qualitative: boolean
  createdAt: number
  updatedAt: number
}

/** Learned display/category/hint corrections for one product identity. */
export interface ShoppingItemRule {
  key: string
  /** Product this identity belongs to. `key` when the identity is not merged. */
  canonicalKey?: string
  displayName: string
  categoryId: string | null
  /** Additional hint; with `purchaseNoteOverride` it replaces recipe hints. */
  purchaseNote: string
  /** Hide recipe hints completely? */
  purchaseNoteOverride?: boolean
  /** Recipe hints the user explicitly hid. */
  hiddenPurchaseNotes?: string[]
  /**
   * Legacy product-wide quantity correction from v7/v8. It is preserved for
   * transparency but never applied automatically. The user can adopt it for
   * the current week or discard it in the edit dialog.
   */
  legacyQuantityText?: string
  /** Unit belonging to `legacyQuantityText`. */
  legacyUnit?: string
  /** True when the old identity mapping could not be resolved automatically. */
  legacyAmbiguous?: boolean
  updatedAt: number
}

/**
 * A quantity correction that is valid for exactly one shopping week and one
 * amount dimension. `sourceSignature` describes the original calculated
 * position at correction time. If the underlying demand changes, the
 * correction becomes reviewable instead of silently overriding new demand.
 */
export interface ShoppingQuantityCorrection {
  id: string
  /** Stable date inside the shopping week; the week is derived from it. */
  shoppingDate: string
  itemKey: string
  /** "mass", "volume", "count" or "unit:<label>". */
  dimension: string
  quantityText: string
  unit: string | null
  /** Signature of the uncorrected calculated position at correction time. */
  sourceSignature: string
  createdAt: number
  updatedAt: number
}

export const DEFAULT_HOUSEHOLD_SIZE = 2
