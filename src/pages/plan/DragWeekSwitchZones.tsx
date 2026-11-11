/*
 * Küchenrunde – temporary week switch zones during a phone drag
 * Copyright (C) 2026 openCook Web contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The zones are purely visual hit areas. They use pointer-events: none, so the
 * finger continues to own the drag, and the PlanPage hit-tests their measured
 * rectangles. They exist only while a drag is active.
 */

import type { CSSProperties, RefObject } from 'react'
import type { DragWeekDirection } from './dragWeekSwitch'

export interface DragWeekSwitchZonesProps {
  previousRef: RefObject<HTMLDivElement | null>
  nextRef: RefObject<HTMLDivElement | null>
  activeDirection: DragWeekDirection | null
  holdMs: number
  /** Changes on every dwell so the progress animation starts again. */
  holdKey: number
}

function Zone({
  zoneRef,
  direction,
  active,
  label,
  holdKey,
}: {
  zoneRef: RefObject<HTMLDivElement | null>
  direction: DragWeekDirection
  active: boolean
  label: string
  holdKey: number
}) {
  return (
    <div
      ref={zoneRef}
      className={`calendar-week-drop-zone${active ? ' is-armed' : ''}`}
      data-drag-week-direction={direction}
      aria-hidden="true"
    >
      <span className="calendar-week-drop-label">{label}</span>
      <span className="calendar-week-drop-hint">Gedrückt halten</span>
      <span
        key={`${direction}-${holdKey}`}
        className="calendar-week-drop-progress"
        aria-hidden="true"
      />
    </div>
  )
}

export function DragWeekSwitchZones({
  previousRef,
  nextRef,
  activeDirection,
  holdMs,
  holdKey,
}: DragWeekSwitchZonesProps) {
  const style = {
    '--drag-week-hold-ms': `${holdMs}ms`,
  } as CSSProperties

  return (
    <div className="calendar-week-drop-zones" style={style} aria-hidden="true">
      <Zone
        zoneRef={previousRef}
        direction={-1}
        active={activeDirection === -1}
        label="← Vorige Woche"
        holdKey={holdKey}
      />
      <Zone
        zoneRef={nextRef}
        direction={1}
        active={activeDirection === 1}
        label="Nächste Woche →"
        holdKey={holdKey}
      />
    </div>
  )
}
