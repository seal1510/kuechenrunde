import { describe, expect, it } from 'vitest'
import { durationMinutes, parseDuration } from './duration'
import { durationMinutes as plannerDurationMinutes } from '../domain/planner'

describe('shared duration parsing', () => {
  it('understands German hours instead of reading them as minutes', () => {
    expect(parseDuration('6 Stunden')).toEqual({ kind: 'single', minutes: 360 })
    expect(parseDuration('2 Std.')).toEqual({ kind: 'single', minutes: 120 })
    expect(parseDuration('1 Stunde')).toEqual({ kind: 'single', minutes: 60 })
    expect(durationMinutes('6 Stunden')).toBe(360)
  })

  it('understands half hours and mixed fractions', () => {
    expect(parseDuration('1/2 Stunde')).toEqual({ kind: 'single', minutes: 30 })
    expect(parseDuration('½ Stunde')).toEqual({ kind: 'single', minutes: 30 })
    expect(parseDuration('6 1/2 Stunden')).toEqual({ kind: 'single', minutes: 390 })
    expect(parseDuration('6½ Stunden')).toEqual({ kind: 'single', minutes: 390 })
    expect(parseDuration('6,5 Stunden')).toEqual({ kind: 'single', minutes: 390 })
    expect(parseDuration('1,5 Std.')).toEqual({ kind: 'single', minutes: 90 })
  })

  it('keeps explicit ranges as ranges', () => {
    expect(parseDuration('2-4 Stunden')).toEqual({
      kind: 'range',
      minMinutes: 120,
      maxMinutes: 240,
    })
    expect(parseDuration('2 bis 4 Stunden')).toEqual({
      kind: 'range',
      minMinutes: 120,
      maxMinutes: 240,
    })
    expect(parseDuration('2 Std. – 4 Std.')).toEqual({
      kind: 'range',
      minMinutes: 120,
      maxMinutes: 240,
    })
    // The problematic real-world value: it used to become "7 Min.".
    expect(parseDuration('6 1/2 - 7 Stunden')).toEqual({
      kind: 'range',
      minMinutes: 390,
      maxMinutes: 420,
    })
    expect(parseDuration('6½–7 Stunden')).toEqual({
      kind: 'range',
      minMinutes: 390,
      maxMinutes: 420,
    })
  })

  it('adds compound values and keeps ISO-8601 support', () => {
    expect(parseDuration('1 Std. 30 Min.')).toEqual({ kind: 'single', minutes: 90 })
    expect(parseDuration('1 Stunde 30 Minuten')).toEqual({ kind: 'single', minutes: 90 })
    expect(parseDuration('45 min')).toEqual({ kind: 'single', minutes: 45 })
    expect(parseDuration('PT40M')).toEqual({ kind: 'single', minutes: 40 })
    expect(parseDuration('PT1H10M')).toEqual({ kind: 'single', minutes: 70 })
    expect(parseDuration('P1DT2H')).toEqual({ kind: 'single', minutes: 1560 })
    expect(parseDuration('1:30 Std.')).toEqual({ kind: 'single', minutes: 90 })
    expect(parseDuration('1:30')).toEqual({ kind: 'single', minutes: 90 })
    // Bare integers in Mela time fields are minutes.
    expect(parseDuration('60')).toEqual({ kind: 'single', minutes: 60 })
    expect(parseDuration('25')).toEqual({ kind: 'single', minutes: 25 })
    expect(parseDuration('40')).toEqual({ kind: 'single', minutes: 40 })
    expect(parseDuration('ca. 60')).toBeNull()
  })

  it('returns null for unclear values so callers can show the original text', () => {
    expect(parseDuration('über Nacht')).toBeNull()
    expect(parseDuration('2-4')).toBeNull()
    expect(parseDuration('')).toBeNull()
    expect(parseDuration(null)).toBeNull()
    expect(durationMinutes('über Nacht')).toBeNull()
  })

  it('uses the same normalisation as the meal planner', () => {
    expect(plannerDurationMinutes('6 1/2 - 7 Stunden')).toBe(420)
    expect(plannerDurationMinutes('2-4 Stunden')).toBe(240)
    expect(plannerDurationMinutes('1/2 Stunde')).toBe(30)
    expect(plannerDurationMinutes('6 Stunden')).toBe(360)
  })
})
