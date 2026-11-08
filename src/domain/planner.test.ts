import { describe, expect, it } from 'vitest'
import { addDays } from './dates'
import {
  DEFAULT_WEIGHTS,
  generateWeek,
  generateWeekBest,
  type PlannerRecipe,
} from './planner'

const NO_JITTER = { ...DEFAULT_WEIGHTS, jitter: 0 }
const TODAY = '2026-05-25' // a Monday
const week = (n: number) => Array.from({ length: n }, (_, index) => addDays(TODAY, index))

function recipe(
  id: string,
  category: string | string[],
  options: {
    servings?: number
    ingredients?: string[]
    totalTime?: string
    prepTime?: string
    cookTime?: string
    favorite?: boolean
  } = {},
): PlannerRecipe {
  return {
    id,
    name: id,
    categories: Array.isArray(category) ? category : category.split('\n'),
    servings: options.servings ?? null,
    ingredients: options.ingredients ?? [],
    totalTime: options.totalTime ?? '',
    prepTime: options.prepTime ?? '',
    cookTime: options.cookTime ?? '',
    favorite: options.favorite ?? false,
  }
}

describe('MealPlanner port', () => {
  it('avoids a recently planned recipe', () => {
    const result = generateWeek({
      dates: week(1),
      candidates: [recipe('A', 'Pasta'), recipe('B', 'Fleisch')],
      recentlyPlanned: { A: addDays(TODAY, -1) },
      householdSize: 2,
      today: TODAY,
      seed: 1,
      weights: NO_JITTER,
    })
    expect(result[TODAY]?.recipeId).toBe('B')
  })

  it('puts different categories on neighbouring days', () => {
    const result = generateWeek({
      dates: week(2),
      candidates: [
        recipe('A', 'Pasta'),
        recipe('B', 'Pasta'),
        recipe('C', 'Fleisch'),
      ],
      householdSize: 2,
      today: TODAY,
      seed: 1,
      weights: NO_JITTER,
    })
    const categories: Record<string, string> = { A: 'Pasta', B: 'Pasta', C: 'Fleisch' }
    const first = result[week(2)[0]!]?.recipeId ?? ''
    const second = result[week(2)[1]!]?.recipeId ?? ''
    expect(categories[first]).not.toBe(categories[second])
  })

  it('carries a big batch to the next day as leftovers', () => {
    const result = generateWeek({
      dates: week(3),
      candidates: [recipe('Big', 'Suppe', { servings: 4 }), recipe('Other', 'Salat', { servings: 2 })],
      householdSize: 2,
      today: TODAY,
      seed: 1,
      weights: NO_JITTER,
    })
    expect(result[week(3)[0]!]?.recipeId).toBe('Big')
    expect(result[week(3)[1]!]?.recipeId).toBe('Big')
    expect(result[week(3)[1]!]?.leftover).toBe(true)
    expect(result[week(3)[1]!]?.reasons[0]?.code).toBe('BIG_BATCH_LEFTOVER')
    expect(result[week(3)[2]!]?.recipeId).toBe('Other')
  })

  it('respects skipped and pinned days', () => {
    const dates = week(3)
    const result = generateWeek({
      dates,
      skipped: new Set([dates[1]!]),
      pinned: { [dates[0]!]: 'P' },
      candidates: [recipe('P', 'Pasta'), recipe('Q', 'Fleisch'), recipe('R', 'Fisch')],
      householdSize: 2,
      today: TODAY,
      seed: 1,
      weights: NO_JITTER,
    })
    expect(result[dates[0]!]?.recipeId).toBe('P')
    expect(result[dates[1]!]).toBeUndefined()
    expect(result[dates[2]!]).toBeDefined()
  })

  it('is deterministic for the same seed', () => {
    const candidates = [1, 2, 3, 4, 5, 6].map((index) =>
      recipe(`R${index}`, index % 2 === 0 ? 'Pasta' : 'Fleisch'),
    )
    const args = {
      dates: week(5),
      candidates,
      householdSize: 2,
      today: TODAY,
      seed: 42,
    }
    expect(generateWeek(args)).toEqual(generateWeek(args))
    for (const pick of Object.values(generateWeek(args))) {
      expect(candidates.some((candidate) => candidate.id === pick.recipeId)).toBe(true)
    }
  })

  it('prefers a favourite recipe', () => {
    const result = generateWeek({
      dates: week(1),
      candidates: [recipe('A', 'Pasta'), recipe('B', 'Fleisch', { favorite: true })],
      householdSize: 2,
      today: TODAY,
      seed: 1,
      weights: NO_JITTER,
    })
    expect(result[TODAY]?.recipeId).toBe('B')
  })

  it('penalises a recently cooked recipe', () => {
    const result = generateWeek({
      dates: week(1),
      candidates: [recipe('A', 'Pasta'), recipe('B', 'Fleisch')],
      lastCookedAt: { A: addDays(TODAY, -1) },
      householdSize: 2,
      today: TODAY,
      seed: 1,
      weights: NO_JITTER,
    })
    expect(result[TODAY]?.recipeId).toBe('B')
  })

  it('uses prep plus cook time when total time is missing', () => {
    const result = generateWeek({
      dates: week(1),
      candidates: [
        recipe('B', 'Pasta', { totalTime: 'PT120M' }),
        recipe('A', 'Pasta', { prepTime: 'PT5M', cookTime: 'PT10M' }),
      ],
      householdSize: 2,
      today: TODAY,
      seed: 1,
      weights: NO_JITTER,
    })
    expect(result[TODAY]?.recipeId).toBe('A')
  })

  it('does not treat two uncategorised dishes as a category repeat', () => {
    const dates = week(2)
    const result = generateWeek({
      dates,
      pinned: { [dates[0]!]: 'P' },
      candidates: [
        recipe('P', 'Sonstiges'),
        recipe('X', 'Sonstiges', { favorite: true }),
        recipe('Y', 'Pasta'),
      ],
      householdSize: 2,
      today: TODAY,
      seed: 1,
      weights: NO_JITTER,
    })
    expect(result[dates[1]!]?.recipeId).toBe('X')
  })

  it('penalises a shared dish category but not a shared diet key', () => {
    const dates = week(2)
    const overlap = generateWeek({
      dates,
      pinned: { [dates[0]!]: 'P' },
      candidates: [
        recipe('P', 'soup\nvegetarian'),
        recipe('X', 'soup', { favorite: true }),
        recipe('Y', 'meat'),
      ],
      householdSize: 2,
      today: TODAY,
      seed: 1,
      weights: NO_JITTER,
    })
    expect(overlap[dates[1]!]?.recipeId).toBe('Y')

    const diet = generateWeek({
      dates,
      pinned: { [dates[0]!]: 'P' },
      candidates: [
        recipe('P', 'soup\nvegetarian'),
        recipe('X', 'pasta\nvegetarian', { favorite: true }),
        recipe('Y', 'meat'),
      ],
      householdSize: 2,
      today: TODAY,
      seed: 1,
      weights: NO_JITTER,
    })
    expect(diet[dates[1]!]?.recipeId).toBe('X')
  })

  it('does not place leftovers when the next free day is too far away', () => {
    const dates = week(4)
    const result = generateWeek({
      dates,
      pinned: { [dates[1]!]: 'X', [dates[2]!]: 'Y' },
      candidates: [
        recipe('Big', 'Suppe', { servings: 4 }),
        recipe('X', 'Pasta'),
        recipe('Y', 'Fisch'),
        recipe('Z', 'Salat'),
      ],
      householdSize: 2,
      today: TODAY,
      seed: 1,
      weights: NO_JITTER,
    })
    expect(result[dates[0]!]?.recipeId).toBe('Big')
    expect(Object.values(result).filter((pick) => pick.recipeId === 'Big')).toHaveLength(1)
  })

  it('rotates a small library without back-to-back repeats', () => {
    const dates = week(7)
    const result = generateWeek({
      dates,
      candidates: [recipe('A', 'Pasta'), recipe('B', 'Fleisch'), recipe('C', 'Fisch')],
      householdSize: 2,
      today: TODAY,
      seed: 1,
      weights: NO_JITTER,
    })
    expect(Object.keys(result)).toHaveLength(7)
    expect(new Set(Object.values(result).map((pick) => pick.recipeId))).toEqual(new Set(['A', 'B', 'C']))
    for (let index = 0; index < 6; index += 1) {
      expect(result[dates[index]!]?.recipeId).not.toBe(result[dates[index + 1]!]?.recipeId)
    }
  })

  it('returns pinned entries when the library is empty', () => {
    const result = generateWeek({
      dates: week(2),
      pinned: { [TODAY]: 'X' },
      candidates: [],
      householdSize: 2,
      today: TODAY,
      seed: 1,
      weights: NO_JITTER,
    })
    expect(result[TODAY]?.recipeId).toBe('X')
    expect(Object.keys(result)).toHaveLength(1)
  })

  it('fills every day with a single recipe when the cool-down is off', () => {
    const result = generateWeek({
      dates: week(3),
      candidates: [recipe('A', 'Pasta')],
      householdSize: 2,
      today: TODAY,
      seed: 1,
      weights: NO_JITTER,
    })
    expect(Object.keys(result)).toHaveLength(3)
    expect(Object.values(result).every((pick) => pick.recipeId === 'A')).toBe(true)
  })

  it('ignores staples for reuse and cardinality', () => {
    const dates = week(2)
    const result = generateWeek({
      dates,
      pinned: { [dates[0]!]: 'anchor' },
      candidates: [
        recipe('anchor', 'Pasta', { ingredients: ['Aubergine', 'Salz', 'Olivenöl'] }),
        recipe('staples', 'Fisch', { ingredients: ['Salz', 'Pfeffer', 'Olivenöl', 'Wasser'] }),
        recipe('real', 'Fleisch', { ingredients: ['Aubergine', 'Hackfleisch'] }),
      ],
      householdSize: 2,
      today: TODAY,
      seed: 1,
      weights: NO_JITTER,
    })
    expect(result[dates[1]!]?.recipeId).toBe('real')
    const reuse = result[dates[1]!]?.reasons.find((reason) => reason.code === 'WEEK_REUSE')
    expect(reuse?.detail).toBe('aubergine')
  })

  it('explains new ingredients by name without staples', () => {
    const result = generateWeek({
      dates: week(1),
      candidates: [
        recipe('A', 'Pasta', { ingredients: ['Aubergine', 'Champignons', 'Salz'] }),
      ],
      householdSize: 2,
      today: TODAY,
      seed: 1,
      weights: NO_JITTER,
    })
    const needs = result[TODAY]?.reasons.find((reason) => reason.code === 'NEW_INGREDIENTS_NEEDED')
    expect(needs?.detail).toContain('aubergine')
    expect(needs?.detail).toContain('champignons')
    expect(needs?.detail).not.toContain('salz')
  })

  it('keeps staples out of the shopping needs', () => {
    const result = generateWeek({
      dates: week(1),
      candidates: [recipe('A', 'Pasta', { ingredients: ['Reis', 'Sojasoße'] })],
      householdSize: 2,
      today: TODAY,
      seed: 1,
      weights: NO_JITTER,
    })
    const needs = result[TODAY]?.reasons.find((reason) => reason.code === 'NEW_INGREDIENTS_NEEDED')
    expect(needs?.detail ?? '').toContain('reis')
    expect(needs?.detail ?? '').not.toContain('sojasoße')
  })

  it('caps repeated main ingredients and avoids the same protein', () => {
    const dates = week(5)
    const chicken = [1, 2, 3, 4, 5].map((index) =>
      recipe(`C${index}`, 'Fleisch', { ingredients: ['Hähnchen', `Beilage${index}`] }),
    )
    const alternatives = [
      recipe('V1', 'Vegetarisch', { ingredients: ['Tofu', 'Reis'] }),
      recipe('V2', 'Vegetarisch', { ingredients: ['Linsen', 'Spinat'] }),
      recipe('V3', 'Vegetarisch', { ingredients: ['Bohnen', 'Quinoa'] }),
      recipe('F1', 'Fisch', { ingredients: ['Lachs', 'Spargel'] }),
      recipe('F2', 'Fisch', { ingredients: ['Kabeljau', 'Kartoffeln'] }),
      recipe('B1', 'Rind', { ingredients: ['Hackfleisch', 'Pasta'] }),
    ]
    const plan = generateWeekBest({
      dates,
      candidates: [...chicken, ...alternatives],
      householdSize: 2,
      today: TODAY,
      seed: 1,
      weights: NO_JITTER,
      restarts: 8,
    })
    expect(Object.values(plan).filter((pick) => pick.recipeId.startsWith('C')).length).toBeLessThanOrEqual(2)
  })

  it('picks the least shopping-heavy multi-restart plan', () => {
    const plan = generateWeekBest({
      dates: week(2),
      candidates: [
        recipe('R1', 'Pasta', { ingredients: ['Aubergine', 'Reis'] }),
        recipe('R2', 'Pasta', { ingredients: ['Aubergine', 'Tofu'] }),
        recipe('R3', 'Pasta', { ingredients: ['Lachs', 'Spargel'] }),
      ],
      householdSize: 2,
      today: TODAY,
      seed: 1,
      weights: NO_JITTER,
      restarts: 8,
    })
    expect(new Set(Object.values(plan).map((pick) => pick.recipeId))).toEqual(new Set(['R1', 'R2']))
  })

  it('applies the 10-day cool-down and leaves too-small libraries empty', () => {
    const dates = week(8)
    const result = generateWeek({
      dates,
      candidates: [recipe('A', 'Pasta'), recipe('B', 'Fleisch'), recipe('C', 'Fisch')],
      householdSize: 2,
      today: TODAY,
      seed: 1,
      weights: NO_JITTER,
      minRepeatGapDays: 10,
    })
    expect(Object.keys(result)).toHaveLength(3)
    expect(new Set(Object.values(result).map((pick) => pick.recipeId)).size).toBe(3)
  })

  it('lets a recipe through exactly on the cool-down boundary', () => {
    const result = generateWeek({
      dates: week(1),
      candidates: [recipe('A', 'Pasta')],
      recentlyPlanned: { A: addDays(TODAY, -10) },
      householdSize: 2,
      today: TODAY,
      seed: 1,
      weights: NO_JITTER,
      minRepeatGapDays: 10,
    })
    expect(result[TODAY]?.recipeId).toBe('A')
  })

  it('counts cooked dates in the cool-down', () => {
    const result = generateWeek({
      dates: week(1),
      candidates: [recipe('A', 'Pasta')],
      lastCookedAt: { A: addDays(TODAY, -3) },
      householdSize: 2,
      today: TODAY,
      seed: 1,
      weights: NO_JITTER,
      minRepeatGapDays: 10,
    })
    expect(result[TODAY]).toBeUndefined()
  })

  it('lets a big-batch leftover bypass the cool-down', () => {
    const result = generateWeek({
      dates: week(2),
      candidates: [recipe('BIG', 'Pasta', { servings: 8 })],
      householdSize: 2,
      today: TODAY,
      seed: 1,
      weights: NO_JITTER,
      minRepeatGapDays: 10,
    })
    expect(result[week(2)[0]!]?.recipeId).toBe('BIG')
    expect(result[week(2)[1]!]?.recipeId).toBe('BIG')
    expect(result[week(2)[1]!]?.leftover).toBe(true)
  })
})
