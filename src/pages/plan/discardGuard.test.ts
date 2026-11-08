import { describe, expect, it } from 'vitest'
import {
  draftSignature,
  isDraftDirty,
  requestDiscard,
  resolveDiscard,
} from './discardGuard'

describe('dialog-local discard protection', () => {
  it('detects changed eat days and portions through the draft signature', () => {
    const initial = draftSignature({
      recipeId: 'r1',
      days: [
        { date: '2026-05-29', servings: 2 },
        { date: '2026-06-02', servings: 3 },
      ],
    })

    expect(isDraftDirty(initial, initial)).toBe(false)
    expect(
      isDraftDirty(
        initial,
        draftSignature({
          recipeId: 'r1',
          days: [
            { date: '2026-05-29', servings: 4 },
            { date: '2026-06-02', servings: 3 },
          ],
        }),
      ),
    ).toBe(true)
    expect(
      isDraftDirty(
        initial,
        draftSignature({
          recipeId: 'r1',
          days: [{ date: '2026-05-29', servings: 2 }],
        }),
      ),
    ).toBe(true)
  })

  it('asks before dismissing a dirty draft and closes clean drafts directly', () => {
    expect(requestDiscard(false)).toEqual({ prompt: false, proceed: true })
    expect(requestDiscard(true)).toEqual({ prompt: true, proceed: false })
  })

  it('only runs the remembered action after the discard was confirmed', () => {
    expect(resolveDiscard('keep')).toEqual({ prompt: false, proceed: false })
    expect(resolveDiscard('discard')).toEqual({ prompt: false, proceed: true })
  })
})
