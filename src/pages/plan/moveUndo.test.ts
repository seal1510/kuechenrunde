import { describe, expect, it } from 'vitest'
import type { CookSession, DayNote, MealPlanEntry } from '../../types'
import type { MoveDishPlanResult } from '../../mealplan/dishService'
import { createMoveUndoOffer, createNoteUndoOffer } from './moveUndo'

const entry: MealPlanEntry = {
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
}

const session: CookSession = {
  id: 'cook-1',
  recipeId: 'r1',
  date: '2026-05-29',
  servings: 2,
  status: 'planned',
  auto: false,
  createdAt: 1,
  updatedAt: 1,
}

function result(moved: boolean): MoveDishPlanResult {
  return { moved, deltaDays: moved ? -2 : 0, session, entries: [entry] }
}

describe('move undo offer', () => {
  it('creates an undo offer only for a successful move', () => {
    expect(createMoveUndoOffer(result(false), entry.id, '2026-05-31')).toBeNull()
    expect(createMoveUndoOffer(null, entry.id, '2026-05-31')).toBeNull()

    const offer = createMoveUndoOffer(result(true), entry.id, '2026-05-31')
    expect(offer?.kind).toBe('dish')
    expect(offer?.entryId).toBe(entry.id)
    expect(offer?.originalDate).toBe('2026-05-31')
    expect(offer?.snapshot.cookSessionId).toBe('cook-1')
    expect(offer?.snapshot.signature).toContain('meal-1')
  })

  it('does not offer undo when the moved entry is no longer in the result', () => {
    expect(createMoveUndoOffer(result(true), 'missing-entry', '2026-05-31')).toBeNull()
  })

  it('creates the note undo offer with the moved date and signature', () => {
    const note: DayNote = {
      date: '2026-05-31',
      text: 'Essen gehen',
      createdAt: 10,
      updatedAt: 20,
    }
    const offer = createNoteUndoOffer(note, '2026-05-29')

    expect(offer.kind).toBe('note')
    expect(offer.currentDate).toBe('2026-05-31')
    expect(offer.originalDate).toBe('2026-05-29')
    expect(offer.snapshot.signature).toContain('Essen gehen')
  })
})
