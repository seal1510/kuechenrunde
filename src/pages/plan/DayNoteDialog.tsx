/*
 * openCook Web
 * Copyright (C) 2026 openCook Web contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Day comment editor. It reuses the shared planning panel so comments stay a
 * first-class part of the weekly plan, including on phones and with the
 * keyboard open.
 */

import { useState } from 'react'
import { formatDayLabel } from '../../domain/dates'
import { deleteDayNote, saveDayNote } from '../../mealplan/dayNoteService'
import type { DayNote } from '../../types'
import { draftSignature, useDiscardGuard } from './discardGuard'
import { chooserBackStep } from './planningBack'
import { DiscardPrompt, PlanningPanel } from './PlanningPanel'

export interface DayNoteDialogProps {
  date: string
  initialText: string
  onMoveRequest?: (note: DayNote) => void
  /** Present when the comment was opened from the shared entry chooser. */
  onBackToChooser?: () => void
  onClose: () => void
}

export function DayNoteDialog({
  date,
  initialText,
  onMoveRequest,
  onBackToChooser,
  onClose,
}: DayNoteDialogProps) {
  const [text, setText] = useState(initialText)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const hasSavedNote = initialText.trim().length > 0
  const discard = useDiscardGuard(draftSignature({ text }))
  const backStep = chooserBackStep(Boolean(onBackToChooser))

  function handleRequestClose() {
    if (busy) return
    if (discard.cancelIfPrompted()) return
    discard.request(onClose)
  }

  function handleBack() {
    if (!backStep || !onBackToChooser || busy) return
    if (discard.cancelIfPrompted()) return
    discard.request(onBackToChooser)
  }

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

  const footer = (
    <>
      {discard.prompted ? (
        <DiscardPrompt
          onKeepEditing={discard.cancel}
          onDiscard={discard.confirm}
        />
      ) : null}
      <div className="plan-panel-actions">
        <div className="plan-panel-actions-secondary">
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
              Kommentar löschen
            </button>
          ) : null}
        </div>
        <div className="plan-panel-actions-primary">
          <button
            type="button"
            className="button"
            onClick={handleRequestClose}
            disabled={busy}
          >
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
    </>
  )

  return (
    <PlanningPanel
      title="Kommentar"
      subtitle={formatDayLabel(date)}
      backLabel={backStep?.label}
      onBack={backStep ? handleBack : undefined}
      onRequestClose={handleRequestClose}
      closeDisabled={busy}
      footer={footer}
      className="note-dialog"
    >
      <label className="visually-hidden" htmlFor="day-note-text">
        Kommentar
      </label>
      <textarea
        id="day-note-text"
        className="note-textarea"
        value={text}
        rows={5}
        data-autofocus
        autoFocus
        placeholder="Kommentar zum Tag …"
        onChange={(event) => setText(event.target.value)}
      />

      {error ? (
        <div className="notice danger" role="alert">
          {error}
        </div>
      ) : null}
    </PlanningPanel>
  )
}
