/*
 * openCook Web
 * Copyright (C) 2026 openCook Web contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * One responsive shell for every weekly-planning overlay. On wide screens it
 * is a side panel on the right so the calendar stays visible; on phones it
 * fills the viewport. The shell owns dialog semantics, focus handling, the
 * background scroll lock and the sticky action footer. The dialogs keep their
 * own state and persistence logic unchanged.
 */

import {
  useEffect,
  useId,
  useRef,
  type ReactNode,
} from 'react'

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'summary',
  '[tabindex]:not([tabindex="-1"])',
].join(', ')

export interface PlanningPanelProps {
  title: string
  subtitle?: ReactNode
  /** Accessible label for the optional back action. */
  backLabel?: string
  onBack?: () => void
  onRequestClose: () => void
  closeDisabled?: boolean
  footer?: ReactNode
  children: ReactNode
  className?: string
  /**
   * When this value changes the panel moves focus back into its content, e.g.
   * after switching from the recipe picker to the planning form.
   */
  focusKey?: string
}

function visibleFocusable(panel: HTMLElement): HTMLElement[] {
  return Array.from(
    panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
  ).filter(
    (element) =>
      element.getClientRects().length > 0 &&
      element.getAttribute('aria-hidden') !== 'true',
  )
}

export function PlanningPanel({
  title,
  subtitle,
  backLabel = 'Zurück',
  onBack,
  onRequestClose,
  closeDisabled = false,
  footer,
  children,
  className = '',
  focusKey,
}: PlanningPanelProps) {
  const titleId = `${useId()}-title`
  const panelRef = useRef<HTMLElement>(null)
  const requestCloseRef = useRef(onRequestClose)
  requestCloseRef.current = onRequestClose

  useEffect(() => {
    const panel = panelRef.current
    const previouslyFocused =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null

    document.body.classList.add('plan-panel-open')

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault()
        requestCloseRef.current()
        return
      }
      if (event.key !== 'Tab' || !panel) return

      const focusable = visibleFocusable(panel)
      if (focusable.length === 0) {
        event.preventDefault()
        panel.focus()
        return
      }
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      const active = document.activeElement
      if (
        !active ||
        !panel.contains(active) ||
        (event.shiftKey && active === first)
      ) {
        event.preventDefault()
        ;(event.shiftKey ? last : first).focus()
        return
      }
      if (!event.shiftKey && active === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.body.classList.remove('plan-panel-open')
      if (previouslyFocused?.isConnected) previouslyFocused.focus()
    }
  }, [])

  useEffect(() => {
    const panel = panelRef.current
    if (!panel) return
    const target =
      panel.querySelector<HTMLElement>('[data-autofocus]') ??
      panel.querySelector<HTMLElement>('[data-panel-focus]') ??
      panel
    target.focus()
  }, [focusKey])

  return (
    <div
      className="plan-panel-backdrop"
      role="presentation"
      onClick={onRequestClose}
    >
      <section
        ref={panelRef}
        className={`plan-panel ${className}`.trim()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="plan-panel-head">
          {onBack ? (
            <button
              type="button"
              className="plan-panel-back"
              aria-label={backLabel}
              title={backLabel}
              onClick={onBack}
              disabled={closeDisabled}
            >
              <span aria-hidden="true">‹</span>
            </button>
          ) : null}
          <div className="plan-panel-heading">
            <h2 id={titleId} tabIndex={-1} data-panel-focus>
              {title}
            </h2>
            {subtitle ? (
              <p className="plan-panel-subtitle">{subtitle}</p>
            ) : null}
          </div>
          <button
            type="button"
            className="plan-panel-close"
            aria-label="Schließen"
            title="Schließen"
            onClick={onRequestClose}
            disabled={closeDisabled}
          >
            <span aria-hidden="true">×</span>
          </button>
        </header>

        <div className="plan-panel-body">{children}</div>

        {footer ? <footer className="plan-panel-footer">{footer}</footer> : null}
      </section>
    </div>
  )
}

export interface DiscardPromptProps {
  onKeepEditing: () => void
  onDiscard: () => void
}

/** Local confirmation inside the panel, never a second nested overlay. */
export function DiscardPrompt({
  onKeepEditing,
  onDiscard,
}: DiscardPromptProps) {
  const keepRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    keepRef.current?.focus()
  }, [])

  return (
    <div
      className="plan-discard"
      role="alertdialog"
      aria-modal="false"
      aria-labelledby="plan-discard-title"
      aria-describedby="plan-discard-description"
    >
      <div className="plan-discard-copy">
        <h3 id="plan-discard-title">Änderungen verwerfen?</h3>
        <p id="plan-discard-description">
          Nicht gespeicherte Esstage und Portionen gehen verloren.
        </p>
      </div>
      <div className="plan-discard-actions">
        <button
          ref={keepRef}
          type="button"
          className="button"
          onClick={onKeepEditing}
        >
          Weiter bearbeiten
        </button>
        <button
          type="button"
          className="button danger"
          onClick={onDiscard}
        >
          Verwerfen
        </button>
      </div>
    </div>
  )
}
