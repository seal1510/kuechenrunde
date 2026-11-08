import { describe, expect, it } from 'vitest'
import {
  effectiveDuration,
  effectiveDurationMinutes,
  formatDuration,
  formatMinutes,
  formatServings,
} from './format'

describe('readable recipe units', () => {
  it('formats ISO and human durations', () => {
    expect(formatDuration('PT40M')).toBe('40 Min.')
    expect(formatDuration('PT1H10M')).toBe('1 Std. 10 Min.')
    expect(formatDuration('45 min')).toBe('45 Min.')
    expect(formatDuration('1 Std 30 Min')).toBe('1 Std. 30 Min.')
    expect(formatMinutes(90)).toBe('1 Std. 30 Min.')
  })

  it('formats German hour values correctly', () => {
    expect(formatDuration('6 Stunden')).toBe('6 Std.')
    expect(formatDuration('1/2 Stunde')).toBe('30 Min.')
    expect(formatDuration('½ Stunde')).toBe('30 Min.')
    expect(formatDuration('6 1/2 Stunden')).toBe('6 Std. 30 Min.')
    expect(formatDuration('6½ Stunden')).toBe('6 Std. 30 Min.')
    expect(formatDuration('6,5 Stunden')).toBe('6 Std. 30 Min.')
  })

  it('shows ranges as ranges instead of picking a single value', () => {
    expect(formatDuration('2-4 Stunden')).toBe('2–4 Std.')
    expect(formatDuration('6 1/2 - 7 Stunden')).toBe('6,5–7 Std.')
    expect(formatDuration('6½–7 Stunden')).toBe('6,5–7 Std.')
  })

  it('keeps unclear input as original text', () => {
    expect(formatDuration('über Nacht')).toBe('über Nacht')
    expect(formatDuration('ca. 60')).toBe('ca. 60')
  })

  it('shows bare Mela minute values as minutes', () => {
    expect(formatDuration('60')).toBe('1 Std.')
    expect(formatDuration('25')).toBe('25 Min.')
    expect(formatDuration('40')).toBe('40 Min.')
    expect(effectiveDuration({ totalTime: '60', prepTime: '', cookTime: '' })).toBe('1 Std.')
  })

  it('computes sortable minutes from the same values', () => {
    expect(effectiveDurationMinutes({ totalTime: '60', prepTime: '', cookTime: '' })).toBe(60)
    expect(effectiveDurationMinutes({ totalTime: '', prepTime: '20', cookTime: '5' })).toBe(25)
    expect(effectiveDurationMinutes({ totalTime: '', prepTime: '20', cookTime: '' })).toBe(20)
    expect(
      effectiveDurationMinutes({ totalTime: '', prepTime: '20 min', cookTime: 'über Nacht' }),
    ).toBeNull()
    expect(effectiveDurationMinutes({ totalTime: 'über Nacht', prepTime: '20', cookTime: '5' })).toBeNull()
  })

  it('falls back to prep plus cook', () => {
    expect(effectiveDuration({ totalTime: '', prepTime: 'PT10M', cookTime: 'PT20M' })).toBe('30 Min.')
    expect(effectiveDuration({ totalTime: '', prepTime: '1/2 Stunde', cookTime: '2-4 Stunden' })).toBe(
      '2,5–4,5 Std.',
    )
  })

  it('does not invent a total when the stored total is unclear', () => {
    expect(
      effectiveDuration({ totalTime: 'über Nacht', prepTime: '10 Min.', cookTime: '20 Min.' }),
    ).toBe('über Nacht')
  })

  it('adds understandable serving units', () => {
    expect(formatServings('4', 4)).toBe('4 Portionen')
    expect(formatServings('1', 1)).toBe('1 Portion')
    expect(formatServings('2-3', 2)).toBe('2–3 Portionen')
    expect(formatServings('4 Portionen', 4)).toBe('4 Portionen')
    expect(formatServings('', 2)).toBe('2 Portionen')
  })
})
