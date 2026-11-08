/*
 * openCook Web
 * Copyright (C) 2026 openCook Web contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Pure recipe-editor mapping and filtering. The editor keeps a recipe's
 * `importId`, `importSource`, `raw` and imported `categories` untouched, so a
 * Mela recipe remains a Mela recipe and a later import cannot silently replace
 * it.
 */

import { randomId } from '../lib/id'
import { normalizeReferenceAnchors } from './references'
import type {
  Ingredient,
  IngredientGroup,
  Instruction,
  InstructionReference,
  Recipe,
  RecipeImportMeta,
} from '../types'

export interface DraftIngredient {
  key: string
  id?: string
  group: string
  quantity: string
  unit: string
  name: string
  purchaseNote: string
  preparationNote: string
}

export interface DraftStep {
  key: string
  id?: string
  text: string
  references: InstructionReference[]
}

export interface RecipeDraft {
  title: string
  description: string
  sourceUrl: string
  notes: string
  servingsText: string
  prepTime: string
  cookTime: string
  totalTime: string
  cuisine: string[]
  dishType: string[]
  effort: string
  tags: string[]
  favorite: boolean
  wantToCook: boolean
  ingredients: DraftIngredient[]
  steps: DraftStep[]
}

export const EFFORT_OPTIONS = ['einfach', 'mittel', 'aufwendig'] as const

export function emptyDraft(): RecipeDraft {
  return {
    title: '',
    description: '',
    sourceUrl: '',
    notes: '',
    servingsText: '',
    prepTime: '',
    cookTime: '',
    totalTime: '',
    cuisine: [],
    dishType: [],
    effort: '',
    tags: [],
    favorite: false,
    wantToCook: false,
    ingredients: [
      (() => {
        const id = randomId()
        return {
          key: id,
          id,
          group: '',
          quantity: '',
          unit: '',
          name: '',
          purchaseNote: '',
          preparationNote: '',
        }
      })(),
    ],
    steps: [{ key: randomId(), text: '', references: [] }],
  }
}

export interface DraftParts {
  title: string
  description: string
  sourceUrl: string
  notes: string
  servingsText: string
  prepTime: string
  cookTime: string
  totalTime: string
  cuisine: string[]
  dishType: string[]
  effort: string
  tags: string[]
  favorite: boolean
  wantToCook: boolean
  ingredientGroups: IngredientGroup[]
  ingredients: Ingredient[]
  instructions: Instruction[]
}

/** Map a recipe-like source to the editable draft. Shared by editor and URL import. */
export function draftFromParts(parts: DraftParts): RecipeDraft {
  const groupTitle = new Map(parts.ingredientGroups.map((group) => [group.id, group.title]))
  return {
    title: parts.title,
    description: parts.description,
    sourceUrl: parts.sourceUrl,
    notes: parts.notes,
    servingsText: parts.servingsText,
    prepTime: parts.prepTime,
    cookTime: parts.cookTime,
    totalTime: parts.totalTime,
    cuisine: [...parts.cuisine],
    dishType: [...parts.dishType],
    effort: parts.effort,
    tags: [...parts.tags],
    favorite: parts.favorite,
    wantToCook: parts.wantToCook,
    ingredients: parts.ingredients
      .slice()
      .sort((a, b) => a.position - b.position)
      .map((ingredient) => ({
        key: ingredient.id,
        id: ingredient.id,
        group: ingredient.groupId ? (groupTitle.get(ingredient.groupId) ?? '') : '',
        quantity:
          ingredient.quantityText ??
          (ingredient.quantity !== null ? String(ingredient.quantity) : ''),
        unit: ingredient.unit ?? '',
        name: ingredient.name,
        purchaseNote: ingredient.purchaseNote ?? '',
        preparationNote: ingredient.preparationNote ?? '',
      })),
    steps: parts.instructions
      .slice()
      .sort((a, b) => a.position - b.position)
      .map((step) => ({
        key: step.id,
        id: step.id,
        text: step.text,
        references: normalizeReferenceAnchors(step.text, step.references ?? []),
      })),
  }
}

export function draftFromRecipe(recipe: Recipe): RecipeDraft {
  return draftFromParts(recipe)
}

