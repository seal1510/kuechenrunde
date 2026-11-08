import { describe, expect, it } from 'vitest'
import { buildCalendarWindow } from '../../domain/calendar'
import { resolveCalendarSelection } from './calendarSelection'

describe('calendar day selection', () => {
  it('keeps a day the user picked inside the visible window', () => {
    const window = buildCalendarWindow('2026-05-29', 3, 2, 2)

    expect(
      resolveCalendarSelection(window.visibleDays, window.coreDays, '2026-05-29', '2026-05-26'),
    ).toBe('2026-05-26')
    expect(
      resolveCalendarSelection(window.visibleDays, window.coreDays, '2026-05-29', '2026-06-05'),
    ).toBe('2026-06-05')
  })

  it('prefers today while it belongs to the core week', () => {
    const window = buildCalendarWindow('2026-05-29', 3, 2, 2)

    expect(
      resolveCalendarSelection(window.visibleDays, window.coreDays, '2026-05-30', null),
    ).toBe('2026-05-30')
    expect(
      resolveCalendarSelection(window.visibleDays, window.coreDays, '2026-05-30', '2026-06-20'),
    ).toBe('2026-05-30')
  })

  it('falls back to the first core day after navigating away from today', () => {
    const window = buildCalendarWindow('2026-05-10', 3, 2, 2)

    expect(
      resolveCalendarSelection(window.visibleDays, window.coreDays, '2026-05-29', '2026-05-29'),
    ).toBe('2026-05-07')
    expect(window.coreDays).toHaveLength(7)
  })

  it('works with a non-Thursday week start across a year boundary', () => {
    const window = buildCalendarWindow('2026-12-31', 6, 2, 2)

    expect(window.coreStart).toBe('2026-12-27')
    expect(window.coreEnd).toBe('2027-01-02')
    expect(
      resolveCalendarSelection(window.visibleDays, window.coreDays, '2026-12-31', '2027-01-02'),
    ).toBe('2027-01-02')
    expect(
      resolveCalendarSelection(window.visibleDays, window.coreDays, '2026-12-31', '2026-12-20'),
    ).toBe('2026-12-31')
  })
})
