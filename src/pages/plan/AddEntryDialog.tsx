import { formatDayLabel } from '../../domain/dates'
import { PlanningPanel } from './PlanningPanel'

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
    <PlanningPanel
      title="Hinzufügen"
      subtitle={formatDayLabel(date)}
      onRequestClose={onClose}
      className="add-entry-dialog"
    >
      <div className="add-entry-options">
        <button
          type="button"
          className="add-entry-option"
          onClick={onChooseRecipe}
        >
          <span className="add-entry-option-title">Rezept</span>
          <span className="add-entry-option-hint">
            Aus der Rezeptbibliothek planen
          </span>
        </button>
        <button
          type="button"
          className="add-entry-option"
          onClick={onChooseFreeDish}
        >
          <span className="add-entry-option-title">Freies Gericht</span>
          <span className="add-entry-option-hint">
            Gericht ohne gespeichertes Rezept notieren
          </span>
        </button>
        <button
          type="button"
          className="add-entry-option"
          onClick={onChooseNote}
        >
          <span className="add-entry-option-title">Kommentar</span>
          <span className="add-entry-option-hint">Notiz zum Tag festhalten</span>
        </button>
      </div>
    </PlanningPanel>
  )
}
