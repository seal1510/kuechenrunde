import { describe, expect, it } from 'vitest'
import {
  GROUP_COLOR_COUNT,
  groupColorIndex,
  groupThemeFor,
  isGroupHighlighted,
} from './groupColor'

describe('deterministic group colours', () => {
  it('assigns the same colour to the same cooking event id', () => {
    expect(groupColorIndex('cook-alpha')).toBe(groupColorIndex('cook-alpha'))
    expect(groupThemeFor({ cookSessionId: 'cook-alpha' }, 3)).toEqual({
      colorIndex: groupColorIndex('cook-alpha'),
      sessionId: 'cook-alpha',
    })
  })

  it('keeps the index inside the small palette for arbitrary ids', () => {
    for (const id of ['a', 'cook-1', 'session-2026-05-29', '']) {
      const index = groupColorIndex(id)
      expect(index).toBeGreaterThanOrEqual(0)
      expect(index).toBeLessThan(GROUP_COLOR_COUNT)
    }
  })

  it('never groups single dishes or entries without a cooking event', () => {
    expect(groupThemeFor({ cookSessionId: 'cook-alpha' }, 1)).toBeNull()
    expect(groupThemeFor({ cookSessionId: null }, 3)).toBeNull()
    expect(groupThemeFor({ cookSessionId: undefined }, 3)).toBeNull()
  })

  it('keeps different sessions of the same recipe separate', () => {
    const first = groupThemeFor({ cookSessionId: 'cook-morning' }, 2)
    const second = groupThemeFor({ cookSessionId: 'cook-evening' }, 2)

    expect(first?.sessionId).toBe('cook-morning')
    expect(second?.sessionId).toBe('cook-evening')
    expect(first?.sessionId).not.toBe(second?.sessionId)
  })

  it('is independent from dates, weeks and sorting order', () => {
    const before = groupColorIndex('cook-stable')
    // Later weeks, reversed entry order and drag operations never feed any of
    // these values into the hash: only the cooking-event id matters.
    expect(groupColorIndex('cook-stable')).toBe(before)
    expect(groupThemeFor({ cookSessionId: 'cook-stable' }, 4)?.colorIndex).toBe(before)
  })

  it('highlights only cards with the same cooking event id', () => {
    const first = groupThemeFor({ cookSessionId: 'cook-alpha' }, 2)
    const second = groupThemeFor({ cookSessionId: 'cook-beta' }, 2)

    expect(isGroupHighlighted(first, 'cook-alpha')).toBe(true)
    expect(isGroupHighlighted(second, 'cook-alpha')).toBe(false)
    expect(isGroupHighlighted(first, null)).toBe(false)
    expect(isGroupHighlighted(null, 'cook-alpha')).toBe(false)
  })
})
