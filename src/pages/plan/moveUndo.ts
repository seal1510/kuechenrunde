import {
  dishPlanMoveSignature,
  type DishPlanMoveSnapshot,
  type MoveDishPlanResult,
} from '../../mealplan/dishService'
import {
  dayNoteSignature,
  type DayNoteMoveSnapshot,
} from '../../mealplan/dayNoteService'
import type { DayNote } from '../../types'

export interface DishMoveUndoOffer {
  kind: 'dish'
  entryId: string
  originalDate: string
  snapshot: DishPlanMoveSnapshot
}

export interface NoteMoveUndoOffer {
  kind: 'note'
  currentDate: string
  originalDate: string
  snapshot: DayNoteMoveSnapshot
}

export type MoveUndoOffer = DishMoveUndoOffer | NoteMoveUndoOffer

/**
 * Only a successful, non-empty move produces an undo offer. A failed move
 * throws in the service, and a no-op result never reaches this helper.
 */
export function createMoveUndoOffer(
  result: MoveDishPlanResult | null,
  entryId: string,
  originalDate: string,
): DishMoveUndoOffer | null {
  if (!result || !result.moved || result.entries.length === 0) return null
  const movedEntry = result.entries.find((entry) => entry.id === entryId)
  if (!movedEntry) return null
  return {
    kind: 'dish',
    entryId,
    originalDate,
    snapshot: {
      cookSessionId: movedEntry.cookSessionId ?? null,
      signature: dishPlanMoveSignature(result.entries, result.session ?? null),
    },
  }
}

/** Snapshot the moved note for the same snackbar/undo flow as dishes. */
export function createNoteUndoOffer(
  movedNote: DayNote,
  originalDate: string,
): NoteMoveUndoOffer {
  return {
    kind: 'note',
    currentDate: movedNote.date,
    originalDate,
    snapshot: { signature: dayNoteSignature(movedNote) },
  }
}
