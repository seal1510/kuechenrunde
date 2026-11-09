import {
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { createPortal } from 'react-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db'
import {
  addDays,
  formatWeekRange,
  todayKey,
  WEEKDAY_NAMES,
} from '../domain/dates'
import {
  buildCalendarLayout,
  buildCalendarWindow,
  type CalendarSettings,
} from '../domain/calendar'
import { groupThemeFor } from '../domain/groupColor'
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
import { setHouseholdSize } from '../mealplan/service'
import { DEFAULT_HOUSEHOLD_SIZE, type DayNote, type MealPlanEntry } from '../types'
import { AddEntryDialog } from './plan/AddEntryDialog'
import {
  CalendarDragOverlay,
  type CalendarDragOverlayState,
} from './plan/CalendarDragOverlay'
import {
  PlanCalendar,
  dishTitleFor,
  type CalendarDragHandlers,
} from './plan/PlanCalendar'
import { DayNoteDialog } from './plan/DayNoteDialog'
import { DishDialog } from './plan/DishDialog'
import { FreeDishDialog } from './plan/FreeDishDialog'
import { MoveDialog } from './plan/MoveDialog'
import {
  NO_PLANNING_OVERLAY,
  planningBackDate,
  planningSessionReducer,
} from './plan/planningSession'
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

const OVERLAP_OPTIONS = Array.from({ length: 8 }, (_, index) => index)

function normalizePointerType(value: string): DragPointerType {
  return value === 'touch' ? 'touch' : value === 'pen' ? 'pen' : 'mouse'
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

  const [overlay, dispatchOverlay] = useReducer(
    planningSessionReducer,
    NO_PLANNING_OVERLAY,
  )
  const dialog: DialogState | null =
    overlay.kind === 'create'
      ? { kind: 'create', date: overlay.date }
      : overlay.kind === 'free-create'
        ? { kind: 'free-create', date: overlay.date }
        : overlay.kind === 'edit'
          ? { kind: 'edit', entryId: overlay.entryId }
          : null
  const addMenuDate = overlay.kind === 'chooser' ? overlay.date : null
  const noteDate =
    overlay.kind === 'note' || overlay.kind === 'note-direct'
      ? overlay.date
      : null
  const backToAddDate = planningBackDate(overlay)
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
  const householdSize = useMemo(() => {
    const row = (settingsRows ?? []).find((setting) => setting.key === 'householdSize')
    return typeof row?.value === 'number' && Number.isFinite(row.value) && row.value >= 1
      ? Math.round(row.value)
      : DEFAULT_HOUSEHOLD_SIZE
  }, [settingsRows])
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
    dispatchOverlay({ type: 'close' })
    setError(null)
  }

  /** Close a create/edit dialog without saving. */
  function closeDialog() {
    dispatchOverlay({ type: 'close' })
    setError(null)
  }

  function closeNote() {
    dispatchOverlay({ type: 'close' })
  }

  /**
   * Header back action: reopen the shared chooser on the same day. The reducer
   * stores the return date, so this only changes local view state; nothing is
   * persisted and no cook session is created or changed.
   */
  function returnToAddMenu() {
    dispatchOverlay({ type: 'back-to-chooser' })
    setError(null)
  }

  function openCreate(date: string) {
    dispatchOverlay({ type: 'choose-recipe', date })
    setError(null)
  }

  function openCreateFree(date: string) {
    dispatchOverlay({ type: 'choose-free-dish', date })
    setError(null)
  }

  function openEdit(entry: MealPlanEntry) {
    dispatchOverlay({ type: 'open-edit', entryId: entry.id })
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
    dispatchOverlay({ type: 'open-chooser', date })
    setError(null)
  }

  function openNote(date: string) {
    dispatchOverlay({ type: 'open-note', date })
    setError(null)
  }

  function openNoteFromChooser(date: string) {
    dispatchOverlay({ type: 'choose-note', date })
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
    else openNote(item.note.date)
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

  return (
    <div className="page">
      <header className="page-head plan-head">
        <div className="plan-head-copy">
          <h1>Essensplan</h1>
          <p className="plan-range" aria-live="polite">
            {formatWeekRange(calendarWindow.coreStart)}
          </p>
        </div>

        <div className="plan-head-actions">
          <div className="plan-weeknav" role="group" aria-label="Woche wechseln">
            <button
              type="button"
              className="button quiet plan-nav-arrow"
              aria-label="Vorherige Woche"
              onClick={() => setAnchorDate(addDays(anchorDate, -7))}
            >
              ‹
            </button>
            <button
              type="button"
              className="button quiet plan-today"
              onClick={() => setAnchorDate(today)}
            >
              Heute
            </button>
            <button
              type="button"
              className="button quiet plan-nav-arrow"
              aria-label="Nächste Woche"
              onClick={() => setAnchorDate(addDays(anchorDate, 7))}
            >
              ›
            </button>
          </div>

          <details className="plan-menu">
            <summary
              className="button quiet plan-settings-trigger"
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
                <span className="field-label">Haushaltsgröße</span>
                <input
                  type="number"
                  min={1}
                  max={20}
                  value={householdSize}
                  onChange={(event) => {
                    const next = Number(event.target.value)
                    if (Number.isFinite(next) && next >= 1 && next <= 20) {
                      void setHouseholdSize(next)
                    }
                  }}
                />
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
      </header>

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
        <PlanCalendar
          layout={calendarLayout}
          today={today}
          noteByDate={noteByDate}
          dropDate={dropDate}
          recipeById={recipeById}
          freeDishById={freeDishById}
          groupSizeBySession={groupSizeBySession}
          originDragKey={dragOverlay ? dragItemKey(dragOverlay.item) : null}
          highlightedSessionId={
            dragOverlay ? dragOverlay.groupSessionId : hoveredSessionId
          }
          dragHandlers={dragHandlers}
          onAdd={openAdd}
          onHighlightSession={setHoveredSessionId}
        />
      )}

      {dialog?.kind === 'free-create' ? (
        <FreeDishDialog
          key={`free-create-${dialog.date}`}
          mode="create"
          initialDate={dialog.date}
          initialEntries={[]}
          weekStartDay={calendarSettings.weekStartDay}
          onBackToChooser={backToAddDate ? returnToAddMenu : undefined}
          onDone={handleDone}
          onClose={closeDialog}
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
                    closeDialog()
                    openMove(dialogEntry)
                  }
                : undefined
            }
            onDone={handleDone}
            onClose={closeDialog}
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
            onBackToChooser={
              dialog.kind === 'create' && backToAddDate
                ? returnToAddMenu
                : undefined
            }
            onMoveRequest={
              dialog.kind === 'edit' && dialogEntry
                ? () => {
                    closeDialog()
                    openMove(dialogEntry)
                  }
                : undefined
            }
            onDone={handleDone}
            onClose={closeDialog}
          />
        )
      ) : null}

      {addMenuDate ? (
        <AddEntryDialog
          key={addMenuDate}
          date={addMenuDate}
          onChooseRecipe={() => {
            if (addMenuDate) openCreate(addMenuDate)
          }}
          onChooseFreeDish={() => {
            if (addMenuDate) openCreateFree(addMenuDate)
          }}
          onChooseNote={() => {
            if (addMenuDate) openNoteFromChooser(addMenuDate)
          }}
          onClose={closeDialog}
        />
      ) : null}

      {noteDate ? (
        <DayNoteDialog
          key={noteDate}
          date={noteDate}
          initialText={noteByDate.get(noteDate)?.text ?? ''}
          onBackToChooser={backToAddDate ? returnToAddMenu : undefined}
          onMoveRequest={
            noteByDate.get(noteDate)
              ? (note) => {
                  closeNote()
                  openMoveNote(note)
                }
              : undefined
          }
          onClose={closeNote}
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
