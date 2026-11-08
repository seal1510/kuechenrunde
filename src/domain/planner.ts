/*
 * openCook Web
 * Copyright (C) 2026 openCook Web contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Pure TypeScript port of openCook's MealPlanner (GPLv3). The scoring weights,
 * reason codes, hard cool-down and leftover rule mirror the Kotlin implementation;
 * the PRNG is a seeded Mulberry32 instead of kotlin.random.Random, so exact
 * random sequences differ while the behaviour is the same.
 *
 * Mela does not deliver meal-type suitability or a protein field; categories
 * and ingredients are used as imported. The discontinued pantry feature has
 * no influence on planning or shopping demand.
 */

import { addDays, dayNumber, daysBetween, isWeekend } from './dates'
import { durationMinutes } from '../lib/duration'

export { durationMinutes }

export interface PlannerRecipe {
  id: string
  name: string
  categories: string[]
  servings: number | null
  totalTime: string
  prepTime: string
  cookTime: string
  ingredients: string[]
  favorite: boolean
}

export type ReasonCode =
  | 'WEEK_REUSE'
  | 'LIKED'
  | 'QUICK_WEEKDAY'
  | 'BIG_BATCH_LEFTOVER'
  | 'NEW_INGREDIENTS_NEEDED'
  | 'RECENTLY_PLANNED'
  | 'RECENTLY_COOKED'
  | 'SAME_CATEGORY_NEIGHBOUR'
  | 'MONOTONY'
  | 'SAME_PROTEIN'

export interface ReasonContribution {
  code: ReasonCode
  weight: number
  detail?: string
}

export interface PickedRecipe {
  recipeId: string
  score: number
  reasons: ReasonContribution[]
  leftover: boolean
}

export interface PlannerWeights {
  recencyPenalty: number
  recencyWindowDays: number
  sameCategoryPenalty: number
  newItemPenalty: number
  weekReuseBonus: number
  monotonyPenalty: number
  maxReuseCount: number
  timeFitBonus: number
  jitter: number
  likedBonus: number
  cookedRecentlyPenalty: number
  cookedWindowDays: number
  sameProteinPenalty: number
  proteinRecencyWindowDays: number
}

export const DEFAULT_WEIGHTS: PlannerWeights = {
  recencyPenalty: 6.0,
  recencyWindowDays: 21,
  sameCategoryPenalty: 3.0,
  newItemPenalty: 1.2,
  weekReuseBonus: 1.5,
  monotonyPenalty: 2.0,
  maxReuseCount: 1,
  timeFitBonus: 1.5,
  jitter: 0.6,
  likedBonus: 2.0,
  cookedRecentlyPenalty: 4.0,
  cookedWindowDays: 10,
  sameProteinPenalty: 4.0,
  proteinRecencyWindowDays: 3,
}

export function weightsForSlot(slot: string): PlannerWeights {
  if (slot === 'breakfast' || slot === 'snack') {
    return {
      ...DEFAULT_WEIGHTS,
      recencyPenalty: 1.5,
      recencyWindowDays: 5,
      sameCategoryPenalty: 0,
      monotonyPenalty: 0.5,
      maxReuseCount: 4,
      cookedRecentlyPenalty: 1.0,
      sameProteinPenalty: 0,
    }
  }
  return DEFAULT_WEIGHTS
}

export interface GenerateWeekArgs {
  dates: string[]
  skipped?: ReadonlySet<string>
  pinned?: Readonly<Record<string, string>>
  candidates: PlannerRecipe[]
  recentlyPlanned?: Readonly<Record<string, string>>
  householdSize: number
  today: string
  seed: number
  liked?: ReadonlySet<string>
  lastCookedAt?: Readonly<Record<string, string>>
  weights?: PlannerWeights
  minRepeatGapDays?: number
}

export interface GenerateWeekBestArgs extends GenerateWeekArgs {
  restarts?: number
}

/** Leftovers only move to a free day at most this many days later. */
const LEFTOVER_MAX_GAP_DAYS = 2

const MAX_MINUTES = 90

