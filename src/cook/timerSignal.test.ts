import { describe, expect, it } from 'vitest'
import { createTimerSignal } from './timerSignal'

describe('optional timer signal', () => {
  it('stays silent when Web Audio is unavailable', () => {
    const signal = createTimerSignal()
    expect(() => {
      signal.prime()
      signal.play()
      signal.dispose()
    }).not.toThrow()
  })
})
