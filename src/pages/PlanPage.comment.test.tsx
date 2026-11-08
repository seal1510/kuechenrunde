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
      // PlanPage queries entries, recipes, free dishes, sessions, settings, dayNotes.
      const index = call % 6
      call += 1
      const values = [
        [
          {
            id: 'meal-1',
            date: '2026-05-29',
            slot: 'dinner',
            recipeId: 'r1',
            servings: 2,
            position: 0,
            cookSessionId: 'cook-1',
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
            id: 'meal-2',
            date: '2026-05-30',
            slot: 'dinner',
            recipeId: 'r1',
            servings: 3,
            position: 0,
            cookSessionId: 'cook-1',
            status: 'planned',
            auto: false,
            pinned: false,
            leftover: false,
            cooked: false,
            reasons: [],
            createdAt: 1,
            updatedAt: 1,
          },
        ],
        [{ id: 'r1', title: 'Testgericht' }],
        [],
        [],
        [],
        [{ date: '2026-05-29', text: 'Essen gehen', createdAt: 1, updatedAt: 1 }],
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

describe('calendar comment presentation', () => {
  it('shows an existing day note as a full calendar card and uses the shared add action', () => {
    const html = renderToStaticMarkup(<PlanPage />)

    expect(html).toContain('Essen gehen')
    expect(html).toContain('calendar-note-entry')
    expect(html).toContain('calendar-entry--dish')
    expect(html).toContain('calendar-entry--group')
    expect(html).toContain('group-color-')
    expect(html).toContain('Testgericht')
    expect(html).toContain('Hinzufügen')
    expect(html).toContain('calendar-add-day is-occupied')
    expect(html).not.toContain('calendar-badge')
    expect(html).toContain('calendar-entry-session')
    expect(html).toContain('2 Tage')
    expect(html).not.toContain('calendar-drag-handle')
    expect(html).not.toContain('Notiz hinzufügen')
    expect(html).not.toContain('calendar-note-action')
  })
})
