/*
 * openCook Web
 * Copyright (C) 2026 openCook Web contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Sticky editor action bar. On desktop it stays below the app header; on
 * phones it becomes the familiar fixed bottom action row.
 */

import { editorSaveState } from '../recipe/editorSession'

export interface EditorActionBarProps {
  formId: string
  saving: boolean
  dirty: boolean
  isNew: boolean
  onCancel: () => void
}

export function EditorActionBar({
  formId,
  saving,
  dirty,
  isNew,
  onCancel,
}: EditorActionBarProps) {
  return (
    <div className="editor-actionbar" role="group" aria-label="Speichern und abbrechen">
      <span
        className={`editor-save-state${dirty ? ' is-dirty' : ''}`}
        role="status"
        aria-live="polite"
      >
        <span className="editor-save-dot" aria-hidden="true" />
        {editorSaveState({ saving, dirty, isNew })}
      </span>
      <div className="editor-actionbar-buttons">
        <button
          type="button"
          className="button quiet"
          onClick={onCancel}
          disabled={saving}
        >
          Abbrechen
        </button>
        <button
          type="submit"
          form={formId}
          className="button primary"
          disabled={saving}
          aria-busy={saving}
        >
          {saving ? 'Speichere …' : 'Speichern'}
        </button>
      </div>
    </div>
  )
}
