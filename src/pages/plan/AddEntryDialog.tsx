import { formatDayLabel } from '../../domain/dates'

export interface AddEntryDialogProps {
  date: string
  onChooseRecipe: () => void
  onChooseFreeDish: () => void
  onChooseNote: () => void
  onClose: () => void
}

/**
 * Small shared entry chooser for one day: library recipe, plan-only free dish
 * or comment. All three options keep using the same calendar add button.
 */
export function AddEntryDialog({
  date,
  onChooseRecipe,
  onChooseFreeDish,
  onChooseNote,
  onClose,
}: AddEntryDialogProps) {
  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="modal add-entry-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={`Eintrag für ${formatDayLabel(date)} hinzufügen`}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="modal-head">
          <div>
            <h2>Hinzufügen</h2>
            <p className="muted small">{formatDayLabel(date)}</p>
          </div>
          <button type="button" className="button quiet" onClick={onClose}>
            Schließen
          </button>
        </div>

        <div className="add-entry-options">
          <button type="button" className="add-entry-option" onClick={onChooseRecipe}>
            Rezept
          </button>
          <button type="button" className="add-entry-option" onClick={onChooseFreeDish}>
            Freies Gericht
          </button>
          <button type="button" className="add-entry-option" onClick={onChooseNote}>
            Kommentar
          </button>
        </div>
      </div>
    </div>
  )
}
