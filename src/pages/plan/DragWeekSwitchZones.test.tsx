/*
 * Küchenrunde – temporary drag week zones tests
 * Copyright (C) 2026 openCook Web contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { createRef } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { DragWeekSwitchZones } from './DragWeekSwitchZones'

function render(activeDirection: -1 | 1 | null) {
  return renderToStaticMarkup(
    <DragWeekSwitchZones
      previousRef={createRef<HTMLDivElement>()}
      nextRef={createRef<HTMLDivElement>()}
      activeDirection={activeDirection}
      holdMs={650}
      holdKey={2}
    />,
  )
}

describe('DragWeekSwitchZones', () => {
  it('renders both labelled zones only as visual drag targets', () => {
    const html = render(null)

    expect(html).toContain('calendar-week-drop-zones')
    expect(html).toContain('← Vorige Woche')
    expect(html).toContain('Nächste Woche →')
    expect(html.match(/Gedrückt halten/g)).toHaveLength(2)
    expect(html).toContain('data-drag-week-direction="-1"')
    expect(html).toContain('data-drag-week-direction="1"')
    expect(html.match(/calendar-week-drop-progress/g)).toHaveLength(2)
    expect(html).not.toContain('is-armed')
  })

  it('marks exactly the zone currently held', () => {
    const next = render(1)
    const previous = render(-1)

    expect(next.match(/is-armed/g)).toHaveLength(1)
    expect(next).toMatch(
      /calendar-week-drop-zone is-armed[^>]*data-drag-week-direction="1"/,
    )
    expect(previous).toMatch(
      /calendar-week-drop-zone is-armed[^>]*data-drag-week-direction="-1"/,
    )
  })
})
