import { describe, expect, it } from 'vitest'
import { addDays } from '../domain/dates'
import { shoppingItemKey } from '../domain/shopping'
import { shoppingPeriod } from '../domain/shoppingLists'
import { periodForStart } from './periodView'
import type { CookSession, Ingredient, Recipe, ShoppingManualItem, ShoppingPurchase } from '../types'
import { buildShoppingPeriodView } from './periodView'

function ingredient(): Ingredient {
  return {
    id: 'i1',
    groupId: null,
    position: 0,
    raw: '8 Tomaten',
    name: 'Tomaten',
    quantity: 8,
    quantityText: '8',
    unit: 'Stück',
    purchaseNote: '',
    preparationNote: '',
    parseStatus: 'parsed',
    links: [],
  }
}

function recipe(): Recipe {
  return {
    id: 'r1',
    importId: 'mela-r1',
    importSource: 'mela',
    title: 'Tomatengericht',
    description: '',
    ingredientGroups: [],
    ingredients: [ingredient()],
    instructions: [],
    servingsText: '2',
    servingsNumber: 2,
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
  }
}

function session(id: string, date: string): CookSession {
  return {
    id,
    recipeId: 'r1',
    date,
    servings: 2,
    status: 'planned',
    auto: false,
    createdAt: 1,
    updatedAt: 1,
  }
}

function manual(overrides: Partial<ShoppingManualItem> = {}): ShoppingManualItem {
  return {
    id: 'm1',
    shoppingDate: '2026-11-05',
    weekStart: '2026-11-05',
    name: 'Milch',
    quantityText: '1',
    unit: 'l',
    purchaseNote: '',
    categoryId: 'dairy',
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }
}

function purchase(overrides: Partial<ShoppingPurchase> = {}): ShoppingPurchase {
  return {
    id: 'p1',
    shoppingDate: '2026-11-06',
    itemKey: shoppingItemKey('Tomaten'),
    amounts: [{ dimension: 'count', lower: 8, upper: 8 }],
    snapshot: [],
    qualitative: false,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }
}

function view(sessions: CookSession[], extras: {
  manualItems?: ShoppingManualItem[]
  purchases?: ShoppingPurchase[]
} = {}, periodStart = '2026-11-05') {
  return buildShoppingPeriodView({
    period: periodForStart(periodStart),
    recipes: [recipe()],
    freeDishes: [],
    cookSessions: sessions,
    manualItems: extras.manualItems ?? [],
    purchases: extras.purchases ?? [],
    rules: [],
    quantityCorrections: [],
    today: '2026-11-08',
  })
}

describe('shopping period view', () => {
  it('uses exactly the Thursday–Wednesday period even when the calendar week starts Monday', () => {
    const result = view([
      session('monday', '2026-11-02'),
      session('friday', '2026-11-06'),
    ])
    expect(result.period.start).toBe('2026-11-05')
    expect(result.period.end).toBe('2026-11-11')
    const tomatoes = result.list.items.find((item) => item.key === shoppingItemKey('Tomaten'))
    expect(tomatoes?.requiredPositions[0]?.lower).toBe(8)
  })

  it('assigns Monday and Friday demand to their respective Thursday periods', () => {
    const sessions = [
      session('monday', '2026-11-02'),
      session('friday', '2026-11-06'),
    ]
    const previous = view(sessions, {}, '2026-10-29')
    const current = view(sessions, {}, '2026-11-05')
    expect(previous.period.start).toBe('2026-10-29')
    expect(current.period.start).toBe('2026-11-05')
    expect(
      previous.list.items.find((item) => item.key === shoppingItemKey('Tomaten'))
        ?.requiredPositions[0]?.lower,
    ).toBe(8)
    expect(
      current.list.items.find((item) => item.key === shoppingItemKey('Tomaten'))
        ?.requiredPositions[0]?.lower,
    ).toBe(8)
  })

  it('navigates Thursday to Thursday across month and year boundaries', () => {
    const period = shoppingPeriod('2026-12-31', 3)
    expect(period.start).toBe('2026-12-31')
    expect(addDays(period.start, -7)).toBe('2026-12-24')
    expect(addDays(period.start, 7)).toBe('2027-01-07')
  })

  it('counts a purchase only in its own period', () => {
    const result = view(
      [session('friday', '2026-11-06')],
      { purchases: [purchase({ shoppingDate: '2026-11-12' })] },
    )
    const tomatoes = result.list.items.find((item) => item.key === shoppingItemKey('Tomaten'))
    expect(tomatoes?.status).toBe('open')
    expect(tomatoes?.purchased).toEqual([])
  })

  it('does not treat a flagged legacy row as certain and surfaces it', () => {
    const result = view(
      [session('friday', '2026-11-06')],
      {
        manualItems: [manual({ legacyWeekAmbiguous: true })],
        purchases: [purchase({ legacyWeekAmbiguous: true })],
      },
    )
    expect(result.conflicts.total).toBe(2)
    expect(result.list.items.find((item) => item.key === shoppingItemKey('Milch'))).toBeUndefined()
    const tomatoes = result.list.items.find((item) => item.key === shoppingItemKey('Tomaten'))
    expect(tomatoes?.status).toBe('open')
  })
})
