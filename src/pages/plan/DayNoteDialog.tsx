import { useState } from 'react'
import { formatDayLabel } from '../../domain/dates'
import { deleteDayNote, saveDayNote } from '../../mealplan/dayNoteService'
import type { DayNote } from '../../types'

export interface DayNoteDialogProps {
  date: string
  initialText: string
  onMoveRequest?: (note: DayNote) => void
  onClose: () => void
}

export function DayNoteDialog({
  date,
  initialText,
  onMoveRequest,
  onClose,
}: DayNoteDialogProps) {
  const [text, setText] = useState(initialText)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const hasSavedNote = initialText.trim().length > 0

  async function handleSave() {
    setBusy(true)
    setError(null)
    try {
      await saveDayNote(date, text)
      onClose()
    } catch (cause) {
      setError((cause as Error).message || 'Der Kommentar konnte nicht gespeichert werden.')
    } finally {
      setBusy(false)
    }
  }

  async function handleDelete() {
    if (!window.confirm('Kommentar löschen?')) return
    setBusy(true)
    setError(null)
    try {
      await deleteDayNote(date)
      onClose()
    } catch (cause) {
      setError((cause as Error).message || 'Der Kommentar konnte nicht gelöscht werden.')
    } finally {
      setBusy(false)
    }
  }

  async function handleMove() {
    if (!onMoveRequest) return
    if (!text.trim()) {
      setError('Bitte einen Kommentar eingeben.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const saved = await saveDayNote(date, text)
      if (!saved) {
        setError('Bitte einen Kommentar eingeben.')
        return
      }
      onMoveRequest(saved)
    } catch (cause) {
      setError(
        (cause as Error).message || 'Der Kommentar konnte nicht gespeichert werden.',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="modal note-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={`Kommentar für ${formatDayLabel(date)}`}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="modal-head">
          <div>
            <h2>Kommentar</h2>
            <p className="muted small">{formatDayLabel(date)}</p>
          </div>
          <button type="button" className="button quiet" onClick={onClose} disabled={busy}>
            Schließen
          </button>
        </div>

        <label className="visually-hidden" htmlFor="day-note-text">
          Kommentar
        </label>
        <textarea
          id="day-note-text"
          className="note-textarea"
          value={text}
          rows={5}
          autoFocus
          placeholder="Kommentar zum Tag …"
          onChange={(event) => setText(event.target.value)}
        />

        {error ? (
          <div className="notice danger" role="alert">
            {error}
          </div>
        ) : null}

        <div className="note-dialog-actions">
          <div className="dialog-actions-left">
            {hasSavedNote && onMoveRequest ? (
              <button
                type="button"
                className="button quiet"
                onClick={() => void handleMove()}
                disabled={busy || !text.trim()}
              >
                Verschieben
              </button>
            ) : null}
            {hasSavedNote ? (
              <button
                type="button"
                className="button danger-quiet"
                onClick={() => void handleDelete()}
                disabled={busy}
              >
                Löschen
              </button>
            ) : null}
          </div>
          <div className="dialog-actions-right">
            <button type="button" className="button" onClick={onClose} disabled={busy}>
              Abbrechen
            </button>
            <button
              type="button"
              className="button primary"
              onClick={() => void handleSave()}
              disabled={busy}
            >
              {busy ? 'Speichere …' : 'Speichern'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
