import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { createPortal } from 'react-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db'
import {
  addDays,
  formatDayLabel,
  formatWeekRange,
  parseDateKey,
  todayKey,
  weekdayShort,
  WEEKDAY_NAMES,
} from '../domain/dates'
import {
  buildCalendarLayout,
  buildCalendarWindow,
  type CalendarDay,
  type CalendarSettings,
} from '../domain/calendar'
import { groupThemeFor, isGroupHighlighted } from '../domain/groupColor'
import { formatPortionCount } from '../lib/format'
import {
  CookedMoveConflictError,
  DishPlanMoveConflictError,
  moveDishPlanEntry,
  undoDishPlanMove,
  type MoveDishPlanResult,
} from '../mealplan/dishService'
import {
  DayNoteMoveConflictError,
  moveDayNote,
  undoDayNoteMove,
} from '../mealplan/dayNoteService'
import { calendarSettingsFromRows, setCalendarSettings } from '../settings/calendar'
import type { DayNote, FreeDish, MealPlanEntry, Recipe } from '../types'
import { AddEntryDialog } from './plan/AddEntryDialog'
import {
  CalendarDragOverlay,
  type CalendarDragOverlayState,
} from './plan/CalendarDragOverlay'
import { DayNoteDialog } from './plan/DayNoteDialog'
import { DishDialog } from './plan/DishDialog'
import { FreeDishDialog } from './plan/FreeDishDialog'
import { MoveDialog } from './plan/MoveDialog'
import {
  createMoveUndoOffer,
  createNoteUndoOffer,
  type MoveUndoOffer,
} from './plan/moveUndo'
import {
  dragItemDate,
  dragItemKey,
  type DragItem,
} from './plan/dragItem'
import {
  TOUCH_LONG_PRESS_MS,
  activateDragGesture,
  createDragGesture,
  moveDragGesture,
  shouldActivateTouchHold,
  type DragGestureState,
  type DragPointerType,
} from './plan/dragGesture'

type DialogState =
  | { kind: 'create'; date: string }
  | { kind: 'free-create'; date: string }
  | { kind: 'edit'; entryId: string }

type MoveRequest =
  | { kind: 'entry'; entry: MealPlanEntry }
  | { kind: 'note'; note: DayNote }

interface CalendarDragHandlers {
  onPointerDown: (
    item: DragItem,
    event: ReactPointerEvent<HTMLButtonElement>,
  ) => void
  onPointerMove: (event: ReactPointerEvent<HTMLButtonElement>) => void
  onPointerUp: (event: ReactPointerEvent<HTMLButtonElement>) => void
  onPointerCancel: (event: ReactPointerEvent<HTMLButtonElement>) => void
  onClick: (item: DragItem) => void
}

const OVERLAP_OPTIONS = Array.from({ length: 8 }, (_, index) => index)

function normalizePointerType(value: string): DragPointerType {
  return value === 'touch' ? 'touch' : value === 'pen' ? 'pen' : 'mouse'
}

interface CalendarDayCardProps {
  day: CalendarDay
  overlap: boolean
  today: string
  recipeById: Map<string, Recipe>
  freeDishById: Map<string, FreeDish>
  groupSizeBySession: Map<string, number>
  note?: DayNote
  dropTarget: boolean
  originDragKey: string | null
  highlightedSessionId: string | null
  dragHandlers: CalendarDragHandlers
  onAdd: (date: string) => void
  onHighlightSession: (sessionId: string | null) => void
}

