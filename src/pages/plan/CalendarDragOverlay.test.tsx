import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { MealPlanEntry } from '../../types'
import {
  CalendarDragOverlay,
  type CalendarDragOverlayState,
} from './CalendarDragOverlay'

const entry: MealPlanEntry = {
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
}

function overlay(overrides: Partial<CalendarDragOverlayState> = {}): CalendarDragOverlayState {
  return {
    item: { kind: 'entry', entry },
    dishTitle: 'Nudeln mit Pesto',
    groupColorIndex: 2,
    groupSessionId: 'cook-free-1',
    left: 10,
    top: 20,
    width: 160,
    height: 64,
    originLeft: 10,
    originTop: 20,
    offsetX: 5,
    offsetY: 5,
    phase: 'dragging',
    ...overrides,
  }
}

describe('calendar drag overlay', () => {
  it('shows a free dish with the same card title, portions and group colour as the calendar', () => {
    const html = renderToStaticMarkup(<CalendarDragOverlay overlay={overlay()} />)

    expect(html).toContain('Nudeln mit Pesto')
    expect(html).toContain('2 Portionen')
    expect(html).toContain('calendar-entry--dish')
    expect(html).toContain('calendar-entry--group group-color-2')
    expect(html).toContain('is-group-highlighted')
    expect(html).not.toContain('Rezept nicht gefunden')
  })

  it('keeps the comment overlay unchanged', () => {
    const html = renderToStaticMarkup(
      <CalendarDragOverlay
        overlay={overlay({
          item: {
            kind: 'note',
            note: { date: '2026-05-29', text: 'Essen gehen', createdAt: 1, updatedAt: 1 },
          },
          dishTitle: '',
          groupColorIndex: null,
          groupSessionId: null,
        })}
      />,
    )

    expect(html).toContain('Essen gehen')
    expect(html).toContain('calendar-note-entry')
    expect(html).not.toContain('calendar-entry--dish')
  })
})
