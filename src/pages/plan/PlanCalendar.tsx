/*
 * openCook Web
 * Copyright (C) 2026 openCook Web contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Presentation-only calendar surface for the meal plan. It renders the shared
 * seven-day grid, the compact overlap previews and the mobile day selector.
 * All edits, moves and drag gestures keep running through the callbacks that
 * PlanPage already owns.
 */

import type { PointerEvent as ReactPointerEvent } from 'react'
import type { CalendarDay, CalendarLayout } from '../../domain/calendar'
import { formatDayLabel, parseDateKey, weekdayShort } from '../../domain/dates'
import { groupThemeFor, isGroupHighlighted } from '../../domain/groupColor'
import { formatPortionCount } from '../../lib/format'
import type { DayNote, FreeDish, MealPlanEntry, Recipe } from '../../types'
import { dragItemKey, type DragItem } from './dragItem'

export interface CalendarDragHandlers {
  onPointerDown: (
    item: DragItem,
    event: ReactPointerEvent<HTMLButtonElement>,
  ) => void
  onPointerMove: (event: ReactPointerEvent<HTMLButtonElement>) => void
  onPointerUp: (event: ReactPointerEvent<HTMLButtonElement>) => void
  onPointerCancel: (event: ReactPointerEvent<HTMLButtonElement>) => void
  onClick: (item: DragItem) => void
}

export function dishTitleFor(
  entry: Pick<MealPlanEntry, 'recipeId' | 'freeDishId'>,
  recipeById: Map<string, Recipe>,
  freeDishById: Map<string, FreeDish>,
): string {
  if (entry.freeDishId) {
    return freeDishById.get(entry.freeDishId)?.name ?? 'Gericht nicht gefunden'
  }
  if (entry.recipeId) {
    return recipeById.get(entry.recipeId)?.title ?? 'Rezept nicht gefunden'
  }
  return 'Gericht nicht gefunden'
}

interface CalendarCardSharedProps {
  recipeById: Map<string, Recipe>
  freeDishById: Map<string, FreeDish>
  groupSizeBySession: Map<string, number>
  originDragKey: string | null
  highlightedSessionId: string | null
  dragHandlers: CalendarDragHandlers
  onHighlightSession: (sessionId: string | null) => void
}

interface CalendarEntryCardProps extends CalendarCardSharedProps {
  entry: MealPlanEntry
  compact?: boolean
}

/**
 * One planned dish. The whole card stays the existing drag handle and opens
 * the existing editor on click/tap.
 */
export function CalendarEntryCard({
  entry,
  compact = false,
  recipeById,
  freeDishById,
  groupSizeBySession,
  originDragKey,
  highlightedSessionId,
  dragHandlers,
  onHighlightSession,
}: CalendarEntryCardProps) {
  const title = dishTitleFor(entry, recipeById, freeDishById)
  const groupSize = entry.cookSessionId
    ? groupSizeBySession.get(entry.cookSessionId) ?? 1
    : 1
  const theme = groupThemeFor(entry, groupSize)
  const dragKey = dragItemKey({ kind: 'entry', entry })
  const isFreeDish = Boolean(entry.freeDishId)
  const className = [
    'calendar-entry',
    'calendar-entry--dish',
    compact ? 'calendar-entry--preview' : '',
    isFreeDish ? 'calendar-entry--free' : '',
    theme ? `calendar-entry--group group-color-${theme.colorIndex}` : '',
    isGroupHighlighted(theme, highlightedSessionId) ? 'is-group-highlighted' : '',
    originDragKey === dragKey ? 'is-drag-origin' : '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <button
      type="button"
      className={className}
      aria-label={`${title} bearbeiten, ${formatDayLabel(entry.date)}`}
      onPointerDown={(event) =>
        dragHandlers.onPointerDown({ kind: 'entry', entry }, event)
      }
      onPointerMove={dragHandlers.onPointerMove}
      onPointerUp={dragHandlers.onPointerUp}
      onPointerCancel={dragHandlers.onPointerCancel}
      onContextMenu={(event) => event.preventDefault()}
      onMouseEnter={() => {
        if (theme) onHighlightSession(theme.sessionId)
      }}
      onMouseLeave={() => {
        if (theme) onHighlightSession(null)
      }}
      onFocus={() => {
        if (theme) onHighlightSession(theme.sessionId)
      }}
      onBlur={() => {
        if (theme) onHighlightSession(null)
      }}
      onClick={() => dragHandlers.onClick({ kind: 'entry', entry })}
    >
      <span className="calendar-entry-title">{title}</span>
      <span className="calendar-entry-meta">
        <span className="calendar-entry-portions">
          {formatPortionCount(entry.servings ?? 1)}
        </span>
        {isFreeDish ? (
          <span className="calendar-entry-kind" title="Freies Gericht">
            frei
          </span>
        ) : null}
        {theme && groupSize > 1 ? (
          <span
            className="calendar-entry-session"
            title={`Gemeinsamer Kochvorgang mit ${groupSize} Esstagen`}
          >
            {groupSize} Tage
          </span>
        ) : null}
      </span>
    </button>
  )
}

