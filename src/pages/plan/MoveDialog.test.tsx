/*
 * Küchenrunde – mobile move dialog tests
 * Copyright (C) 2026 openCook Web contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MoveDialog } from './MoveDialog'

function renderMove(initialDate: string) {
  return renderToStaticMarkup(
    <MoveDialog
      initialDate={initialDate}
      heading="Gericht verschieben"
      subtitle="Testgericht"
      weekStartDay={3}
      busy={false}
      error={null}
      onMove={() => undefined}
      onClose={() => undefined}
    />,
  )
}

beforeEach(() => {
  // Wednesday, 11.11.2026 – the reference date from the family rhythm.
  vi.useFakeTimers()
  vi.setSystemTime(new Date(2026, 10, 11, 12, 0, 0))
})

afterEach(() => {
  vi.useRealTimers()
})

describe('mobile move dialog week selection', () => {
  it('opens in the dish week and shows the fixed Thursday–Wednesday range', () => {
    const html = renderMove('2026-11-11')

    expect(html).toContain('Gericht verschieben')
    expect(html).toContain('Diese Woche')
    expect(html).toContain('05.11. – 11.11.2026')
    expect(html).toContain('Vorige Woche')
    expect(html).toContain('Aktuelle Woche')
    expect(html).toContain('Nächste Woche')
    expect(html).toContain('Zielwoche wählen, dann den Zieltag antippen.')
  })

  it('shows exactly seven target days in Thursday-to-Wednesday order', () => {
    const html = renderMove('2026-11-11')

    expect(html.match(/class="dish-day-choice/g)).toHaveLength(7)
    expect(html).toContain('Do')
    expect(html).toContain('Fr')
    expect(html).toContain('Sa')
    expect(html).toContain('So')
    expect(html).toContain('Mo')
    expect(html).toContain('Di')
    expect(html).toContain('Mi')
    expect(html).toContain('05.11.')
    expect(html).toContain('11.11.')
    expect(html).toContain('dish-day-choice is-current')
    expect(html).toContain('ist bereits geplant')
    expect(html).toContain('Aktuell')
  })

  it('shows the next week label when the dish is in the following week', () => {
    const html = renderMove('2026-11-13')

    expect(html).toContain('Nächste Woche')
    expect(html).toContain('12.11. – 18.11.2026')
    expect(html.match(/dish-day-choice is-current/g)).toHaveLength(1)
  })

  it('still offers an unambiguous label and current-week jump for far target weeks', () => {
    const html = renderMove('2026-12-02')

    expect(html).toContain('In 3 Wochen')
    expect(html).toContain('26.11. – 02.12.2026')
    expect(html).toContain('Aktuelle Woche')
  })
})
