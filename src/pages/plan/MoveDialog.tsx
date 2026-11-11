/*
 * openCook Web
 * Copyright (C) 2026 openCook Web contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Keyboard-accessible alternative to pointer dragging, for dishes and notes.
 * It uses the shared planning panel and the same week/day grid semantics.
 */

import { useState } from 'react'
import {
  addDays,
  formatDayLabel,
  formatWeekRange,
  parseDateKey,
  todayKey,
  weekOffset,
  weekdayShort,
} from '../../domain/dates'
import { shiftWeekStart, weekStartFor } from '../../domain/daySelection'
import { PlanningPanel } from './PlanningPanel'
import { weekRelationLabel } from './weekLabel'

export interface MoveDialogProps {
  initialDate: string
  heading: string
  subtitle?: string
  weekStartDay: number
  busy: boolean
  error: string | null
  onMove: (targetDate: string) => void
  onClose: () => void
}

export function MoveDialog({
  initialDate,
  heading,
  subtitle,
  weekStartDay,
  busy,
  error,
  onMove,
  onClose,
}: MoveDialogProps) {
  const [weekStart, setWeekStart] = useState(() =>
    weekStartFor(initialDate, weekStartDay),
  )
  const today = todayKey()
  const weekRelation = weekRelationLabel(
    weekOffset(weekStart, today, weekStartDay),
  )
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = addDays(weekStart, index)
    const { day, month } = parseDateKey(date)
    return {
      date,
      weekday: weekdayShort(date),
      day,
      month,
      current: date === initialDate,
    }
  })

  return (
    <PlanningPanel
      title={heading}
      subtitle={subtitle}
      onRequestClose={() => {
        if (!busy) onClose()
      }}
      closeDisabled={busy}
      className="move-dialog"
      footer={
        <div className="plan-panel-actions">
          <div className="plan-panel-actions-primary">
            <button
              type="button"
              className="button"
              onClick={onClose}
              disabled={busy}
            >
              Abbrechen
            </button>
          </div>
        </div>
      }
    >
      <p className="move-dialog-hint">
        Zielwoche wählen, dann den Zieltag antippen.
      </p>

      <div className="dish-weeknav" role="group" aria-label="Zielwoche">
        <button
          type="button"
          className="button quiet dish-week-arrow"
          aria-label="Vorherige Woche"
          onClick={() => setWeekStart((current) => shiftWeekStart(current, -1))}
          disabled={busy}
        >
          <span className="dish-week-symbol" aria-hidden="true">
            ‹
          </span>
          <span className="dish-week-label">← Vorige Woche</span>
        </button>
        <button
          type="button"
          className="button quiet dish-week-today"
          onClick={() => setWeekStart(weekStartFor(today, weekStartDay))}
          disabled={busy}
        >
          Aktuelle Woche
        </button>
        <span className="dish-week-range" aria-live="polite">
          <span className="dish-week-relation">{weekRelation}</span>
          <span className="dish-week-range-text">{formatWeekRange(weekStart)}</span>
        </span>
        <button
          type="button"
          className="button quiet dish-week-arrow"
          aria-label="Nächste Woche"
          onClick={() => setWeekStart((current) => shiftWeekStart(current, 1))}
          disabled={busy}
        >
          <span className="dish-week-symbol" aria-hidden="true">
            ›
          </span>
          <span className="dish-week-label">Nächste Woche →</span>
        </button>
      </div>

      <div className="dish-day-grid" role="group" aria-label="Zieltag auswählen">
        {days.map((day) => (
          <button
            key={day.date}
            type="button"
            className={`dish-day-choice${day.current ? ' is-current' : ''}`}
            aria-label={
              day.current
                ? `${formatDayLabel(day.date)} ist bereits geplant`
                : `${formatDayLabel(day.date)} als Ziel wählen`
            }
            disabled={busy || day.current}
            onClick={() => onMove(day.date)}
          >
            <span className="dish-day-weekday">{day.weekday}</span>
            <span className="dish-day-date">
              {String(day.day).padStart(2, '0')}.{String(day.month).padStart(2, '0')}.
            </span>
            {day.current ? (
              <>
                <span className="dish-day-check" aria-hidden="true">
                  •
                </span>
                <span className="dish-day-current-label" aria-hidden="true">
                  Aktuell
                </span>
              </>
            ) : null}
          </button>
        ))}
      </div>

      {error ? (
        <div className="notice danger" role="alert">
          {error}
        </div>
      ) : null}
    </PlanningPanel>
  )
}