interface CalendarNoteCardProps {
  note: DayNote
  compact?: boolean
  originDragKey: string | null
  dragHandlers: CalendarDragHandlers
}

/** A day comment; it stays separate from dishes and never consumes portions. */
function CalendarNoteCard({
  note,
  compact = false,
  originDragKey,
  dragHandlers,
}: CalendarNoteCardProps) {
  const dragKey = dragItemKey({ kind: 'note', note })
  const className = [
    'calendar-entry',
    'calendar-note-entry',
    compact ? 'calendar-entry--preview' : '',
    originDragKey === dragKey ? 'is-drag-origin' : '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <button
      type="button"
      className={className}
      aria-label={`Kommentar am ${formatDayLabel(note.date)} bearbeiten`}
      onPointerDown={(event) =>
        dragHandlers.onPointerDown({ kind: 'note', note }, event)
      }
      onPointerMove={dragHandlers.onPointerMove}
      onPointerUp={dragHandlers.onPointerUp}
      onPointerCancel={dragHandlers.onPointerCancel}
      onContextMenu={(event) => event.preventDefault()}
      onClick={() => dragHandlers.onClick({ kind: 'note', note })}
    >
      <span className="calendar-note-text">{note.text}</span>
    </button>
  )
}

export interface CalendarDayCardProps extends CalendarCardSharedProps {
  day: CalendarDay
  today: string
  selected: boolean
  note?: DayNote
  dropTarget: boolean
  onAdd: (date: string) => void
}

/** Full day card used by the seven-day grid and the mobile selected day. */
export function CalendarDayCard({
  day,
  today,
  selected,
  note,
  dropTarget,
  recipeById,
  freeDishById,
  groupSizeBySession,
  originDragKey,
  highlightedSessionId,
  dragHandlers,
  onAdd,
  onHighlightSession,
}: CalendarDayCardProps) {
  const { date, entries: dayEntries } = day
  const isToday = date === today
  const isPast = date < today
  const { day: dayNumber, month } = parseDateKey(date)
  const occupied = Boolean(note) || dayEntries.length > 0
  const className = [
    'calendar-day',
    selected ? 'is-selected' : '',
    isToday ? 'is-today' : '',
    isPast ? 'is-past' : '',
    occupied ? 'is-occupied' : 'is-empty',
    dropTarget ? 'is-drop-target' : '',
  ]
    .filter(Boolean)
    .join(' ')
  const headingId = `calendar-day-heading-${date}`

  return (
    <section className={className} data-calendar-date={date} aria-labelledby={headingId}>
      <header className="calendar-day-head">
        <div className="calendar-day-date">
          <span className="calendar-weekday" id={headingId}>
            {weekdayShort(date)}
          </span>
          <span className="calendar-date">
            {String(dayNumber).padStart(2, '0')}.{String(month).padStart(2, '0')}.
          </span>
        </div>
        {isToday ? <span className="calendar-today">Heute</span> : null}
      </header>

      {occupied ? (
        <ul className="calendar-entries">
          {note ? (
            <li>
              <CalendarNoteCard
                note={note}
                originDragKey={originDragKey}
                dragHandlers={dragHandlers}
              />
            </li>
          ) : null}

          {dayEntries.map((entry) => (
            <li key={entry.id}>
              <CalendarEntryCard
                entry={entry}
                recipeById={recipeById}
                freeDishById={freeDishById}
                groupSizeBySession={groupSizeBySession}
                originDragKey={originDragKey}
                highlightedSessionId={highlightedSessionId}
                dragHandlers={dragHandlers}
                onHighlightSession={onHighlightSession}
              />
            </li>
          ))}
        </ul>
      ) : null}

      <button
        type="button"
        className={`calendar-add-day${occupied ? ' is-occupied' : ' is-empty'}`}
        aria-label={`Eintrag am ${formatDayLabel(date)} hinzufügen`}
        onClick={() => onAdd(date)}
      >
        <span className="calendar-add-day-icon" aria-hidden="true">
          +
        </span>
        <span className="calendar-add-day-label">Hinzufügen</span>
      </button>
    </section>
  )
}

