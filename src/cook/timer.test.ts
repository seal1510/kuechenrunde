import { describe, expect, it } from 'vitest'
import {
  MAX_TIMER_DURATION_MS,
  MAX_TIMER_NAME_LENGTH,
  TIMER_STORAGE_READ_ERROR,
  formatSpokenDuration,
  formatTimerClock,
  normalizeTimerName,
  parseTimerDraft,
  parseTimerState,
  serializeTimerState,
  type CookTimer,
} from './timer'

describe('timer draft and formatting', () => {
  it('parses arbitrary minutes and seconds and trims the optional name', () => {
    expect(parseTimerDraft({ minutes: '1', seconds: '30', name: '  Tee  ' })).toEqual({
      ok: true,
      durationMs: 90_000,
      name: 'Tee',
    })
    expect(parseTimerDraft({ minutes: '', seconds: '30', name: '' })).toEqual({
      ok: true,
      durationMs: 30_000,
      name: '',
    })
    expect(parseTimerDraft({ minutes: '0', seconds: '1', name: '' })).toEqual({
      ok: true,
      durationMs: 1_000,
      name: '',
    })
  })

  it('rejects empty, malformed and overlong durations', () => {
    expect(parseTimerDraft({ minutes: '', seconds: '', name: '' }).ok).toBe(false)
    expect(parseTimerDraft({ minutes: '1', seconds: '60', name: '' }).ok).toBe(false)
    expect(parseTimerDraft({ minutes: '1.5', seconds: '0', name: '' }).ok).toBe(false)
    expect(parseTimerDraft({ minutes: '1440', seconds: '1', name: '' }).ok).toBe(false)
    expect(parseTimerDraft({ minutes: '1440', seconds: '0', name: '' }).ok).toBe(true)
  })

  it('formats a stable clock for seconds, minutes and hours', () => {
    expect(formatTimerClock(0)).toBe('00:00')
    expect(formatTimerClock(1_000)).toBe('00:01')
    expect(formatTimerClock(65_000)).toBe('01:05')
    expect(formatTimerClock(3_600_000)).toBe('1:00:00')
    expect(formatTimerClock(MAX_TIMER_DURATION_MS)).toBe('24:00:00')
    expect(formatTimerClock(-5_000)).toBe('00:00')
  })

  it('builds a spoken remaining time without announcing every tick', () => {
    expect(formatSpokenDuration(65_000)).toBe('1 Minute 5 Sekunden')
    expect(formatSpokenDuration(3_600_000)).toBe('1 Stunde')
    expect(formatSpokenDuration(0)).toBe('0 Sekunden')
  })

  it('limits and cleans optional names', () => {
    expect(normalizeTimerName('  Pasta\nmit   Sauce  ')).toBe('Pasta mit Sauce')
    expect(normalizeTimerName('x'.repeat(80))).toHaveLength(MAX_TIMER_NAME_LENGTH)
    expect(normalizeTimerName(42)).toBe('')
  })
})

function runningTimer(overrides: Partial<CookTimer> = {}): CookTimer {
  return {
    id: 'timer-1',
    name: 'Pasta',
    durationMs: 60_000,
    remainingMs: 60_000,
    endsAt: 1_060_000,
    status: 'running',
    ...overrides,
  }
}

describe('timer persistence parsing', () => {
  it('derives an expired state from a wall-clock end in the past', () => {
    const stored = JSON.stringify({
      version: 1,
      soundEnabled: true,
      timers: [runningTimer()],
    })
    const parsed = parseTimerState(stored, 1_060_001)
    expect(parsed.error).toBeNull()
    expect(parsed.state.timers[0]).toMatchObject({
      id: 'timer-1',
      status: 'expired',
      remainingMs: 0,
      endsAt: null,
    })
  })

  it('restores a running timer from its absolute end', () => {
    const stored = JSON.stringify({
      version: 1,
      soundEnabled: false,
      timers: [runningTimer()],
    })
    const parsed = parseTimerState(stored, 1_030_000)
    expect(parsed.state.soundEnabled).toBe(false)
    expect(parsed.state.timers[0]).toMatchObject({
      status: 'running',
      remainingMs: 30_000,
      endsAt: 1_060_000,
    })
  })

  it('round-trips paused timers and clamps invalid remaining values', () => {
    const paused = runningTimer({
      status: 'paused',
      remainingMs: 20_000,
      endsAt: null,
    })
    const raw = serializeTimerState({ timers: [paused], soundEnabled: true })
    expect(parseTimerState(raw, 2_000_000).state.timers[0]).toMatchObject({
      status: 'paused',
      remainingMs: 20_000,
    })

    const tooLarge = JSON.stringify({
      version: 1,
      timers: [{ ...paused, remainingMs: 9_999_999 }],
    })
    expect(parseTimerState(tooLarge, 2_000_000).state.timers[0]?.remainingMs).toBe(60_000)
  })

  it('drops malformed entries but keeps valid timers', () => {
    const raw = JSON.stringify({
      version: 1,
      soundEnabled: true,
      timers: [
        runningTimer(),
        { id: 'broken', durationMs: '60', status: 'running' },
        { ...runningTimer({ id: 'timer-2' }), durationMs: 0 },
      ],
    })
    const parsed = parseTimerState(raw, 1_010_000)
    expect(parsed.state.timers).toHaveLength(1)
    expect(parsed.error).toBe(TIMER_STORAGE_READ_ERROR)
  })

  it('treats broken, oversized and unknown records as unreadable', () => {
    expect(parseTimerState('{not json', 1).error).toBe(TIMER_STORAGE_READ_ERROR)
    expect(parseTimerState('x'.repeat(30_000), 1).error).toBe(TIMER_STORAGE_READ_ERROR)
    expect(
      parseTimerState(JSON.stringify({ version: 99, timers: [] }), 1).error,
    ).toBe(TIMER_STORAGE_READ_ERROR)
    expect(parseTimerState(null, 1)).toEqual({
      state: { timers: [], soundEnabled: true },
      error: null,
    })
  })
})
