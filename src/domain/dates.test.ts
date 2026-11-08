import { describe, expect, it } from 'vitest'
import {
  addDays,
  currentWeek,
  daysBetween,
  planningDays,
  startOfWeek,
  todayKey,
  weekdayIndex,
} from './dates'

describe('local date handling', () => {
  it('finds the Monday–Sunday week around a date', () => {
    const monday = '2026-05-25'
    const week = currentWeek(monday)
    expect(week[0]).toBe('2026-05-25')
    expect(week[6]).toBe('2026-05-31')
    expect(weekdayIndex(monday)).toBe(0)
    expect(startOfWeek('2026-05-28')).toBe(monday)
  })

  it('crosses a year boundary without shifting a day', () => {
    const week = currentWeek('2026-12-31')
    expect(week[0]).toBe('2026-12-28')
    expect(week[6]).toBe('2027-01-03')
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
  })

  it('plans only today and the remaining days of the week', () => {
    expect(planningDays('2026-05-25')).toEqual([
      '2026-05-25',
      '2026-05-26',
      '2026-05-27',
      '2026-05-28',
      '2026-05-29',
      '2026-05-30',
      '2026-05-31',
    ])
    expect(planningDays('2026-05-27')).toHaveLength(5)
    expect(planningDays('2026-05-31')).toEqual(['2026-05-31'])
  })

  it('handles leap years', () => {
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29')
    expect(addDays('2028-02-28', 2)).toBe('2028-03-01')
  })

  it('counts calendar days across a DST change', () => {
    // Europe/Berlin switches to summer time on 2026-03-29.
    expect(daysBetween('2026-03-28', '2026-03-30')).toBe(2)
  })

  it('uses the local calendar date, not UTC', () => {
    const lateNewYear = new Date(2026, 11, 31, 23, 30)
    expect(todayKey(lateNewYear)).toBe('2026-12-31')
  })
})
