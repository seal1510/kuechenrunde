import { describe, expect, it } from 'vitest'
import {
  NO_PLANNING_OVERLAY,
  planningBackDate,
  planningSessionReducer,
  type PlanningOverlay,
} from './planningSession'

function reduce(
  actions: Parameters<typeof planningSessionReducer>[1][],
  initial: PlanningOverlay = NO_PLANNING_OVERLAY,
): PlanningOverlay {
  return actions.reduce(planningSessionReducer, initial)
}

describe('central planning overlay session', () => {
  it('moves chooser → recipe → back to the same chooser day', () => {
    const chooser = reduce([{ type: 'open-chooser', date: '2026-05-29' }])
    expect(chooser).toEqual({ kind: 'chooser', date: '2026-05-29' })

    const recipe = planningSessionReducer(chooser, {
      type: 'choose-recipe',
      date: '2026-05-29',
    })
    expect(recipe).toEqual({
      kind: 'create',
      date: '2026-05-29',
      backDate: '2026-05-29',
    })

    expect(planningSessionReducer(recipe, { type: 'back-to-chooser' })).toEqual({
      kind: 'chooser',
      date: '2026-05-29',
    })
  })

  it('switches repeatedly between free dish, comment and chooser without overlap', () => {
    let state = reduce([{ type: 'open-chooser', date: '2026-05-29' }])
    state = planningSessionReducer(state, {
      type: 'choose-free-dish',
      date: '2026-05-29',
    })
    expect(state.kind).toBe('free-create')
    state = planningSessionReducer(state, { type: 'back-to-chooser' })
    expect(state.kind).toBe('chooser')
    state = planningSessionReducer(state, {
      type: 'choose-note',
      date: '2026-05-29',
    })
    expect(state.kind).toBe('note')
    state = planningSessionReducer(state, { type: 'back-to-chooser' })
    expect(state.kind).toBe('chooser')
    state = planningSessionReducer(state, {
      type: 'choose-recipe',
      date: '2026-05-29',
    })
    expect(state.kind).toBe('create')
    state = planningSessionReducer(state, { type: 'close' })
    expect(state).toEqual(NO_PLANNING_OVERLAY)
  })

  it('never invents a back step for direct editing or direct comments', () => {
    const edit = planningSessionReducer(NO_PLANNING_OVERLAY, {
      type: 'open-edit',
      entryId: 'entry-1',
    })
    expect(planningBackDate(edit)).toBeNull()
    expect(planningSessionReducer(edit, { type: 'back-to-chooser' })).toEqual(edit)

    const note = planningSessionReducer(NO_PLANNING_OVERLAY, {
      type: 'open-note',
      date: '2026-05-29',
    })
    expect(note).toEqual({ kind: 'note-direct', date: '2026-05-29' })
    expect(planningBackDate(note)).toBeNull()
    expect(planningSessionReducer(note, { type: 'back-to-chooser' })).toEqual(note)
  })

  it('closes cleanly from every stage', () => {
    const stages: PlanningOverlay[] = [
      { kind: 'chooser', date: '2026-05-29' },
      { kind: 'create', date: '2026-05-29', backDate: '2026-05-29' },
      { kind: 'free-create', date: '2026-05-29', backDate: '2026-05-29' },
      { kind: 'note', date: '2026-05-29', backDate: '2026-05-29' },
      { kind: 'note-direct', date: '2026-05-29' },
      { kind: 'edit', entryId: 'entry-1' },
    ]

    for (const stage of stages) {
      expect(planningSessionReducer(stage, { type: 'close' })).toEqual(
        NO_PLANNING_OVERLAY,
      )
    }
  })
})