const MAX_PREVIEW_ENTRIES = 2

export interface CalendarPreviewTileProps extends CalendarCardSharedProps {
  day: CalendarDay
  today: string
  note?: DayNote
  dropTarget: boolean
  onAdd: (date: string) => void
}

/**
 * Compact preview for the two days before and after the core week. Each dish
 * and comment remains directly editable, so overlap days are not reduced to a
 * read-only summary.
 */
export function CalendarPreviewTile({
  day,
  today,
  note,
  dropTarget,
  recipeById,
  freeDishById,
  groupSizeBySession,
  originDragKey,
  highlightedSessionId,
  dragHandlers,
  onAdd,
  onHighlightSession,
}: CalendarPreviewTileProps) {
  const { date, entries: dayEntries } = day
  const { day: dayNumber, month } = parseDateKey(date)
  const isToday = date === today
  const entrySlots = note ? 1 : MAX_PREVIEW_ENTRIES
  const visibleEntries = dayEntries.slice(0, entrySlots)
  const hiddenEntries = dayEntries.length - visibleEntries.length
  const className = [
    'calendar-preview-tile',
    isToday ? 'is-today' : '',
    date < today ? 'is-past' : '',
    dropTarget ? 'is-drop-target' : '',
    note || dayEntries.length > 0 ? 'is-occupied' : 'is-empty',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <article className={className} data-calendar-date={date}>
      <header className="calendar-preview-head">
        <span className="calendar-preview-weekday">{weekdayShort(date)}</span>
        <span className="calendar-preview-date">
          {String(dayNumber).padStart(2, '0')}.{String(month).padStart(2, '0')}.
        </span>
        {isToday ? (
          <span className="calendar-preview-today">Heute</span>
        ) : null}
      </header>

      <div className="calendar-preview-body">
        {note ? (
          <CalendarNoteCard
            note={note}
            compact
            originDragKey={originDragKey}
            dragHandlers={dragHandlers}
          />
        ) : null}

        {visibleEntries.map((entry) => (
          <CalendarEntryCard
            key={entry.id}
            entry={entry}
            compact
            recipeById={recipeById}
            freeDishById={freeDishById}
            groupSizeBySession={groupSizeBySession}
            originDragKey={originDragKey}
            highlightedSessionId={highlightedSessionId}
            dragHandlers={dragHandlers}
            onHighlightSession={onHighlightSession}
          />
        ))}

        {hiddenEntries > 0 ? (
          <span className="calendar-preview-more">+{hiddenEntries} weitere</span>
        ) : null}
      </div>

      <button
        type="button"
        className="calendar-preview-add"
        aria-label={`Eintrag am ${formatDayLabel(date)} hinzufügen`}
        onClick={() => onAdd(date)}
      >
        <span aria-hidden="true">+</span>
      </button>
    </article>
  )
}

interface CalendarPreviewRowProps extends CalendarCardSharedProps {
  days: CalendarDay[]
  position: 'before' | 'after'
  today: string
  noteByDate: Map<string, DayNote>
  dropDate: string | null
  onAdd: (date: string) => void
}