export function parseQuantityInput(value: string): number | null {
  let text = value.trim().replace(/\s+/g, ' ')
  if (!text) return null
  const unicode: Record<string, number> = {
    '½': 0.5, '¼': 0.25, '¾': 0.75, '⅓': 1 / 3, '⅔': 2 / 3,
    '⅛': 0.125, '⅜': 0.375, '⅝': 0.625, '⅞': 0.875,
  }
  const first = text.charAt(0)
  if (unicode[first] !== undefined) return unicode[first] ?? null
  if (text.includes('/')) {
    if (text.includes(' ')) {
      const [whole, fraction] = text.split(' ', 2)
      const wholeValue = Number.parseFloat((whole ?? '').replace(',', '.'))
      const fractionValue = parseFraction(fraction ?? '')
      if (!Number.isFinite(wholeValue) || fractionValue === null) return null
      return wholeValue + fractionValue
    }
    return parseFraction(text)
  }
  if (text.includes('-') || text.includes('–')) text = text.split(/[-–]/)[0] ?? ''
  const valueNumber = Number.parseFloat(text.replace(',', '.'))
  return Number.isFinite(valueNumber) ? valueNumber : null
}

function parseFraction(value: string): number | null {
  const [numerator, denominator] = value.split('/')
  const n = Number.parseFloat(numerator ?? '')
  const d = Number.parseFloat(denominator ?? '')
  if (!Number.isFinite(n) || !Number.isFinite(d) || d === 0) return null
  return n / d
}

function leadingInt(value: string): number | null {
  const match = /^\s*(\d{1,3})/.exec(value)
  return match?.[1] ? Number.parseInt(match[1], 10) : null
}

/**
 * Convert editable steps to stored instructions. Text and ids survive, empty
 * steps are ignored and references are re-anchored against the final text.
 * Shared by the normal editor and the live preview.
 */
export function buildInstructionList(steps: readonly DraftStep[]): Instruction[] {
  return steps
    .map((draftStep, index) => ({ draftStep, text: draftStep.text.trim(), index }))
    .filter(({ text }) => text.length > 0)
    .map(({ draftStep, text }, index) => ({
      id: draftStep.id ?? randomId(),
      position: index,
      raw: text,
      text,
      references: normalizeReferenceAnchors(text, draftStep.references ?? []),
    }))
}

export interface RecipeBuildOptions {
  importSource?: Recipe['importSource']
  importId?: string
  importUrl?: string
  importMeta?: RecipeImportMeta
  raw?: Record<string, unknown>
  categories?: string[]
}

/**
 * Editable ingredient input shared by the recipe editor and the free-dish
 * dialog. Empty names are ignored; quantities are parsed with the same
 * conservative parser as imports and the editor.
 */
export interface IngredientDraftInput {
  id?: string
  /** Editor-only row key used as id fallback for newly created rows. */
  key?: string
  /** Optional group title; free dishes do not use groups. */
  group?: string
  quantity: string
  unit: string
  name: string
  purchaseNote?: string
  preparationNote?: string
}

/**
 * The single conversion from editable ingredient rows to stored ingredients.
 * Free dishes reuse it so their quantities, notes and parse status follow
 * exactly the same rules as library recipes.
 */
export function buildIngredientList(
  drafts: readonly IngredientDraftInput[],
  existing: readonly Ingredient[] = [],
  groupIdFor: (title: string) => string | null = () => null,
): Ingredient[] {
  const oldIngredients = new Map(existing.map((ingredient) => [ingredient.id, ingredient]))
  return drafts
    .map((draftIngredient, index): Ingredient | null => {
      const name = draftIngredient.name.trim()
      if (!name) return null
      const quantity = parseQuantityInput(draftIngredient.quantity)
      const unit = draftIngredient.unit.trim()
      const previous = draftIngredient.id ? oldIngredients.get(draftIngredient.id) : undefined
      const quantityText = draftIngredient.quantity.trim()
      // Keep the imported original line when only notes (or nothing) changed.
      const structuredUnchanged =
        previous !== undefined &&
        previous.name === name &&
        (previous.quantityText ?? '') === quantityText &&
        (previous.unit ?? '') === unit
      const raw = structuredUnchanged
        ? previous.raw
        : [quantityText, unit, name].filter(Boolean).join(' ')
      return {
        id: draftIngredient.id ?? draftIngredient.key ?? randomId(),
        groupId: groupIdFor(draftIngredient.group ?? ''),
        position: index,
        raw,
        name,
        quantity,
        quantityText: quantityText || null,
        unit: unit || null,
        purchaseNote: (draftIngredient.purchaseNote ?? '').trim(),
        preparationNote: (draftIngredient.preparationNote ?? '').trim(),
        parseStatus: quantity !== null ? 'parsed' : 'plain',
        links: previous?.links ?? [],
      }
    })
    .filter((ingredient): ingredient is Ingredient => ingredient !== null)
}

