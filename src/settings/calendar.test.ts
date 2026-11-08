import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../db'
import {
  DEFAULT_OVERLAP_AFTER,
  DEFAULT_OVERLAP_BEFORE,
  DEFAULT_WEEK_START_DAY,
} from '../domain/calendar'
import {
  calendarSettingsFromRows,
  getCalendarSettings,
  setCalendarSettings,
} from './calendar'

beforeEach(async () => {
  await db.settings.clear()
})

describe('calendar settings', () => {
  it('uses Thursday and two overlap days as defaults', () => {
    expect(calendarSettingsFromRows([])).toEqual({
      weekStartDay: DEFAULT_WEEK_START_DAY,
      overlapBefore: DEFAULT_OVERLAP_BEFORE,
      overlapAfter: DEFAULT_OVERLAP_AFTER,
    })
    expect(DEFAULT_WEEK_START_DAY).toBe(3)
    expect(DEFAULT_OVERLAP_BEFORE).toBe(2)
    expect(DEFAULT_OVERLAP_AFTER).toBe(2)
  })

  it('reads persisted values from the existing settings table', async () => {
    await db.settings.bulkPut([
      { key: 'weekStartDay', value: 6 },
      { key: 'overlapBefore', value: 0 },
      { key: 'overlapAfter', value: 7 },
    ])
    expect(await getCalendarSettings()).toEqual({
      weekStartDay: 6,
      overlapBefore: 0,
      overlapAfter: 7,
    })
  })

  it('persists partial changes and clamps invalid values', async () => {
    await setCalendarSettings({ weekStartDay: 0, overlapBefore: 1 })
    expect(await getCalendarSettings()).toEqual({
      weekStartDay: 0,
      overlapBefore: 1,
      overlapAfter: DEFAULT_OVERLAP_AFTER,
    })

    await setCalendarSettings({
      weekStartDay: 9,
      overlapBefore: -3,
      overlapAfter: 99,
    })
    expect(await getCalendarSettings()).toEqual({
      weekStartDay: 2,
      overlapBefore: 0,
      overlapAfter: 7,
    })
  })
})
