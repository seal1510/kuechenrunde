import type { CSSProperties } from 'react'
import { formatPortionCount } from '../../lib/format'
import type { DragItem } from './dragItem'

export type DragPhase = 'dragging' | 'dropping' | 'settling' | 'returning'

export interface CalendarDragOverlayState {
  item: DragItem
  /** Recipe title or free-dish name shown on the floating card. */
  dishTitle: string
  groupColorIndex: number | null
  groupSessionId: string | null
  left: number
  top: number
  width: number
  height: number
  originLeft: number
  originTop: number
  offsetX: number
  offsetY: number
  phase: DragPhase
}

/** Floating full copy of the dragged card. It never receives pointer events. */
export function CalendarDragOverlay({
  overlay,
}: {
  overlay: CalendarDragOverlayState
}) {
  const transform =
    overlay.phase === 'settling'
      ? 'scale(0.96)'
      : overlay.phase === 'returning'
        ? 'scale(1)'
        : 'scale(1.03) translateY(-2px)'
  const style: CSSProperties = {
    left: overlay.left,
    top: overlay.top,
    width: overlay.width,
    height: overlay.height,
    transform,
    opacity: overlay.phase === 'settling' ? 0 : 1,
    transition:
      overlay.phase === 'dragging' || overlay.phase === 'dropping'
        ? 'none'
        : 'left 170ms ease, top 170ms ease, transform 170ms ease, opacity 170ms ease',
  }
  const groupClass =
    overlay.groupColorIndex === null
      ? ''
      : ` calendar-entry--group group-color-${overlay.groupColorIndex} is-group-highlighted`

  return (
    <div className={`calendar-drag-overlay is-${overlay.phase}`} style={style} aria-hidden="true">
      {overlay.item.kind === 'note' ? (
        <div className="calendar-entry calendar-note-entry">
          <span className="calendar-note-text">{overlay.item.note.text}</span>
        </div>
      ) : (
        <div className={`calendar-entry calendar-entry--dish${groupClass}`}>
          <span className="calendar-entry-title">{overlay.dishTitle}</span>
          <span className="calendar-entry-meta">
            {formatPortionCount(overlay.item.entry.servings ?? 1)}
          </span>
        </div>
      )}
    </div>
  )
}