function CalendarPreviewRow({
  days,
  position,
  today,
  noteByDate,
  dropDate,
  recipeById,
  freeDishById,
  groupSizeBySession,
  originDragKey,
  highlightedSessionId,
  dragHandlers,
  onAdd,
  onHighlightSession,
}: CalendarPreviewRowProps) {
  if (days.length === 0) return null
  const label = position === 'before' ? 'Davor' : 'Danach'

  return (
    <section
      className={`calendar-preview-row calendar-preview-row--${position}`}
      aria-label={position === 'before' ? 'Tage davor' : 'Tage danach'}
    >
      <span className="calendar-preview-label" aria-hidden="true">
        {label}
      </span>
      <div className="calendar-preview-list">
        {days.map((day) => (
          <CalendarPreviewTile
            key={day.date}
            day={day}
            today={today}
            note={noteByDate.get(day.date)}
            dropTarget={dropDate === day.date}
            recipeById={recipeById}
            freeDishById={freeDishById}
            groupSizeBySession={groupSizeBySession}
            originDragKey={originDragKey}
            highlightedSessionId={highlightedSessionId}
            dragHandlers={dragHandlers}
            onAdd={onAdd}
            onHighlightSession={onHighlightSession}
          />
        ))}
      </div>
    </section>
  )
}

export interface PlanCalendarProps extends CalendarCardSharedProps {
  layout: CalendarLayout
  today: string
  selectedDate: string
  noteByDate: Map<string, DayNote>
  dropDate: string | null
  onSelectDate: (date: string) => void
  onAdd: (date: string) => void
}

/**
 * One calendar surface for all viewports. Desktop and tablet show the seven-day
 * grid; the day strip and the selected-day rule are only activated by the
 * mobile media query. Both share the same markup and the same actions.
 */
export function PlanCalendar({
  layout,
  today,
  selectedDate,
  noteByDate,
  dropDate,
  recipeById,
  freeDishById,
  groupSizeBySession,
  originDragKey,
  highlightedSessionId,
  dragHandlers,
  onSelectDate,
  onAdd,
  onHighlightSession,
}: PlanCalendarProps) {
  const shared = {
    recipeById,
    freeDishById,
    groupSizeBySession,
    originDragKey,
    highlightedSessionId,
    dragHandlers,
    onHighlightSession,
  }

  return (
    <div className="calendar-shell">
      <CalendarPreviewRow
        days={layout.before}
        position="before"
        today={today}
        noteByDate={noteByDate}
        dropDate={dropDate}
        onAdd={onAdd}
        {...shared}
      />

      <section className="calendar-core" aria-label="Planungswoche">
        <div className="calendar-day-strip" role="group" aria-label="Tag auswählen">
          {layout.main.map((day) => {
            const selected = day.date === selectedDate
            const isToday = day.date === today
            const { day: dayNumber } = parseDateKey(day.date)
            const dishCount = day.entries.length
            const className = [
              'calendar-day-chip',
              selected ? 'is-selected' : '',
              isToday ? 'is-today' : '',
              dishCount > 0 ? 'has-dishes' : '',
              dropDate === day.date ? 'is-drop-target' : '',
            ]
              .filter(Boolean)
              .join(' ')
            const description = [
              formatDayLabel(day.date),
              isToday ? 'heute' : '',
              dishCount > 0
                ? `${dishCount} ${dishCount === 1 ? 'Gericht' : 'Gerichte'} geplant`
                : 'keine Gerichte geplant',
            ]
              .filter(Boolean)
              .join(', ')

            return (
              <button
                key={day.date}
                type="button"
                className={className}
                aria-pressed={selected}
                aria-label={description}
                data-calendar-select-date={day.date}
                data-calendar-drop-date={day.date}
                onClick={() => onSelectDate(day.date)}
              >
                <span className="calendar-day-chip-weekday" aria-hidden="true">
                  {weekdayShort(day.date)}
                </span>
                <span className="calendar-day-chip-date" aria-hidden="true">
                  {dayNumber}
                </span>
                <span className="calendar-day-chip-markers" aria-hidden="true">
                  {isToday ? (
                    <span className="calendar-day-chip-today" />
                  ) : null}
                  {dishCount > 0 ? (
                    <span className="calendar-day-chip-planned" />
                  ) : null}
                </span>
              </button>
            )
          })}
        </div>

        <div className="calendar-week">
          {layout.main.map((day) => (
            <CalendarDayCard
              key={day.date}
              day={day}
              today={today}
              selected={day.date === selectedDate}
              note={noteByDate.get(day.date)}
              dropTarget={dropDate === day.date}
              onAdd={onAdd}
              {...shared}
            />
          ))}
        </div>
      </section>

      <CalendarPreviewRow
        days={layout.after}
        position="after"
        today={today}
        noteByDate={noteByDate}
        dropDate={dropDate}
        onAdd={onAdd}
        {...shared}
      />
    </div>
  )
}
