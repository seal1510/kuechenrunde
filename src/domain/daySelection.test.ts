import { describe, expect, it } from 'vitest'
import type { MealPlanEntry } from '../types'
import { addDays } from './dates'
import {
  adjustDayServings,
  createDaySelection,
  dayChoicesForWeek,
  isDaySelected,
  isSelectionValid,
  selectedDates,
  selectionTotal,
  shiftWeekStart,
  toPlanDays,
  toggleDay,
  weekStartFor,
} from './daySelection'

function entry(
  id: string,
  date: string,
  servings: number,
): MealPlanEntry {
  return {
    id,
    date,
    slot: 'dinner',
    recipeId: 'r1',
    servings,
    position: 0,
    status: 'planned',
    auto: false,
    pinned: false,
    leftover: false,
    cooked: false,
    reasons: [],
    createdAt: 1,
    updatedAt: 1,
  }
}

describe('planning dialog day selection', () => {
  it('preselects exactly the clicked calendar day when creating', () => {
    const selection = createDaySelection([], '2026-05-29')

    expect(selectedDates(selection)).toEqual(['2026-05-29'])
    expect(isDaySelected(selection, '2026-05-29')).toBe(true)
    expect(selectionTotal(selection)).toBe(2)
    expect(isSelectionValid(selection)).toBe(true)
  })

  it('selects a day directly and deselects it on a second click', () => {
    const initial = createDaySelection([], '2026-05-29')
    const added = toggleDay(initial, '2026-05-31')
    expect(selectedDates(added)).toEqual(['2026-05-29', '2026-05-31'])
    expect(isDaySelected(added, '2026-05-31')).toBe(true)

    const removed = toggleDay(added, '2026-05-31')
    expect(selectedDates(removed)).toEqual(['2026-05-29'])
    expect(isDaySelected(removed, '2026-05-31')).toBe(false)
  })

  it('selects days across multiple calendar weeks and keeps them chronological', () => {
    let selection = createDaySelection([], '2026-05-29')
    selection = toggleDay(selection, '2026-06-02')
    selection = toggleDay(selection, '2026-05-27')

    expect(selectedDates(selection)).toEqual([
      '2026-05-27',
      '2026-05-29',
      '2026-06-02',
    ])
    expect(selectionTotal(selection)).toBe(6)
  })

  it('keeps the selection when the displayed week changes', () => {
    const weekStart = weekStartFor('2026-05-29', 3)
    let selection = createDaySelection([], '2026-05-29')
    selection = toggleDay(selection, '2026-06-05')

    const nextWeek = shiftWeekStart(weekStart, 1)
    const nextWeekChoices = dayChoicesForWeek(nextWeek, selection)
    expect(nextWeekChoices).toHaveLength(7)
    expect(nextWeekChoices.some((day) => day.selected)).toBe(true)

    const backAgain = shiftWeekStart(nextWeek, -1)
    expect(dayChoicesForWeek(backAgain, selection)[0]?.date).toBe(weekStart)
    expect(selectedDates(selection)).toEqual(['2026-05-29', '2026-06-05'])
  })

  it('never stores the same date twice', () => {
    let selection = createDaySelection(
      [
        entry('first', '2026-05-29', 2),
        entry('duplicate', '2026-05-29', 4),
      ],
      '2026-05-29',
    )

    expect(selectedDates(selection)).toEqual(['2026-05-29'])
    expect(new Set(selectedDates(selection)).size).toBe(selectedDates(selection).length)

    selection = toggleDay(selection, '2026-05-29')
    selection = toggleDay(selection, '2026-05-29')
    expect(selectedDates(selection)).toEqual(['2026-05-29'])
  })

  it('adds the example portions to six without inventing another day', () => {
    let selection = createDaySelection([], '2026-05-28')
    selection = adjustDayServings(selection, '2026-05-28', 0)
    selection = toggleDay(selection, '2026-05-30')
    selection = adjustDayServings(selection, '2026-05-30', -1)
    selection = toggleDay(selection, '2026-06-02')
    selection = adjustDayServings(selection, '2026-06-02', 1)

    expect(selectionTotal(selection)).toBe(6)
    expect(selectedDates(selection)).toEqual([
      '2026-05-28',
      '2026-05-30',
      '2026-06-02',
    ])
  })

  it('loads an existing multi-day plan unchanged and keeps its entry ids', () => {
    const initialEntries = [
      entry('friday', '2026-05-29', 2),
      entry('tuesday-next-week', '2026-06-02', 3),
    ]
    const selection = createDaySelection(initialEntries, '2026-05-29')

    expect(selectedDates(selection)).toEqual(['2026-05-29', '2026-06-02'])
    expect(toPlanDays(selection)).toEqual([
      { entryId: 'friday', date: '2026-05-29', servings: 2 },
      { entryId: 'tuesday-next-week', date: '2026-06-02', servings: 3 },
    ])
    expect(selectionTotal(selection)).toBe(5)
  })

  it('reuses an existing entry id after deselecting and reselecting its day', () => {
    const selection = createDaySelection(
      [entry('kept', '2026-05-29', 2)],
      '2026-05-29',
    )
    const removed = toggleDay(selection, '2026-05-29')
    const addedAgain = toggleDay(removed, '2026-05-29')

    expect(toPlanDays(addedAgain)[0]?.entryId).toBe('kept')
  })

  it('shows the configured week start in the dialog grid', () => {
    const selection = createDaySelection([], '2026-05-29')
    const thursdayWeek = weekStartFor('2026-05-29', 3)
    const sundayWeek = weekStartFor('2026-05-29', 6)

    expect(dayChoicesForWeek(thursdayWeek, selection)[0]?.date).toBe('2026-05-28')
    expect(dayChoicesForWeek(sundayWeek, selection)[0]?.date).toBe('2026-05-24')
    expect(dayChoicesForWeek(sundayWeek, selection)).toHaveLength(7)
    expect(dayChoicesForWeek(thursdayWeek, selection)[6]?.date).toBe(
      addDays(thursdayWeek, 6),
    )
  })
})
