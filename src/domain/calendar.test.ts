import { describe, expect, it } from 'vitest'
import type { MealPlanEntry } from '../types'
import {
  PLANNING_WEEK_START_DAY,
  buildCalendarDays,
  buildCalendarLayout,
  buildCalendarWindow,
  buildPlanningWeek,
  planEntriesForDay,
  totalAddActions,
} from './calendar'
import { addDays, weekdayIndex } from './dates'
import { shoppingWeek } from './shopping'

function entry(
  id: string,
  date: string,
  slot: string,
  position: number,
): MealPlanEntry {
  return {
    id,
    date,
    slot,
    recipeId: 'r1',
    servings: 2,
    position,
    status: 'planned',
    auto: false,
    pinned: false,
    leftover: false,
    cooked: false,
    reasons: [],
    createdAt: position + 1,
    updatedAt: position + 1,
  }
}

const WEEK = [
  '2026-05-25',
  '2026-05-26',
  '2026-05-27',
  '2026-05-28',
  '2026-05-29',
  '2026-05-30',
  '2026-05-31',
]

describe('day calendar model', () => {
  it('gives every day exactly one add action, including empty days', () => {
    const days = buildCalendarDays(WEEK, [
      entry('m1', '2026-05-25', 'dinner', 0),
      entry('m2', '2026-05-26', 'breakfast', 0),
    ])

    expect(days).toHaveLength(7)
    expect(days.every((day) => day.addActions === 1)).toBe(true)
    expect(totalAddActions(days)).toBe(7)
    expect(days[2]?.empty).toBe(true)
    expect(days[2]?.addActions).toBe(1)
    expect(days[2]?.entries).toEqual([])
  })

  it('shows legacy breakfast, lunch and dinner entries as normal day dishes', () => {
    const entries = [
      entry('breakfast', '2026-05-25', 'breakfast', 0),
      entry('lunch', '2026-05-25', 'lunch', 1),
      entry('dinner', '2026-05-25', 'dinner', 2),
      entry('second-dinner', '2026-05-25', 'dinner', 3),
    ]

    const days = buildCalendarDays(WEEK, entries)
    const monday = days[0]!

    expect(monday.empty).toBe(false)
    expect(monday.addActions).toBe(1)
    expect(monday.entries.map((item) => item.id)).toEqual([
      'breakfast',
      'lunch',
      'dinner',
      'second-dinner',
    ])
  })

  it('keeps several dishes of the same day visible and editable as one list', () => {
    const entries = [
      entry('a', '2026-05-27', 'lunch', 1),
      entry('b', '2026-05-27', 'dinner', 0),
    ]
    const day = planEntriesForDay(entries, '2026-05-27')

    expect(day.map((item) => item.id)).toEqual(['b', 'a'])
  })
})

describe('configurable calendar window', () => {
  it('starts the seven-day core week on every weekday', () => {
    const anchor = '2026-05-29'

    for (let weekStartDay = 0; weekStartDay < 7; weekStartDay += 1) {
      const window = buildCalendarWindow(anchor, weekStartDay, 0, 0)
      expect(weekdayIndex(window.coreStart)).toBe(weekStartDay)
      expect(window.coreDays).toHaveLength(7)
      expect(window.coreEnd).toBe(addDays(window.coreStart, 6))
      expect(window.coreDays).toContain(anchor)
    }
  })

  it('adds exactly two overlap days before and after the core week', () => {
    const window = buildCalendarWindow('2026-05-29', 3, 2, 2)

    expect(window.coreStart).toBe('2026-05-28')
    expect(window.coreEnd).toBe('2026-06-03')
    expect(window.beforeDays).toEqual(['2026-05-26', '2026-05-27'])
    expect(window.afterDays).toEqual(['2026-06-04', '2026-06-05'])
    expect(window.visibleDays).toHaveLength(11)
    expect(new Set(window.visibleDays).size).toBe(window.visibleDays.length)
    expect(window.visibleDays[2]).toBe(window.coreStart)
    expect(window.visibleDays[8]).toBe(window.coreEnd)
  })

  it('crosses month and year boundaries in the window', () => {
    const window = buildCalendarWindow('2026-12-31', 3, 2, 2)

    expect(window.coreStart).toBe('2026-12-31')
    expect(window.coreEnd).toBe('2027-01-06')
    expect(window.beforeDays).toEqual(['2026-12-29', '2026-12-30'])
    expect(window.afterDays).toEqual(['2027-01-07', '2027-01-08'])
  })

  it('marks core and overlap days in the day model', () => {
    const window = buildCalendarWindow('2026-05-29', 3, 1, 1)
    const core = new Set(window.coreDays)
    const days = buildCalendarDays(window.visibleDays, [], core)

    expect(days).toHaveLength(9)
    expect(days[0]?.core).toBe(false)
    expect(days[1]?.core).toBe(true)
    expect(days[8]?.core).toBe(false)
  })

  it('keeps seven consecutive core days across a DST change', () => {
    // Europe/Berlin switches to summer time on 2026-03-29 (Sunday).
    const window = buildCalendarWindow('2026-03-29', 6, 1, 1)

    expect(window.coreDays).toEqual([
      '2026-03-29',
      '2026-03-30',
      '2026-03-31',
      '2026-04-01',
      '2026-04-02',
      '2026-04-03',
      '2026-04-04',
    ])
    expect(window.beforeDays).toEqual(['2026-03-28'])
    expect(window.afterDays).toEqual(['2026-04-05'])
  })
})

