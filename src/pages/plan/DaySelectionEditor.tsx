/*
 * openCook Web
 * Copyright (C) 2026 openCook Web contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Shared eat-day and eater-count editor for library recipes and free dishes.
 * It renders the same seven-day grid, week navigation and per-day steppers.
 */

import { useMemo, useState } from 'react'
import { formatDayLabel, formatWeekRange } from '../../domain/dates'
import {
  MAX_DAY_SERVINGS,
  MIN_DAY_SERVINGS,
  dayChoicesForWeek,
  shiftWeekStart,
  weekStartFor,
  type DaySelection,
} from '../../domain/daySelection'

export interface DaySelectionEditorProps {
  initialDate: string
  selection: DaySelection
  weekStartDay: number
  busy?: boolean
  onToggleDay: (date: string) => void
  onChangeServings: (date: string, delta: number) => void
}

export function DaySelectionEditor({
  initialDate,
  selection,
  weekStartDay,
  busy = false,
  onToggleDay,
  onChangeServings,
}: DaySelectionEditorProps) {
  const [weekStart, setWeekStart] = useState(() =>
    weekStartFor(initialDate, weekStartDay),
  )
  const selectedDays = selection.days
  const dayChoices = useMemo(
    () => dayChoicesForWeek(weekStart, selection),
    [weekStart, selection],
  )

  return (
    <div className="dish-days">
      <div className="dish-weeknav" role="group" aria-label="Auswahlwoche">
        <button
          type="button"
          className="button quiet dish-week-arrow"
          aria-label="Vorherige Woche"
          onClick={() => setWeekStart((current) => shiftWeekStart(current, -1))}
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
        >
          ›
        </button>
      </div>

      <div className="dish-day-grid" role="group" aria-label="Esstage auswählen">
        {dayChoices.map((day) => (
          <button
            key={day.date}
            type="button"
            className={`dish-day-choice${day.selected ? ' is-selected' : ''}`}
            aria-pressed={day.selected}
            aria-label={`${formatDayLabel(day.date)} ${day.selected ? 'abwählen' : 'auswählen'}`}
            onClick={() => onToggleDay(day.date)}
          >
            <span className="dish-day-weekday">{day.weekday}</span>
            <span className="dish-day-date">
              {String(day.day).padStart(2, '0')}.{String(day.month).padStart(2, '0')}.
            </span>
            {day.selected ? (
              <span className="dish-day-check" aria-hidden="true">
                ✓
              </span>
            ) : null}
          </button>
        ))}
      </div>

      {selectedDays.length > 0 ? (
        <>
          <div className="dish-selected-head">
            <span>Esstage</span>
            <span>Mitesser</span>
          </div>
          <ul className="dish-selected-days">
            {selectedDays.map((day) => (
              <li className="dish-selected-day" key={day.date}>
                <span className="dish-selected-date">{formatDayLabel(day.date)}</span>
                <div
                  className="servings-stepper"
                  role="group"
                  aria-label={`Mitesser am ${formatDayLabel(day.date)}`}
                >
                  <button
                    type="button"
                    className="servings-step"
                    aria-label={`Mitesser am ${formatDayLabel(day.date)} verringern`}
                    disabled={busy || day.servings <= MIN_DAY_SERVINGS}
                    onClick={() => onChangeServings(day.date, -1)}
                  >
                    −
                  </button>
                  <span className="servings-value" aria-live="polite">
                    {day.servings}
                  </span>
                  <button
                    type="button"
                    className="servings-step"
                    aria-label={`Mitesser am ${formatDayLabel(day.date)} erhöhen`}
                    disabled={busy || day.servings >= MAX_DAY_SERVINGS}
                    onClick={() => onChangeServings(day.date, 1)}
                  >
                    +
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="muted small dish-days-empty">
          Bitte mindestens einen Esstag auswählen.
        </p>
      )}
    </div>
  )
}
