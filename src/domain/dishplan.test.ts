import { describe, expect, it } from 'vitest'
import type { CookSession, MealPlanEntry } from '../types'
import {
  consecutiveDates,
  cookedRedefinition,
  groupLabel,
  groupSize,
  normalizeDayServings,
  planDayTotal,
  scalePlan,
  shiftPlanDays,
  type PlanDayDraft,
} from './dishplan'
import type { Recipe } from '../types'

function recipe(overrides: Partial<Recipe> = {}): Recipe {
  return {
    id: 'r1',
    importId: 'mela-r1',
    importSource: 'mela',
    title: 'Bolognese',
    description: '',
    ingredientGroups: [],
    ingredients: [
      {
        id: 'i1',
        groupId: null,
        position: 0,
        raw: '400 g Spaghetti',
        name: 'Spaghetti',
        quantity: 400,
        quantityText: '400',
        unit: 'g',
        parseStatus: 'parsed',
        links: [],
      },
    ],
    instructions: [],
    servingsText: '4 Portionen',
    servingsNumber: 4,
    prepTime: '',
    cookTime: '',
    totalTime: '',
    categories: [],
    cuisine: [],
    dishType: [],
    effort: '',
    tags: [],
    notes: '',
    nutrition: '',
    sourceUrl: '',
    favorite: false,
    wantToCook: false,
    melaDate: null,
    raw: {},
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }
}

function entry(date: string, cookSessionId: string | null = 'cook-1'): MealPlanEntry {
  return {
    id: `meal-${date}`,
    date,
    slot: 'dinner',
    recipeId: 'r1',
    servings: 2,
    cookSessionId,
    status: 'planned',
    auto: false,
    pinned: false,
    leftover: false,
    cooked: false,
    reasons: [],
    createdAt: 1,
    updatedAt: 1,
  }
}

const session: CookSession = {
  id: 'cook-1',
  recipeId: 'r1',
  date: '2026-05-25',
  servings: 6,
  status: 'planned',
  auto: false,
  createdAt: 1,
  updatedAt: 1,
}

describe('multi-day dish rules', () => {
  it('sums individual day portions without double counting', () => {
    expect(
      planDayTotal([
        { date: '2026-05-25', servings: 2 },
        { date: '2026-05-26', servings: 1 },
        { date: '2026-05-27', servings: 3 },
      ]),
    ).toBe(6)
  })

  it('builds consecutive dates across week and year boundaries', () => {
    expect(consecutiveDates('2026-12-30', 3)).toEqual([
      '2026-12-30',
      '2026-12-31',
      '2027-01-01',
    ])
    expect(consecutiveDates('2026-05-25', 7).at(-1)).toBe('2026-05-31')
  })

  it('counts distinct linked days and labels connected dishes', () => {
    const entries = [
      entry('2026-05-25'),
      entry('2026-05-26'),
      { ...entry('2026-05-26'), id: 'other' },
      entry('2026-05-27', null),
    ]
    expect(groupSize(entries, 'cook-1')).toBe(2)
    expect(groupLabel(groupSize(entries, 'cook-1'))).toBe('2 Tage')
    expect(groupLabel(1)).toBeNull()
  })

  it('shifts a whole dish while keeping removed-day gaps', () => {
    const days: PlanDayDraft[] = [
      { date: '2026-05-25', servings: 2 },
      { date: '2026-05-27', servings: 1 },
    ]
    expect(shiftPlanDays(days, 7).map((day) => day.date)).toEqual([
      '2026-06-01',
      '2026-06-03',
    ])
  })

  it('reports a cooked amount that a plan change would redefine', () => {
    expect(cookedRedefinition({ ...session, status: 'cooked' }, [
      { date: '2026-05-25', servings: 2 },
      { date: '2026-05-26', servings: 1 },
      { date: '2026-05-27', servings: 3 },
    ])).toBeNull()
    const conflict = cookedRedefinition({ ...session, status: 'cooked' }, [
      { date: '2026-05-25', servings: 2 },
    ])
    expect(conflict?.cookedServings).toBe(6)
    expect(conflict?.totalServings).toBe(2)
    expect(conflict?.message).toContain('bereits gekocht')
  })

  it('scales the whole dish by total portions and leaves the recipe unchanged', () => {
    const original = recipe()
    const result = scalePlan(original, [
      { date: '2026-05-25', servings: 2 },
      { date: '2026-05-26', servings: 1 },
      { date: '2026-05-27', servings: 3 },
    ])
    expect(result.totalServings).toBe(6)
    expect(result.originalServings).toBe(4)
    expect(result.scaling.factor).toBe(1.5)
    expect(result.scaling.items[0]?.quantityText).toBe('600')
    expect(original.ingredients[0]?.quantityText).toBe('400')
  })

  it('uses a user correction only when the recipe has no clear original count', () => {
    const unclear = recipe({ servingsNumber: null, servingsText: 'für viele' })
    const result = scalePlan(
      unclear,
      [{ date: '2026-05-25', servings: 6 }],
      4,
    )
    expect(result.originalServings).toBe(4)
    expect(result.scaling.factor).toBe(1.5)
  })

  it('rejects non-positive daily portions', () => {
    expect(() => normalizeDayServings(0)).toThrow()
    expect(() => normalizeDayServings(Number.NaN)).toThrow()
    expect(normalizeDayServings(2.44)).toBe(2.4)
  })
})