function dishTitleFor(
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

function CalendarDayCard({
  day,
  overlap,
  today,
  recipeById,
  freeDishById,
  groupSizeBySession,
  note,
  dropTarget,
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
  const className = [
    'calendar-day',
    overlap ? 'is-overlap' : '',
    isToday ? 'is-today' : '',
    isPast ? 'is-past' : '',
    day.empty ? 'is-empty' : '',
    dropTarget ? 'is-drop-target' : '',
  ]
    .filter(Boolean)
    .join(' ')

  const occupied = Boolean(note) || dayEntries.length > 0

  return (
    <section className={className} data-calendar-date={date}>
      <header className="calendar-day-head">
        <div>
          <span className="calendar-weekday">{weekdayShort(date)}</span>
          <span className="calendar-date">
            {String(dayNumber).padStart(2, '0')}.{String(month).padStart(2, '0')}.
          </span>
        </div>
        {isToday ? <span className="calendar-today">Heute</span> : null}
      </header>

      {occupied ? (
        <ul className="calendar-entries">
          {note ? (
            <li key={`note-${date}`}>
              <button
                type="button"
                className={`calendar-entry calendar-note-entry${originDragKey === dragItemKey({ kind: 'note', note }) ? ' is-drag-origin' : ''}`}
                aria-label={`Kommentar am ${formatDayLabel(date)} bearbeiten`}
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
            </li>
          ) : null}

          {dayEntries.map((entry) => {
            const title = dishTitleFor(entry, recipeById, freeDishById)
            const groupSize = entry.cookSessionId
              ? groupSizeBySession.get(entry.cookSessionId) ?? 1
              : 1
            const theme = groupThemeFor(entry, groupSize)
            const dragKey = dragItemKey({ kind: 'entry', entry })
            const entryClassName = [
              'calendar-entry',
              'calendar-entry--dish',
              theme ? `calendar-entry--group group-color-${theme.colorIndex}` : '',
              isGroupHighlighted(theme, highlightedSessionId)
                ? 'is-group-highlighted'
                : '',
              originDragKey === dragKey ? 'is-drag-origin' : '',
            ]
              .filter(Boolean)
              .join(' ')
            return (
              <li key={entry.id}>
                <button
                  type="button"
                  className={entryClassName}
                  aria-label={`${title} bearbeiten, ${formatDayLabel(date)}`}
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
                  onClick={() =>
                    dragHandlers.onClick({ kind: 'entry', entry })
                  }
                >
                  <span className="calendar-entry-title">{title}</span>
                  <span className="calendar-entry-meta">
                    {formatPortionCount(entry.servings ?? 1)}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      ) : null}

      <button
        type="button"
        className={`calendar-add-day${occupied ? ' is-occupied' : ' is-empty'}`}
        aria-label={`Eintrag am ${formatDayLabel(date)} hinzufügen`}
        onClick={() => onAdd(date)}
      >
        <span aria-hidden="true">+</span>
        <span>Hinzufügen</span>
      </button>
    </section>
  )
}

export function PlanPage() {
  const today = useMemo(() => todayKey(), [])
  const [anchorDate, setAnchorDate] = useState(today)
  const entries = useLiveQuery(() => db.mealPlans.toArray(), [])
  const recipes = useLiveQuery(() => db.recipes.toArray(), [])
  const freeDishes = useLiveQuery(() => db.freeDishes.toArray(), [])
  const sessions = useLiveQuery(() => db.cookSessions.toArray(), [])
  const settingsRows = useLiveQuery(() => db.settings.toArray(), [])
  const dayNotes = useLiveQuery(() => db.dayNotes.toArray(), [])

  const [dialog, setDialog] = useState<DialogState | null>(null)
  const [addMenuDate, setAddMenuDate] = useState<string | null>(null)
  const [noteDate, setNoteDate] = useState<string | null>(null)
  const [moveRequest, setMoveRequest] = useState<MoveRequest | null>(null)
  const [moving, setMoving] = useState(false)
  const [undoOffer, setUndoOffer] = useState<MoveUndoOffer | null>(null)
  const [undoBusy, setUndoBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dragOverlay, setDragOverlay] = useState<CalendarDragOverlayState | null>(
    null,
  )
  const [dropDate, setDropDate] = useState<string | null>(null)
  const [hoveredSessionId, setHoveredSessionId] = useState<string | null>(null)

  const dragGestureRef = useRef<DragGestureState | null>(null)
  const dragItemRef = useRef<DragItem | null>(null)
  const dragOriginRectRef = useRef<DOMRect | null>(null)
  const dragPositionRef = useRef({ x: 0, y: 0 })
  const holdTimerRef = useRef<number | null>(null)
  const overlayTimerRef = useRef<number | null>(null)
  const undoDismissTimerRef = useRef<number | null>(null)
  const suppressClickRef = useRef(false)

  const recipeById = useMemo(
    () => new Map((recipes ?? []).map((recipe) => [recipe.id, recipe])),
    [recipes],
  )
  const freeDishById = useMemo(
    () => new Map((freeDishes ?? []).map((freeDish) => [freeDish.id, freeDish])),
    [freeDishes],
  )
  const sessionById = useMemo(
    () => new Map((sessions ?? []).map((session) => [session.id, session])),
    [sessions],
  )
  const noteByDate = useMemo(
    () => new Map((dayNotes ?? []).map((note) => [note.date, note])),
    [dayNotes],
  )
  const groupSizeBySession = useMemo(() => {
    const datesBySession = new Map<string, Set<string>>()
    for (const entry of entries ?? []) {
      if (!entry.cookSessionId) continue
      const dates = datesBySession.get(entry.cookSessionId) ?? new Set<string>()
      dates.add(entry.date)
      datesBySession.set(entry.cookSessionId, dates)
    }
    return new Map(
      Array.from(datesBySession, ([sessionId, dates]) => [sessionId, dates.size]),
    )
  }, [entries])
  const calendarSettings = useMemo(
    () => calendarSettingsFromRows(settingsRows ?? []),
    [settingsRows],
  )
  const calendarWindow = useMemo(
    () =>
      buildCalendarWindow(
        anchorDate,
        calendarSettings.weekStartDay,
        calendarSettings.overlapBefore,
        calendarSettings.overlapAfter,
      ),
    [anchorDate, calendarSettings],
  )
  const calendarLayout = useMemo(
    () => buildCalendarLayout(calendarWindow, entries ?? []),
    [calendarWindow, entries],
  )
  const noRecipes = recipes !== undefined && recipes.length === 0
  const hasDayNotes = (dayNotes?.length ?? 0) > 0
  const showEmptyState =
    noRecipes && (entries?.length ?? 0) === 0 && !hasDayNotes
  const loading =
    entries === undefined ||
    recipes === undefined ||
    freeDishes === undefined ||
    sessions === undefined ||
    settingsRows === undefined ||
    dayNotes === undefined

  const dialogEntry =
    dialog?.kind === 'edit'
      ? (entries ?? []).find((entry) => entry.id === dialog.entryId)
      : undefined
  const dialogEntries = useMemo(() => {
    if (!dialogEntry) return []
    if (!dialogEntry.cookSessionId) return [dialogEntry]
    return (entries ?? [])
      .filter((entry) => entry.cookSessionId === dialogEntry.cookSessionId)
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
  }, [dialogEntry, entries])
  const dialogSession = dialogEntry?.cookSessionId
    ? sessionById.get(dialogEntry.cookSessionId)
    : undefined

  function clearHoldTimer() {
    if (holdTimerRef.current !== null) {
      window.clearTimeout(holdTimerRef.current)
      holdTimerRef.current = null
    }
  }

  function clearOverlayTimer() {
    if (overlayTimerRef.current !== null) {
      window.clearTimeout(overlayTimerRef.current)
      overlayTimerRef.current = null
    }
  }

  function clearUndoTimer() {
    if (undoDismissTimerRef.current !== null) {
      window.clearTimeout(undoDismissTimerRef.current)
      undoDismissTimerRef.current = null
    }
  }

  useEffect(() => {
    function handleTouchMove(event: TouchEvent) {
      const gesture = dragGestureRef.current
      if (!gesture) return
      const touch = event.touches[0]
      if (!touch) return

      // Touchmove is the reliable scroll signal on iOS even when pointermove
      // events stop. It cancels a pending hold before activation and prevents
      // scrolling only after the long press has actually activated the drag.
      const next = moveDragGesture(gesture, touch.clientX, touch.clientY)
      dragGestureRef.current = next
      if (next.cancelled) {
        clearHoldTimer()
        return
      }
      if (!next.active) return

      event.preventDefault()
      dragPositionRef.current = { x: touch.clientX, y: touch.clientY }
      updateOverlayPosition(touch.clientX, touch.clientY)
      setDropDate(dropDateAt(touch.clientX, touch.clientY))
    }
    document.addEventListener('touchmove', handleTouchMove, { passive: false })
    return () => {
      document.removeEventListener('touchmove', handleTouchMove)
      clearHoldTimer()
      clearOverlayTimer()
      clearUndoTimer()
      document.body.classList.remove('calendar-dragging')
    }
  }, [])

  async function updateCalendarSettings(patch: Partial<CalendarSettings>) {
    setError(null)
    try {
      await setCalendarSettings(patch)
    } catch (cause) {
      setError((cause as Error).message || 'Die Einstellung konnte nicht gespeichert werden.')
    }
  }

  function handleDone() {
    setDialog(null)
    setError(null)
  }

  function openCreate(date: string) {
    setDialog({ kind: 'create', date })
    setError(null)
  }

  function openCreateFree(date: string) {
    setDialog({ kind: 'free-create', date })
    setError(null)
  }

  function openEdit(entry: MealPlanEntry) {
    setDialog({ kind: 'edit', entryId: entry.id })
    setError(null)
  }

  function openMove(entry: MealPlanEntry) {
    if (moving || undoBusy) return
    setMoveRequest({ kind: 'entry', entry })
    setError(null)
  }

  function openMoveNote(note: DayNote) {
    if (moving || undoBusy) return
    setMoveRequest({ kind: 'note', note })
    setError(null)
  }

  function openAdd(date: string) {
    setAddMenuDate(date)
    setError(null)
  }

  function dropDateAt(clientX: number, clientY: number): string | null {
    const element = document.elementFromPoint(clientX, clientY)
    return (
      element?.closest<HTMLElement>('[data-calendar-date]')?.dataset.calendarDate ??
      null
    )
  }

  function beginOverlay(item: DragItem, x: number, y: number) {
    const rect = dragOriginRectRef.current
    if (!rect) return
    clearOverlayTimer()
    const groupSize =
      item.kind === 'entry' && item.entry.cookSessionId
        ? groupSizeBySession.get(item.entry.cookSessionId) ?? 1
        : 1
    const theme =
      item.kind === 'entry' ? groupThemeFor(item.entry, groupSize) : null
    setDragOverlay({
      item,
      dishTitle:
        item.kind === 'entry'
          ? dishTitleFor(item.entry, recipeById, freeDishById)
          : '',
      groupColorIndex: theme?.colorIndex ?? null,
      groupSessionId: theme?.sessionId ?? null,
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
      originLeft: rect.left,
      originTop: rect.top,
      offsetX: x - rect.left,
      offsetY: y - rect.top,
      phase: 'dragging',
    })
    document.body.classList.add('calendar-dragging')
    suppressClickRef.current = true
    setHoveredSessionId(null)
    setDropDate(dropDateAt(x, y))
  }

  function updateOverlayPosition(x: number, y: number) {
    setDragOverlay((current) =>
      current
        ? {
            ...current,
            left: x - current.offsetX,
            top: y - current.offsetY,
          }
        : current,
    )
  }

  function activateTouchHold(): boolean {
    const gesture = dragGestureRef.current
    if (!gesture || !shouldActivateTouchHold(gesture, performance.now())) {
      return false
    }
    dragGestureRef.current = activateDragGesture(gesture)
    const item = dragItemRef.current
    if (item) {
      beginOverlay(
        item,
        dragPositionRef.current.x,
        dragPositionRef.current.y,
      )
    }
    return true
  }

  function armTouchHoldTimer() {
    clearHoldTimer()
    holdTimerRef.current = window.setTimeout(() => {
      holdTimerRef.current = null
      if (activateTouchHold()) return
      const gesture = dragGestureRef.current
      if (!gesture || gesture.cancelled || gesture.active) return
      // A timer can fire a fraction early. Re-arm once for the remaining time
      // instead of losing the long press entirely.
      const remaining = Math.max(
        1,
        TOUCH_LONG_PRESS_MS - (performance.now() - gesture.startedAt),
      )
      holdTimerRef.current = window.setTimeout(() => {
        holdTimerRef.current = null
        activateTouchHold()
      }, remaining)
    }, TOUCH_LONG_PRESS_MS)
  }

  function handleCardPointerDown(
    item: DragItem,
    event: ReactPointerEvent<HTMLButtonElement>,
  ) {
    if (event.pointerType === 'mouse' && event.button !== 0) return
    if (dragGestureRef.current || dragOverlay || undoBusy) return

    const pointerType = normalizePointerType(event.pointerType)
    dragGestureRef.current = createDragGesture(
      pointerType,
      event.clientX,
      event.clientY,
      performance.now(),
    )
    dragItemRef.current = item
    dragOriginRectRef.current = event.currentTarget.getBoundingClientRect()
    dragPositionRef.current = { x: event.clientX, y: event.clientY }
    suppressClickRef.current = false

    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      // Pointer capture is not available in a few older engines. Movement over
      // the card still works; the release path stays the same.
    }

    if (pointerType === 'touch') {
      armTouchHoldTimer()
    }
  }

  function handleCardPointerMove(event: ReactPointerEvent<HTMLButtonElement>) {
    const gesture = dragGestureRef.current
    if (!gesture) return
    dragPositionRef.current = { x: event.clientX, y: event.clientY }
    const next = moveDragGesture(gesture, event.clientX, event.clientY)
    dragGestureRef.current = next

    if (next.cancelled) {
      clearHoldTimer()
      return
    }

    if (!gesture.active && next.active) {
      const item = dragItemRef.current
      if (item) beginOverlay(item, event.clientX, event.clientY)
    }

    if (next.active) {
      event.preventDefault()
      updateOverlayPosition(event.clientX, event.clientY)
      setDropDate(dropDateAt(event.clientX, event.clientY))
    }
  }

  function handleCardPointerUp(event: ReactPointerEvent<HTMLButtonElement>) {
    const gesture = dragGestureRef.current
    if (!gesture) return
    dragPositionRef.current = { x: event.clientX, y: event.clientY }
    clearHoldTimer()

    if (gesture.active) {
      finishDrag(true)
    } else {
      if (gesture.cancelled) {
        // The gesture was a scroll, not a click on the card.
        suppressClickRef.current = true
        window.setTimeout(() => {
          suppressClickRef.current = false
        }, 350)
      }
      dragGestureRef.current = null
      dragItemRef.current = null
      dragOriginRectRef.current = null
    }
  }

  function handleCardPointerCancel() {
    clearHoldTimer()
    const gesture = dragGestureRef.current
    if (!gesture) return
    if (gesture.active) {
      finishDrag(false)
    } else {
      dragGestureRef.current = null
      dragItemRef.current = null
      dragOriginRectRef.current = null
    }
  }

  function finishDrag(commit: boolean) {
    const gesture = dragGestureRef.current
    if (!gesture) return
    const item = dragItemRef.current
    const active = gesture.active
    dragGestureRef.current = null

    if (!active || !item) {
      dragItemRef.current = null
      dragOriginRectRef.current = null
      return
    }

    // A click follows pointerup. Keep it suppressed long enough for touch
    // browsers that dispatch the click with a short delay.
    suppressClickRef.current = true
    window.setTimeout(() => {
      suppressClickRef.current = false
    }, 500)

    const target = commit
      ? dropDateAt(dragPositionRef.current.x, dragPositionRef.current.y)
      : null
    if (target && target !== dragItemDate(item)) {
      setDropDate(target)
      setDragOverlay((current) =>
        current ? { ...current, phase: 'dropping' } : current,
      )
      void completeDrop(item, target)
    } else {
      returnOverlay()
    }
  }

  async function completeDrop(item: DragItem, targetDate: string) {
    if (item.kind === 'entry') {
      const moved = await moveEntryTo(item.entry, targetDate)
      if (moved) settleOverlay(targetDate)
      else returnOverlay()
      return
    }
    const moved = await moveNoteTo(item.note, targetDate)
    if (moved) settleOverlay(targetDate)
    else returnOverlay()
  }

  function settleOverlay(targetDate: string) {
    const dayElement = document.querySelector<HTMLElement>(
      `[data-calendar-date="${targetDate}"]`,
    )
    const rect = dayElement?.getBoundingClientRect()
    // Switch to the transition-enabled phase first, then move on the next
    // frame so the settle animation is guaranteed to run.
    setDragOverlay((current) =>
      current ? { ...current, phase: 'settling' } : current,
    )
    window.requestAnimationFrame(() => {
      setDragOverlay((current) => {
        if (!current || current.phase !== 'settling') return current
        const left = rect
          ? rect.left + Math.max(6, (rect.width - current.width) / 2)
          : current.left
        const top = rect ? rect.top + 18 : current.top
        return { ...current, left, top }
      })
    })
    clearOverlayTimer()
    overlayTimerRef.current = window.setTimeout(() => {
      setDragOverlay(null)
      setDropDate(null)
      dragItemRef.current = null
      dragOriginRectRef.current = null
      document.body.classList.remove('calendar-dragging')
    }, 180)
  }

  function returnOverlay() {
    setDragOverlay((current) =>
      current ? { ...current, phase: 'returning' } : current,
    )
    window.requestAnimationFrame(() => {
      setDragOverlay((current) => {
        if (!current || current.phase !== 'returning') return current
        return {
          ...current,
          left: current.originLeft,
          top: current.originTop,
        }
      })
    })
    setDropDate(null)
    clearOverlayTimer()
    overlayTimerRef.current = window.setTimeout(() => {
      setDragOverlay(null)
      setDropDate(null)
      dragItemRef.current = null
      dragOriginRectRef.current = null
      document.body.classList.remove('calendar-dragging')
    }, 190)
  }

  function handleCardClick(item: DragItem) {
    if (suppressClickRef.current) {
      suppressClickRef.current = false
      return
    }
    if (item.kind === 'entry') openEdit(item.entry)
    else setNoteDate(item.note.date)
  }

  function showUndoOffer(offer: MoveUndoOffer) {
    setUndoOffer(offer)
    clearUndoTimer()
    undoDismissTimerRef.current = window.setTimeout(() => {
      undoDismissTimerRef.current = null
      setUndoOffer(null)
    }, 8000)
  }

  function offerUndo(result: MoveDishPlanResult, entry: MealPlanEntry) {
    const offer = createMoveUndoOffer(result, entry.id, entry.date)
    if (offer) showUndoOffer(offer)
  }

  function offerNoteUndo(note: DayNote, originalDate: string) {
    showUndoOffer(createNoteUndoOffer(note, originalDate))
  }

  async function handleUndoMove() {
    if (!undoOffer || undoBusy || moving) return
    setUndoBusy(true)
    setError(null)
    try {
      if (undoOffer.kind === 'dish') {
        await undoDishPlanMove({
          entryId: undoOffer.entryId,
          originalDate: undoOffer.originalDate,
          expected: undoOffer.snapshot,
        })
      } else {
        await undoDayNoteMove({
          currentDate: undoOffer.currentDate,
          originalDate: undoOffer.originalDate,
          expected: undoOffer.snapshot,
        })
      }
      setUndoOffer(null)
      clearUndoTimer()
    } catch (cause) {
      setUndoOffer(null)
      clearUndoTimer()
      if (
        cause instanceof DishPlanMoveConflictError ||
        cause instanceof DayNoteMoveConflictError
      ) {
        setError(cause.message)
      } else {
        setError(
          (cause as Error).message || 'Das Rückgängigmachen ist fehlgeschlagen.',
        )
      }
    } finally {
      setUndoBusy(false)
    }
  }

  async function moveEntryTo(
    entry: MealPlanEntry,
    targetDate: string,
  ): Promise<MoveDishPlanResult | null> {
    if (undoBusy) return null
    if (targetDate === entry.date) {
      setMoveRequest(null)
      return null
    }
    setMoving(true)
    setError(null)
    try {
      const result = await moveDishPlanEntry(entry.id, targetDate)
      setMoveRequest(null)
      offerUndo(result, entry)
      return result
    } catch (cause) {
      if (cause instanceof CookedMoveConflictError) {
        if (window.confirm(`${cause.message}\n\nTrotzdem verschieben?`)) {
          try {
            const result = await moveDishPlanEntry(entry.id, targetDate, {
              allowCookedChange: true,
            })
            setMoveRequest(null)
            offerUndo(result, entry)
            return result
          } catch (second) {
            setError(
              (second as Error).message ||
                'Das Gericht konnte nicht verschoben werden.',
            )
            return null
          }
        }
        return null
      }
      setError(
        (cause as Error).message || 'Das Gericht konnte nicht verschoben werden.',
      )
      return null
    } finally {
      setMoving(false)
    }
  }

  async function moveNoteTo(
    note: DayNote,
    targetDate: string,
  ): Promise<DayNote | null> {
    if (undoBusy) return null
    if (targetDate === note.date) {
      setMoveRequest(null)
      return null
    }
    setMoving(true)
    setError(null)
    try {
      const moved = await moveDayNote(note.date, targetDate)
      setMoveRequest(null)
      offerNoteUndo(moved, note.date)
      return moved
    } catch (cause) {
      setError(
        (cause as Error).message || 'Der Kommentar konnte nicht verschoben werden.',
      )
      return null
    } finally {
      setMoving(false)
    }
  }

  const dragHandlers: CalendarDragHandlers = {
    onPointerDown: handleCardPointerDown,
    onPointerMove: handleCardPointerMove,
    onPointerUp: handleCardPointerUp,
    onPointerCancel: handleCardPointerCancel,
    onClick: handleCardClick,
  }

  const moveRequestKey = moveRequest
    ? moveRequest.kind === 'entry'
      ? `entry-${moveRequest.entry.id}`
      : `note-${moveRequest.note.date}`
    : ''
  const moveRequestDate = moveRequest
    ? moveRequest.kind === 'entry'
      ? moveRequest.entry.date
      : moveRequest.note.date
    : ''
  const moveRequestHeading =
    moveRequest?.kind === 'note' ? 'Kommentar verschieben' : 'Gericht verschieben'
  const moveRequestSubtitle =
    moveRequest?.kind === 'entry'
      ? dishTitleFor(moveRequest.entry, recipeById, freeDishById)
      : undefined

  function handleMoveRequest(targetDate: string) {
    if (!moveRequest) return
    if (moveRequest.kind === 'entry') {
      void moveEntryTo(moveRequest.entry, targetDate)
    } else {
      void moveNoteTo(moveRequest.note, targetDate)
    }
  }

  function renderDay(day: CalendarDay, overlap: boolean) {
    return (
      <CalendarDayCard
        key={day.date}
        day={day}
        overlap={overlap}
        today={today}
        recipeById={recipeById}
        freeDishById={freeDishById}
        groupSizeBySession={groupSizeBySession}
        note={noteByDate.get(day.date)}
        dropTarget={dropDate === day.date}
        originDragKey={dragOverlay ? dragItemKey(dragOverlay.item) : null}
        highlightedSessionId={
          dragOverlay ? dragOverlay.groupSessionId : hoveredSessionId
        }
        dragHandlers={dragHandlers}
        onAdd={openAdd}
        onHighlightSession={setHoveredSessionId}
      />
    )
  }

  return (
    <div className="page">
      <header className="page-head">
        <h1>Essensplan</h1>
      </header>

      <div className="plan-toolbar panel">
        <div className="plan-weeknav" role="group" aria-label="Woche wechseln">
          <button
            type="button"
            className="button quiet plan-nav-arrow"
            aria-label="Vorherige Woche"
            onClick={() => setAnchorDate(addDays(anchorDate, -7))}
          >
            ‹
          </button>
          <span className="plan-range" aria-live="polite">
            {formatWeekRange(calendarWindow.coreStart)}
          </span>
          <button
            type="button"
            className="button quiet plan-nav-arrow"
            aria-label="Nächste Woche"
            onClick={() => setAnchorDate(addDays(anchorDate, 7))}
          >
            ›
          </button>
        </div>

        <div className="plan-toolbar-actions">
          <button
            type="button"
            className="button quiet"
            onClick={() => setAnchorDate(today)}
          >
            Heute
          </button>

          <details className="plan-menu">
            <summary
              className="button quiet"
              aria-label="Kalender-Einstellungen"
              title="Kalender-Einstellungen"
            >
              ⚙
            </summary>
            <div className="plan-menu-body plan-settings-body">
              <label className="field">
                <span className="field-label">Wochenbeginn</span>
                <select
                  value={calendarSettings.weekStartDay}
                  onChange={(event) =>
                    void updateCalendarSettings({
                      weekStartDay: Number(event.target.value),
                    })
                  }
                >
                  {WEEKDAY_NAMES.map((name, index) => (
                    <option key={name} value={index}>
                      {name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span className="field-label">Tage davor</span>
                <select
                  value={calendarSettings.overlapBefore}
                  onChange={(event) =>
                    void updateCalendarSettings({
                      overlapBefore: Number(event.target.value),
                    })
                  }
                >
                  {OVERLAP_OPTIONS.map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span className="field-label">Tage danach</span>
                <select
                  value={calendarSettings.overlapAfter}
                  onChange={(event) =>
                    void updateCalendarSettings({
                      overlapAfter: Number(event.target.value),
                    })
                  }
                >
                  {OVERLAP_OPTIONS.map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </details>
        </div>
      </div>

      {error ? (
        <div className="notice danger" role="alert">
          {error}
        </div>
      ) : null}

      {showEmptyState ? (
        <div className="empty-state is-compact">
          <p>Noch keine Rezepte für die Planung.</p>
          <div className="empty-state-actions">
            <a className="button primary" href="#/import">
              Rezepte importieren
            </a>
            <a className="button" href="#/recipe/new">
              Neues Rezept
            </a>
          </div>
        </div>
      ) : null}

      {loading ? (
        <p className="empty-state">Lade Essensplan …</p>
      ) : (
        <div className="calendar-layout">
          {calendarLayout.before.length > 0 ? (
            <section className="calendar-overlap-row" aria-label="Tage davor">
              <h2 className="calendar-row-title">Tage davor</h2>
              <div className="calendar-overlap-days">
                {calendarLayout.before.map((day) => renderDay(day, true))}
              </div>
            </section>
          ) : null}

          <section className="calendar-core-row" aria-label="Planungswoche">
            <h2 className="calendar-row-title">Woche</h2>
            <div className="calendar-week">
              {calendarLayout.main.map((day) => renderDay(day, false))}
            </div>
          </section>

          {calendarLayout.after.length > 0 ? (
            <section className="calendar-overlap-row" aria-label="Tage danach">
              <h2 className="calendar-row-title">Tage danach</h2>
              <div className="calendar-overlap-days">
                {calendarLayout.after.map((day) => renderDay(day, true))}
              </div>
            </section>
          ) : null}
        </div>
      )}

      {dialog?.kind === 'free-create' ? (
        <FreeDishDialog
          key={`free-create-${dialog.date}`}
          mode="create"
          initialDate={dialog.date}
          initialEntries={[]}
          weekStartDay={calendarSettings.weekStartDay}
          onDone={handleDone}
          onClose={() => setDialog(null)}
        />
      ) : dialog && (dialog.kind === 'create' || dialogEntry) ? (
        dialog.kind === 'edit' && dialogEntry?.freeDishId ? (
          <FreeDishDialog
            key={`free-edit-${dialog.entryId}`}
            mode="edit"
            initialDate={dialogEntry.date}
            initialEntries={dialogEntries}
            session={dialogSession}
            freeDish={freeDishById.get(dialogEntry.freeDishId)}
            weekStartDay={calendarSettings.weekStartDay}
            onMoveRequest={
              dialogEntry
                ? () => {
                    setDialog(null)
                    openMove(dialogEntry)
                  }
                : undefined
            }
            onDone={handleDone}
            onClose={() => setDialog(null)}
          />
        ) : (
          <DishDialog
            key={
              dialog.kind === 'create'
                ? `create-${dialog.date}`
                : `edit-${dialog.entryId}`
            }
            mode={dialog.kind === 'create' ? 'create' : 'edit'}
            initialDate={
              dialog.kind === 'create' ? dialog.date : dialogEntry?.date ?? today
            }
            initialRecipeId={dialogEntry?.recipeId ?? undefined}
            initialEntries={dialogEntries}
            session={dialogSession}
            recipes={recipes ?? []}
            weekStartDay={calendarSettings.weekStartDay}
            onMoveRequest={
              dialog.kind === 'edit' && dialogEntry
                ? () => {
                    setDialog(null)
                    openMove(dialogEntry)
                  }
                : undefined
            }
            onDone={handleDone}
            onClose={() => setDialog(null)}
          />
        )
      ) : null}

      {addMenuDate ? (
        <AddEntryDialog
          key={addMenuDate}
          date={addMenuDate}
          onChooseRecipe={() => {
            const date = addMenuDate
            setAddMenuDate(null)
            openCreate(date)
          }}
          onChooseFreeDish={() => {
            const date = addMenuDate
            setAddMenuDate(null)
            openCreateFree(date)
          }}
          onChooseNote={() => {
            const date = addMenuDate
            setAddMenuDate(null)
            setNoteDate(date)
          }}
          onClose={() => setAddMenuDate(null)}
        />
      ) : null}

      {noteDate ? (
        <DayNoteDialog
          key={noteDate}
          date={noteDate}
          initialText={noteByDate.get(noteDate)?.text ?? ''}
          onMoveRequest={
            noteByDate.get(noteDate)
              ? (note) => {
                  setNoteDate(null)
                  openMoveNote(note)
                }
              : undefined
          }
          onClose={() => setNoteDate(null)}
        />
      ) : null}

      {moveRequest ? (
        <MoveDialog
          key={moveRequestKey}
          initialDate={moveRequestDate}
          heading={moveRequestHeading}
          subtitle={moveRequestSubtitle}
          weekStartDay={calendarSettings.weekStartDay}
          busy={moving}
          error={error}
          onMove={handleMoveRequest}
          onClose={() => {
            if (moving) return
            setMoveRequest(null)
            setError(null)
          }}
        />
      ) : null}

      {undoOffer ? (
        <div className="move-snackbar" role="status" aria-live="polite">
          <span>
            {undoOffer.kind === 'note'
              ? 'Kommentar verschoben'
              : 'Gericht verschoben'}
          </span>
          <span className="move-snackbar-dot" aria-hidden="true">
            ·
          </span>
          <button
            type="button"
            className="move-snackbar-undo"
            onClick={() => void handleUndoMove()}
            disabled={undoBusy}
          >
            {undoBusy ? 'Rückgängig …' : 'Rückgängig'}
          </button>
        </div>
      ) : null}

      {dragOverlay && typeof document !== 'undefined'
        ? createPortal(
            <CalendarDragOverlay overlay={dragOverlay} />,
            document.body,
          )
        : null}
    </div>
  )
}