describe('calendar layout render model', () => {
  it('always renders exactly seven main days for every overlap setting', () => {
    for (let overlap = 0; overlap <= 7; overlap += 1) {
      const window = buildCalendarWindow('2026-05-29', 3, overlap, overlap)
      const layout = buildCalendarLayout(window, [])

      expect(layout.main).toHaveLength(7)
      expect(layout.main.map((day) => day.date)).toEqual(window.coreDays)
      expect(layout.main.every((day) => day.core)).toBe(true)
      expect(layout.before).toHaveLength(overlap)
      expect(layout.after).toHaveLength(overlap)
      expect(layout.before.every((day) => day.core === false)).toBe(true)
      expect(layout.after.every((day) => day.core === false)).toBe(true)
    }
  })

  it('keeps overlap days in their own rows and still shows planned dishes there', () => {
    const window = buildCalendarWindow('2026-05-29', 3, 2, 2)
    const autoEntry = { ...entry('auto-before', '2026-05-26', 'dinner', 0), auto: true }
    const layout = buildCalendarLayout(window, [
      autoEntry,
      entry('core', '2026-05-28', 'dinner', 0),
      entry('after', '2026-06-04', 'dinner', 0),
    ])

    expect(layout.before.map((day) => day.date)).toEqual(['2026-05-26', '2026-05-27'])
    expect(layout.after.map((day) => day.date)).toEqual(['2026-06-04', '2026-06-05'])
    expect(layout.before[0]?.entries.map((item) => item.id)).toEqual(['auto-before'])
    expect(layout.main[0]?.entries.map((item) => item.id)).toEqual(['core'])
    expect(layout.after[0]?.entries.map((item) => item.id)).toEqual(['after'])
    expect(layout.main).toHaveLength(7)
  })

  it('honours a non-Thursday week start without changing the main row size', () => {
    const window = buildCalendarWindow('2026-05-29', 6, 7, 7)
    const layout = buildCalendarLayout(window, [])

    expect(window.coreStart).toBe('2026-05-24')
    expect(layout.main[0]?.date).toBe('2026-05-24')
    expect(layout.main[6]?.date).toBe('2026-05-30')
    expect(layout.main).toHaveLength(7)
    expect(layout.before).toHaveLength(7)
    expect(layout.after).toHaveLength(7)
  })
})

describe('fixed Thursday–Wednesday planning week', () => {
  it('starts every planning week on Thursday and contains exactly seven days', () => {
    expect(PLANNING_WEEK_START_DAY).toBe(3)

    const window = buildPlanningWeek('2026-11-11')

    expect(window.coreStart).toBe('2026-11-05')
    expect(window.coreEnd).toBe('2026-11-11')
    expect(window.coreDays).toHaveLength(7)
    expect(window.coreDays[0]).toBe('2026-11-05')
    expect(window.coreDays[6]).toBe('2026-11-11')
    expect(window.beforeDays).toEqual([])
    expect(window.afterDays).toEqual([])
    expect(window.visibleDays).toEqual(window.coreDays)
    expect(weekdayIndex(window.coreStart)).toBe(3)
  })

  it('moves exactly one week for previous and next and never overlaps', () => {
    const previous = buildPlanningWeek('2026-11-04')
    const current = buildPlanningWeek('2026-11-11')
    const next = buildPlanningWeek('2026-11-18')

    expect(previous.coreStart).toBe('2026-10-29')
    expect(previous.coreEnd).toBe('2026-11-04')
    expect(next.coreStart).toBe('2026-11-12')
    expect(next.coreEnd).toBe('2026-11-18')
    expect(new Set([...previous.coreDays, ...current.coreDays, ...next.coreDays]).size).toBe(21)
    expect(previous.coreDays.some((day) => current.coreDays.includes(day))).toBe(false)
    expect(current.coreDays.some((day) => next.coreDays.includes(day))).toBe(false)
  })

  it('uses the Thursday week when the anchor itself is Thursday', () => {
    const window = buildPlanningWeek('2026-11-12')

    expect(window.coreStart).toBe('2026-11-12')
    expect(window.coreEnd).toBe('2026-11-18')
    expect(window.coreDays).toHaveLength(7)
  })

  it('crosses month and year boundaries without shifting days', () => {
    const window = buildPlanningWeek('2026-12-31')

    expect(window.coreStart).toBe('2026-12-31')
    expect(window.coreEnd).toBe('2027-01-06')
    expect(window.coreDays).toEqual([
      '2026-12-31',
      '2027-01-01',
      '2027-01-02',
      '2027-01-03',
      '2027-01-04',
      '2027-01-05',
      '2027-01-06',
    ])
  })

  it('keeps seven consecutive local dates across the DST change', () => {
    const window = buildPlanningWeek('2026-03-29')

    expect(window.coreStart).toBe('2026-03-26')
    expect(window.coreEnd).toBe('2026-04-01')
    expect(window.coreDays).toHaveLength(7)
    expect(window.coreDays).toEqual([
      '2026-03-26',
      '2026-03-27',
      '2026-03-28',
      '2026-03-29',
      '2026-03-30',
      '2026-03-31',
      '2026-04-01',
    ])
  })

  it('renders only the seven main days in the fixed week layout', () => {
    const window = buildPlanningWeek('2026-11-11')
    const layout = buildCalendarLayout(window, [])

    expect(layout.main.map((day) => day.date)).toEqual(window.coreDays)
    expect(layout.main).toHaveLength(7)
    expect(layout.before).toEqual([])
    expect(layout.after).toEqual([])
  })

  it('uses the same Thursday period boundary as the shopping list', () => {
    for (const date of ['2026-11-11', '2026-11-12', '2026-12-31', '2027-01-01']) {
      expect(buildPlanningWeek(date).coreStart).toBe(
        shoppingWeek(date, PLANNING_WEEK_START_DAY).start,
      )
    }
  })
})
