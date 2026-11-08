import { describe, expect, it } from 'vitest'
import { dialogFooterMode, dishFooterMode } from './planningFooter'

describe('planning dialog footer modes', () => {
  it('always shows the discard prompt when a confirmation is pending', () => {
    // Regression: the picker used to hide the footer, which made a pending
    // discard confirmation invisible and swallowed all close actions.
    expect(dishFooterMode(true, true)).toBe('prompt')
    expect(dishFooterMode(false, true)).toBe('prompt')
    expect(dishFooterMode(true, false)).toBe('none')
    expect(dishFooterMode(false, false)).toBe('actions')
  })

  it('replaces the normal actions with the prompt in free dishes and comments', () => {
    expect(dialogFooterMode(true)).toBe('prompt')
    expect(dialogFooterMode(false)).toBe('actions')
  })

  it('never reports "none" for a pending confirmation', () => {
    for (const showingPicker of [true, false]) {
      expect(dishFooterMode(showingPicker, true)).not.toBe('none')
    }
  })
})