const STAPLE_WORDS = [
  'salz', 'salz und pfeffer', 'pfeffer', 'schwarzer pfeffer', 'weißer pfeffer',
  'öl', 'olivenöl', 'rapsöl', 'sonnenblumenöl', 'pflanzenöl',
  'butter', 'wasser', 'essig', 'zucker', 'mehl',
  'brühe', 'gemüsebrühe', 'fleischbrühe', 'hühnerbrühe', 'brühwürfel',
  'senf', 'tomatenmark', 'sojasoße', 'sojasauce',
  'paprikapulver', 'muskat', 'muskatnuss', 'honig',
  'backpulver', 'vanillezucker', 'trockenhefe',
]

const STAPLE_SET = new Set(STAPLE_WORDS.map(normalizeIngredient))

const PROTEIN_GROUPS: Array<[string, string[]]> = [
  ['geflügel', ['hähnchen', 'haehnchen', 'hühn', 'huhn', 'pute', 'geflügel', 'chicken', 'turkey', 'poultry']],
  ['fisch', ['fisch', 'lachs', 'thunfisch', 'forelle', 'kabeljau', 'seelachs', 'scholle', 'hering', 'garnele', 'scampi', 'shrimp', 'prawn', 'salmon', 'tuna', 'trout']],
  ['hackfleisch', ['hackfleisch', 'hack', 'mince']],
  ['schwein', ['schwein', 'kasseler', 'schnitzel', 'schinken', 'speck', 'pork', 'bacon']],
  ['rind', ['rinder', 'rindfleisch', 'steak', 'beef']],
  ['lamm', ['lamm', 'lamb']],
  ['tofu', ['tofu', 'tempeh', 'seitan']],
]

const DIET_KEYS = new Set(['vegetarian', 'vegetarisch', 'vegan'])
const GENERIC_CATEGORIES = new Set(['other', 'sonstiges', 'misc', 'hauptgericht', 'main'])

export function normalizeIngredient(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/\([^)]*\)/g, '')
    .replace(/soße/g, 'sauce')
    .replace(/ß/g, 'ss')
    .replace(/\s+/g, ' ')
    .trim()
}

function pluralMatches(a: string, b: string): boolean {
  if (!a || !b) return false
  if (a === b) return true
  for (const suffix of ['en', 'n', 'e', 's']) {
    if (a.endsWith(suffix) && a.length - suffix.length >= 3 && a.slice(0, -suffix.length) === b) {
      return true
    }
    if (b.endsWith(suffix) && b.length - suffix.length >= 3 && b.slice(0, -suffix.length) === a) {
      return true
    }
  }
  return false
}

/** Plural- and staple-compound-aware comparison of two ingredient names. */
export function ingredientMatches(a: string, b: string): boolean {
  const x = normalizeIngredient(a)
  const y = normalizeIngredient(b)
  if (!x || !y) return false
  if (x === y || pluralMatches(x, y)) return true
  // A staple head generalises ("Weizenmehl" → "Mehl"), but a non-staple one does not
  // ("Kichererbsen" must not become "Erbsen").
  if (x.length - y.length >= 3 && x.endsWith(y) && STAPLE_SET.has(y)) return true
  if (y.length - x.length >= 3 && y.endsWith(x) && STAPLE_SET.has(x)) return true
  return false
}

export function isStaple(name: string): boolean {
  const normalized = normalizeIngredient(name)
  if (STAPLE_SET.has(normalized)) return true
  for (const staple of STAPLE_SET) {
    if (normalized.length - staple.length >= 3 && normalized.endsWith(staple)) return true
  }
  return false
}

export function containsLike(set: ReadonlySet<string>, name: string): boolean {
  for (const entry of set) {
    if (ingredientMatches(entry, name)) return true
  }
  return false
}

export function proteinGroup(text: string): string | null {
  const normalized = normalizeIngredient(text).replace(/ß/g, 'ss')
  for (const [group, keywords] of PROTEIN_GROUPS) {
    if (keywords.some((keyword) => normalized.includes(keyword))) return group
  }
  return null
}

/**
 * Shared normalisation with the recipe display; see `lib/duration.ts`.
 * The planner uses the upper bound of a range for its weekday time fit.
 */

