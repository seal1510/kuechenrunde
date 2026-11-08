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
  weekdayShort,
} from '../../domain/dates'
import { shiftWeekStart, weekStartFor } from '../../domain/daySelection'
import { PlanningPanel } from './PlanningPanel'

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
      <div className="dish-weeknav" role="group" aria-label="Zielwoche">
        <button
          type="button"
          className="button quiet dish-week-arrow"
          aria-label="Vorherige Woche"
          onClick={() => setWeekStart((current) => shiftWeekStart(current, -1))}
          disabled={busy}
        >
          ‹
        </button>
        <span className="dish-week-range" aria-live="polite">
          {formatWeekRange(weekStart)}
        </span>
        <button
          type="button"
          className="button quiet dish-week-arrow"
          aria-label="Nächste Woche"
          onClick={() => setWeekStart((current) => shiftWeekStart(current, 1))}
          disabled={busy}
        >
          ›
        </button>
      </div>

      <div className="dish-day-grid" role="group" aria-label="Zieltag auswählen">
        {days.map((day) => (
          <button
            key={day.date}
            type="button"
            className={`dish-day-choice${day.current ? ' is-current' : ''}`}
            aria-label={`${formatDayLabel(day.date)} als Ziel wählen`}
            disabled={busy || day.current}
            onClick={() => onMove(day.date)}
          >
            <span className="dish-day-weekday">{day.weekday}</span>
            <span className="dish-day-date">
              {String(day.day).padStart(2, '0')}.{String(day.month).padStart(2, '0')}.
            </span>
            {day.current ? (
              <span className="dish-day-check" aria-hidden="true">
                •
              </span>
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
