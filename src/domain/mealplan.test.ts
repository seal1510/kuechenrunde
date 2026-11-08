import { describe, expect, it } from 'vitest'
import type { CookSession, MealPlanEntry } from '../types'
import {
  availablePortions,
  checkCookServings,
  checkMealAssignment,
  cookSessionBalance,
  isProtectedEntry,
  mealSlotLabel,
  sortMealEntries,
} from './mealplan'

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

function meal(id: string, servings: number, overrides: Partial<MealPlanEntry> = {}): MealPlanEntry {
  return {
    id,
    date: '2026-05-25',
    slot: 'dinner',
    recipeId: 'r1',
    servings,
    cookSessionId: 'cook-1',
    status: 'planned',
    auto: false,
    pinned: false,
    leftover: true,
    cooked: false,
    reasons: [],
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }
}

describe('portion balance', () => {
  it('derives provided, assigned and remaining portions', () => {
    const balance = cookSessionBalance(session, [meal('m1', 2), meal('m2', 2, { date: '2026-05-26' })])
    expect(balance).toEqual({ provided: 6, assigned: 4, remaining: 2, overAssigned: false })
  })

  it('frees portions when a meal is deleted or reduced', () => {
    const meals = [meal('m1', 2), meal('m2', 3)]
    expect(availablePortions(session, meals)).toBe(1)
    expect(availablePortions(session, meals.filter((entry) => entry.id !== 'm2'))).toBe(4)
    expect(availablePortions(session, [meal('m1', 1), meals[1]!])).toBe(2)
  })

  it('reports an over-assignment instead of hiding it', () => {
    const balance = cookSessionBalance(session, [meal('m1', 5), meal('m2', 2)])
    expect(balance.overAssigned).toBe(true)
    expect(balance.remaining).toBe(-1)
  })

  it('rejects assigning more portions than available and explains why', () => {
    const check = checkMealAssignment(session, [meal('m1', 4)], 3)
    expect(check.ok).toBe(false)
    expect(check.available).toBe(2)
    expect(check.message).toContain('nur noch 2')
  })

  it('allows an existing entry to keep its own portions', () => {
    expect(checkMealAssignment(session, [meal('m1', 4)], 4, 'm1').ok).toBe(true)
  })

  it('does not allow reducing a cooking event below assigned portions', () => {
    const check = checkCookServings(session, [meal('m1', 4)], 2)
    expect(check.ok).toBe(false)
    expect(check.message).toContain('4 Portionen')
    expect(checkCookServings(session, [meal('m1', 4)], 4).ok).toBe(true)
  })
})

describe('meal plan helpers', () => {
  it('labels the three meal slots', () => {
    expect(mealSlotLabel('breakfast')).toBe('Frühstück')
    expect(mealSlotLabel('lunch')).toBe('Mittagessen')
    expect(mealSlotLabel('dinner')).toBe('Abendessen')
  })

  it('protects manual, pinned, eaten and cooked entries', () => {
    expect(isProtectedEntry(meal('m1', 1, { auto: false }))).toBe(true)
    expect(isProtectedEntry(meal('m1', 1, { auto: true, pinned: true }))).toBe(true)
    expect(isProtectedEntry(meal('m1', 1, { auto: true, status: 'eaten' }))).toBe(true)
    expect(isProtectedEntry(meal('m1', 1, { auto: true }), { ...session, status: 'cooked' })).toBe(true)
    expect(isProtectedEntry(meal('m1', 1, { auto: true }), session)).toBe(false)
  })

  it('sorts by date, slot and position', () => {
    const sorted = sortMealEntries([
      meal('b', 1, { date: '2026-05-26', position: 0 }),
      meal('c', 1, { position: 2 }),
      meal('a', 1, { position: 1 }),
      meal('d', 1, { slot: 'breakfast' }),
    ])
    expect(sorted.map((entry) => entry.id)).toEqual(['d', 'a', 'c', 'b'])
  })
})
