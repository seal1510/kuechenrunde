import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PlanPage } from './PlanPage'

const live = vi.hoisted(() => {
  let call = 0
  let notes: unknown[] = []
  return {
    reset: (nextNotes: unknown[] = []) => {
      call = 0
      notes = nextNotes
    },
    next: () => {
      // PlanPage queries entries, recipes, free dishes, sessions, settings, dayNotes.
      const index = call % 6
      call += 1
      const values = [[], [], [], [], [], notes]
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

describe('calendar without a recipe library', () => {
  it('still renders the calendar and the shared add workflow with zero recipes', () => {
    const html = renderToStaticMarkup(<PlanPage />)

    expect(html).toContain('Noch keine Rezepte für die Planung.')
    expect(html).toContain('Rezepte importieren')
    expect(html).toContain('Neues Rezept')
    expect(html).toContain('Woche')
    expect(html).toContain('Hinzufügen')
    expect(html).toContain('calendar-add-day is-empty')
    expect(html.match(/data-calendar-date=/g)).toHaveLength(11)
  })

  it('shows existing day notes even when no recipe exists', () => {
    live.reset([
      { date: '2026-05-29', text: 'Essen gehen', createdAt: 1, updatedAt: 1 },
    ])
    const html = renderToStaticMarkup(<PlanPage />)

    expect(html).toContain('Essen gehen')
    expect(html).toContain('calendar-note-entry')
    expect(html).toContain('Hinzufügen')
    expect(html).toContain('calendar-add-day is-occupied')
    expect(html).not.toContain('Noch keine Rezepte für die Planung.')
    expect(html.match(/data-calendar-date=/g)).toHaveLength(11)
  })
})
