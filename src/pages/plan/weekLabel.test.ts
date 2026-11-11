/*
 * Küchenrunde – relative week label tests
 * Copyright (C) 2026 openCook Web contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, expect, it } from 'vitest'
import { weekRelationLabel } from './weekLabel'

describe('relative week labels', () => {
  it('names the current, previous and next week clearly', () => {
    expect(weekRelationLabel(0)).toBe('Diese Woche')
    expect(weekRelationLabel(-1)).toBe('Vorige Woche')
    expect(weekRelationLabel(1)).toBe('Nächste Woche')
  })

  it('names the two neighbouring weeks without ambiguity', () => {
    expect(weekRelationLabel(-2)).toBe('Vorletzte Woche')
    expect(weekRelationLabel(2)).toBe('Übernächste Woche')
  })

  it('keeps a clear relative label for any further week', () => {
    expect(weekRelationLabel(-3)).toBe('Vor 3 Wochen')
    expect(weekRelationLabel(3)).toBe('In 3 Wochen')
    expect(weekRelationLabel(-12)).toBe('Vor 12 Wochen')
    expect(weekRelationLabel(8)).toBe('In 8 Wochen')
  })
})