export function varietyKeys(categories: string[]): Set<string> {
  const keys = Array.from(
    new Set(
      categories
        .map((category) => category.toLowerCase().trim())
        .filter((category) => category && !GENERIC_CATEGORIES.has(category)),
    ),
  )
  // A diet key is a planner signal, not a dish kind. Two vegetarian dishes are still
  // a repeat, but a vegetarian soup next to vegetarian pasta is variety.
  return new Set(keys.length > 1 ? keys.filter((key) => !DIET_KEYS.has(key)) : keys)
}

function mainProtein(recipe: PlannerRecipe): string | null {
  return proteinGroup(recipe.name) ?? recipe.ingredients.map(proteinGroup).find((group) => group) ?? null
}

function effectiveMinutes(recipe: PlannerRecipe): number | null {
  const total = durationMinutes(recipe.totalTime)
  if (total !== null) return total
  const prep = durationMinutes(recipe.prepTime)
  const cook = durationMinutes(recipe.cookTime)
  if (prep === null && cook === null) return null
  return (prep ?? 0) + (cook ?? 0)
}

function coreIngredients(recipe: PlannerRecipe): Set<string> {
  return new Set(
    recipe.ingredients
      .map(normalizeIngredient)
      .filter((name) => name && !isStaple(name)),
  )
}

function countLike(counts: Readonly<Record<string, number>>, name: string): number {
  let total = 0
  for (const [key, count] of Object.entries(counts)) {
    if (ingredientMatches(key, name)) total += count
  }
  return total
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let value = Math.imul(state ^ (state >>> 15), 1 | state)
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value)
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296
  }
}

function seededRandom(seed: number, date: string): () => number {
  return mulberry32((seed ^ (dayNumber(date) * 1_000_003)) >>> 0)
}

function addCount(counts: Record<string, number>, key: string): void {
  counts[key] = (counts[key] ?? 0) + 1
}

export function generateWeek(args: GenerateWeekArgs): Record<string, PickedRecipe> {
  const {
    dates,
    candidates,
    householdSize,
    seed,
  } = args
  const skipped = args.skipped ?? new Set<string>()
  const pinned = args.pinned ?? {}
  const recentlyPlanned = args.recentlyPlanned ?? {}
  const lastCookedAt = args.lastCookedAt ?? {}
  const liked = args.liked ?? new Set<string>()
  const weights = args.weights ?? DEFAULT_WEIGHTS
  const minRepeatGapDays = args.minRepeatGapDays ?? 0

  const result: Record<string, PickedRecipe> = {}
  if (candidates.length === 0) {
    for (const [date, recipeId] of Object.entries(pinned)) {
      result[date] = { recipeId, score: 0, reasons: [], leftover: false }
    }
    return result
  }

  const byId = new Map(candidates.map((recipe) => [recipe.id, recipe]))
  const core: Record<string, Set<string>> = {}
  const proteinOf: Record<string, string | null> = {}
  for (const recipe of candidates) {
    core[recipe.id] = coreIngredients(recipe)
    proteinOf[recipe.id] = mainProtein(recipe)
  }

  const recentProteins: Record<string, string> = {}
  for (const [recipeId, date] of Object.entries(recentlyPlanned)) {
    const protein = proteinOf[recipeId]
    if (!protein) continue
    if (!recentProteins[protein] || daysBetween(recentProteins[protein]!, date) < 0) {
      recentProteins[protein] = date
    }
  }

  for (const [date, recipeId] of Object.entries(pinned)) {
    if (byId.has(recipeId)) {
      result[date] = { recipeId, score: 0, reasons: [], leftover: false }
    }
  }

  const used = new Set(Object.values(result).map((pick) => pick.recipeId))

  for (const date of dates) {
    if (skipped.has(date) || date in result) continue

    let pool = candidates.filter((recipe) => !used.has(recipe.id))

    if (minRepeatGapDays > 0) {
      pool = pool.filter((recipe) => {
        const last = [recentlyPlanned[recipe.id], lastCookedAt[recipe.id]]
          .filter((value): value is string => Boolean(value))
          .sort()
          .at(-1)
        return !last || daysBetween(last, date) >= minRepeatGapDays
      })
      if (pool.length === 0) continue
    } else if (pool.length === 0) {
      const yesterday = result[addDays(date, -1)]?.recipeId
      used.clear()
      if (yesterday) used.add(yesterday)
      pool = candidates.filter((recipe) => !used.has(recipe.id))
      if (pool.length === 0) pool = candidates
    }

    const rng = seededRandom(seed, date)
    const placed: Record<string, string> = {}
    for (const [placedDate, pick] of Object.entries(result)) placed[placedDate] = pick.recipeId

    const weekCoreCounts: Record<string, number> = {}
    for (const recipeId of Object.values(placed)) {
      for (const ingredient of core[recipeId] ?? []) addCount(weekCoreCounts, ingredient)
    }
    const weekProteinCounts: Record<string, number> = {}
    for (const recipeId of Object.values(placed)) {
      const protein = proteinOf[recipeId]
      if (protein) addCount(weekProteinCounts, protein)
    }

    let best: { recipe: PlannerRecipe; score: number; reasons: ReasonContribution[] } | null = null
    for (const recipe of pool) {
      const scored = scoreRecipe(
        recipe,
        date,
        placed,
        byId,
        recentlyPlanned,
        core,
        weekCoreCounts,
        proteinOf,
        weekProteinCounts,
        recentProteins,
        liked,
        lastCookedAt,
        weights,
        rng,
      )
      if (!best || scored.score > best.score) {
        best = { recipe, ...scored }
      }
    }
    if (!best) continue

    result[date] = {
      recipeId: best.recipe.id,
      score: best.score,
      reasons: best.reasons,
      leftover: false,
    }
    used.add(best.recipe.id)

    // Big batch → eat it again as leftovers, but only on a nearby free day.
    const servings = best.recipe.servings
    if (servings !== null && servings >= householdSize * 2) {
      const leftoverDay = dates.find(
        (candidate) =>
          daysBetween(date, candidate) > 0 &&
          daysBetween(date, candidate) <= LEFTOVER_MAX_GAP_DAYS &&
          !skipped.has(candidate) &&
          !(candidate in pinned) &&
          !(candidate in result),
      )
      if (leftoverDay) {
        result[leftoverDay] = {
          recipeId: best.recipe.id,
          score: best.score,
          reasons: [{ code: 'BIG_BATCH_LEFTOVER', weight: 0 }],
          leftover: true,
        }
      }
    }
  }

  return result
}

