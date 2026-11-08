import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PlanPage } from './PlanPage'

const live = vi.hoisted(() => {
  let call = 0
  return {
    reset: () => {
      call = 0
    },
    next: () => {
      // Entries, recipes, free dishes, sessions, settings, day notes.
      const index = call % 6
      call += 1
      const freeEntries = [
        {
          id: 'meal-free-1',
          date: '2026-05-29',
          slot: 'dinner',
          recipeId: null,
          freeDishId: 'free-1',
          servings: 2,
          position: 0,
          cookSessionId: 'cook-free-1',
          status: 'planned',
          auto: false,
          pinned: false,
          leftover: false,
          cooked: false,
          reasons: [],
          createdAt: 1,
          updatedAt: 1,
        },
        {
          id: 'meal-free-2',
          date: '2026-05-31',
          slot: 'dinner',
          recipeId: null,
          freeDishId: 'free-1',
          servings: 1,
          position: 0,
          cookSessionId: 'cook-free-1',
          status: 'planned',
          auto: false,
          pinned: false,
          leftover: false,
          cooked: false,
          reasons: [],
          createdAt: 1,
          updatedAt: 1,
        },
      ]
      const values = [
        freeEntries,
        [],
        [
          {
            id: 'free-1',
            name: 'Nudeln mit Pesto',
            referenceServings: 3,
            ingredients: [],
            createdAt: 1,
            updatedAt: 1,
          },
        ],
        [
          {
            id: 'cook-free-1',
            recipeId: null,
            freeDishId: 'free-1',
            date: '2026-05-29',
            servings: 3,
            status: 'planned',
            auto: false,
            createdAt: 1,
            updatedAt: 1,
          },
        ],
        [],
        [],
      ]
      return values[index]
    },
  }
})

vi.mock('dexie-react-hooks', () => ({
  useLiveQuery: () => live.next(),
}))

beforeEach(() => {
  live.reset()
  vi.useFakeTimers()
  vi.setSystemTime(new Date(2026, 4, 29, 12, 0, 0))
})

afterEach(() => {
  vi.useRealTimers()
})

describe('free dish calendar presentation', () => {
  it('renders a free dish as a full dish card with a quiet free marker', () => {
    const html = renderToStaticMarkup(<PlanPage />)

    expect(html).toContain('Nudeln mit Pesto')
    expect(html).toContain('2 Portionen')
    expect(html).toContain('1 Portion')
    expect(html).toContain('calendar-entry calendar-entry--dish')
    expect(html).toContain('calendar-entry--group group-color-')
    expect(html).toContain('calendar-entry--free')
    expect(html).toContain('calendar-entry-kind')
    expect(html).not.toContain('Rezept nicht gefunden')
    expect(html).not.toContain('Noch keine Rezepte für die Planung.')
    expect(html).not.toContain('Freies Gericht</span>')
  })

  it('keeps the shared add action available on every day', () => {
    const html = renderToStaticMarkup(<PlanPage />)

    expect(html).toContain('calendar-add-day is-occupied')
    expect(html).toContain('calendar-add-day is-empty')
    expect(html.match(/Hinzufügen/g)?.length).toBeGreaterThan(1)
  })
})