/**
 * Build a complete recipe from the editor draft. Existing imported data
 * (`importId`, `importSource`, `importUrl`, `importMeta`, `raw`, `categories`,
 * `nutrition`, `melaDate`, `createdAt`) is preserved; only editable fields are
 * replaced. Options are used only for new URL imports, never to overwrite an
 * existing recipe.
 */
export function buildRecipeFromDraft(
  draft: RecipeDraft,
  existing?: Recipe,
  options?: RecipeBuildOptions,
): Recipe {
  const now = Date.now()
  const id = existing?.id ?? randomId()
  const groups: IngredientGroup[] = []
  const groupIds = new Map<string, string>()
  const groupIdFor = (title: string): string | null => {
    const trimmed = title.trim()
    if (!trimmed) return null
    const key = trimmed.toLocaleLowerCase('de')
    let groupId = groupIds.get(key)
    if (!groupId) {
      groupId = `group-${groups.length + 1}`
      groupIds.set(key, groupId)
      groups.push({
        id: groupId,
        title: trimmed,
        position: groups.length,
        rawHeading: `# ${trimmed}`,
      })
    }
    return groupId
  }

  const ingredients = buildIngredientList(
    draft.ingredients,
    existing?.ingredients ?? [],
    groupIdFor,
  )

  const instructions = buildInstructionList(draft.steps)

  return {
    id,
    importId: existing?.importId ?? options?.importId ?? `manual-${id}`,
    importSource: existing?.importSource ?? options?.importSource ?? 'manual',
    title: draft.title.trim(),
    description: draft.description.trim(),
    ingredientGroups: groups,
    ingredients,
    instructions,
    servingsText: draft.servingsText.trim(),
    servingsNumber: leadingInt(draft.servingsText),
    prepTime: draft.prepTime.trim(),
    cookTime: draft.cookTime.trim(),
    totalTime: (draft.totalTime ?? existing?.totalTime ?? '').trim(),
    categories: existing?.categories ?? options?.categories ?? [],
    cuisine: draft.cuisine,
    dishType: draft.dishType,
    effort: draft.effort,
    tags: draft.tags,
    notes: draft.notes.trim(),
    nutrition: existing?.nutrition ?? '',
    sourceUrl: draft.sourceUrl.trim(),
    importUrl: existing?.importUrl ?? options?.importUrl ?? '',
    importMeta: existing?.importMeta ?? options?.importMeta,
    favorite: draft.favorite,
    wantToCook: draft.wantToCook,
    melaDate: existing?.melaDate ?? null,
    raw: existing?.raw ?? options?.raw ?? { source: 'manual' },
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  }
}

export interface RecipeFilters {
  search?: string
  category?: string
  cuisine?: string
  dishType?: string
  effort?: string
  tag?: string
}

export function matchesRecipeFilters(recipe: Recipe, filters: RecipeFilters): boolean {
  if (filters.category && !recipe.categories.includes(filters.category)) return false
  if (filters.cuisine && !recipe.cuisine.includes(filters.cuisine)) return false
  if (filters.dishType && !recipe.dishType.includes(filters.dishType)) return false
  if (filters.effort && recipe.effort !== filters.effort) return false
  if (filters.tag && !recipe.tags.includes(filters.tag)) return false
  const needle = filters.search?.trim().toLocaleLowerCase('de')
  if (!needle) return true
  return (
    recipe.title.toLocaleLowerCase('de').includes(needle) ||
    recipe.description.toLocaleLowerCase('de').includes(needle) ||
    recipe.tags.some((tag) => tag.toLocaleLowerCase('de').includes(needle)) ||
    recipe.ingredients.some(
      (ingredient) =>
        ingredient.name.toLocaleLowerCase('de').includes(needle) ||
        ingredient.raw.toLocaleLowerCase('de').includes(needle) ||
        (ingredient.purchaseNote ?? '').toLocaleLowerCase('de').includes(needle) ||
        (ingredient.preparationNote ?? '').toLocaleLowerCase('de').includes(needle),
    )
  )
}

export type FilterKey = 'cuisine' | 'dishType' | 'effort' | 'tag'

export function filterValues(recipes: Recipe[], key: FilterKey): string[] {
  const values = new Set<string>()
  for (const recipe of recipes) {
    if (key === 'effort') {
      if (recipe.effort) values.add(recipe.effort)
    } else if (key === 'cuisine') {
      for (const value of recipe.cuisine) values.add(value)
    } else if (key === 'dishType') {
      for (const value of recipe.dishType) values.add(value)
    } else {
      for (const value of recipe.tags) values.add(value)
    }
  }
  return Array.from(values).sort((a, b) => a.localeCompare(b, 'de'))
}