export function generateWeekBest(args: GenerateWeekBestArgs): Record<string, PickedRecipe> {
  const restarts = args.restarts ?? 4
  const weights = args.weights ?? DEFAULT_WEIGHTS
  const core: Record<string, Set<string>> = {}
  for (const recipe of args.candidates) core[recipe.id] = coreIngredients(recipe)

  let bestPlan: Record<string, PickedRecipe> | null = null
  let bestAggregate = Number.NEGATIVE_INFINITY

  for (let index = 0; index < Math.max(1, restarts); index += 1) {
    const plan = generateWeek({ ...args, seed: args.seed + index })
    const scoreSum = Object.values(plan).reduce((sum, pick) => sum + pick.score, 0)
    const needs = new Set<string>()
    for (const pick of Object.values(plan)) {
      for (const ingredient of core[pick.recipeId] ?? []) needs.add(ingredient)
    }
    const aggregate = scoreSum - needs.size * weights.newItemPenalty * 0.5
    if (aggregate > bestAggregate) {
      bestAggregate = aggregate
      bestPlan = plan
    }
  }

  return bestPlan ?? {}
}

function scoreRecipe(
  recipe: PlannerRecipe,
  date: string,
  placed: Readonly<Record<string, string>>,
  byId: ReadonlyMap<string, PlannerRecipe>,
  recentlyPlanned: Readonly<Record<string, string>>,
  core: Readonly<Record<string, Set<string>>>,
  weekCoreCounts: Readonly<Record<string, number>>,
  proteinOf: Readonly<Record<string, string | null>>,
  weekProteinCounts: Readonly<Record<string, number>>,
  recentProteins: Readonly<Record<string, string>>,
  liked: ReadonlySet<string>,
  lastCookedAt: Readonly<Record<string, string>>,
  weights: PlannerWeights,
  rng: () => number,
): { score: number; reasons: ReasonContribution[] } {
  let score = 0
  const reasons: ReasonContribution[] = []
  const categories = varietyKeys(recipe.categories)
  const coreForRecipe = core[recipe.id] ?? new Set<string>()

  const plannedDate = recentlyPlanned[recipe.id]
  if (plannedDate) {
    const days = Math.max(0, daysBetween(plannedDate, date))
    if (days < weights.recencyWindowDays) {
      const penalty = -weights.recencyPenalty * (1 - days / weights.recencyWindowDays)
      score += penalty
      reasons.push({ code: 'RECENTLY_PLANNED', weight: penalty, detail: String(days) })
    }
  }

  const cookedDate = lastCookedAt[recipe.id]
  if (cookedDate) {
    const days = Math.max(0, daysBetween(cookedDate, date))
    if (days < weights.cookedWindowDays) {
      const penalty = -weights.cookedRecentlyPenalty * (1 - days / weights.cookedWindowDays)
      score += penalty
      reasons.push({ code: 'RECENTLY_COOKED', weight: penalty, detail: String(days) })
    }
  }

  if (liked.has(recipe.id) || recipe.favorite) {
    score += weights.likedBonus
    reasons.push({ code: 'LIKED', weight: weights.likedBonus })
  }

  if (categories.size > 0) {
    for (const neighbour of [addDays(date, -1), addDays(date, 1)]) {
      const neighbourId = placed[neighbour]
      const neighbourCategories = neighbourId ? varietyKeys(byId.get(neighbourId)?.categories ?? []) : new Set<string>()
      const shared = Array.from(categories).filter((key) => neighbourCategories.has(key))
      if (shared.length > 0) {
        score -= weights.sameCategoryPenalty
        reasons.push({
          code: 'SAME_CATEGORY_NEIGHBOUR',
          weight: -weights.sameCategoryPenalty,
          detail: shared.join(', '),
        })
      }
    }
  }

  const protein = proteinOf[recipe.id]
  if (protein) {
    const inWeek = weekProteinCounts[protein] ?? 0
    if (inWeek > 0) {
      const penalty = -weights.sameProteinPenalty * inWeek
      score += penalty
      reasons.push({ code: 'SAME_PROTEIN', weight: penalty, detail: protein })
    } else {
      const last = recentProteins[protein]
      if (last) {
        const days = Math.max(0, daysBetween(last, date))
        if (days < weights.proteinRecencyWindowDays) {
          const penalty = -weights.sameProteinPenalty * (1 - days / weights.proteinRecencyWindowDays)
          score += penalty
          reasons.push({ code: 'SAME_PROTEIN', weight: penalty, detail: protein })
        }
      }
    }
  }

  if (coreForRecipe.size > 0) {
    const reused: string[] = []
    const monotony: string[] = []
    const needs: string[] = []
    let reuseScore = 0
    let monotonyScore = 0
    let needsScore = 0

    for (const ingredient of coreForRecipe) {
      const countSoFar = countLike(weekCoreCounts, ingredient)
      if (countSoFar >= 1 && countSoFar <= weights.maxReuseCount) {
        reuseScore += weights.weekReuseBonus
        reused.push(ingredient)
      } else if (countSoFar > weights.maxReuseCount) {
        monotonyScore -= weights.monotonyPenalty * (countSoFar - weights.maxReuseCount)
        monotony.push(ingredient)
      } else {
        needsScore -= weights.newItemPenalty
        needs.push(ingredient)
      }
    }

    if (reuseScore !== 0) {
      score += reuseScore
      reasons.push({ code: 'WEEK_REUSE', weight: reuseScore, detail: reused.join(', ') })
    }
    if (monotonyScore !== 0) {
      score += monotonyScore
      reasons.push({ code: 'MONOTONY', weight: monotonyScore, detail: monotony.join(', ') })
    }
    if (needsScore !== 0) {
      score += needsScore
      reasons.push({ code: 'NEW_INGREDIENTS_NEEDED', weight: needsScore, detail: needs.join(', ') })
    }
  }

  if (!isWeekend(date)) {
    const minutes = effectiveMinutes(recipe)
    if (minutes !== null) {
      const bonus = weights.timeFitBonus * (1 - Math.min(Math.max(minutes / MAX_MINUTES, 0), 1))
      if (bonus > 0) {
        score += bonus
        reasons.push({ code: 'QUICK_WEEKDAY', weight: bonus, detail: String(Math.round(minutes)) })
      }
    }
  }

  score += rng() * weights.jitter
  return { score, reasons }
}
