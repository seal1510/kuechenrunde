/*
 * Küchenrunde – accessible bottom sheet
 * Copyright (C) 2026 openCook Web contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * One reusable sheet for the mobile filter, sorting and shopping-list
 * switchers. It follows the existing "Mehr" sheet visual language, keeps focus
 * inside while open, restores focus on close and leaves the page scroll locked.
 * It is rendered only when open, so closed sheets add no layout or tab stops.
 */

import { useEffect, useId, useRef, type ReactNode } from 'react'

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ')

/** Shared with the "Mehr" sheet; counting avoids unlocking on replacement. */
let openSheetCount = 0

export interface BottomSheetProps {
  open: boolean
  title: string
  onClose: () => void
  children: ReactNode
  className?: string
  id?: string
  description?: string
  closeLabel?: string
}

export function BottomSheet({
  open,
  title,
  onClose,
  children,
  className = '',
  id,
  description,
  closeLabel = 'Schließen',
}: BottomSheetProps) {
  const titleId = useId()
  const descriptionId = useId()
  const sheetRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const restoreFocusRef = useRef<HTMLElement | null>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    if (!open) return

    restoreFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null
    document.body.classList.add('mobile-sheet-open')
    openSheetCount += 1

    const focusTimer = window.setTimeout(() => {
      const preferred = sheetRef.current?.querySelector<HTMLElement>(
        '[data-autofocus]',
      )
      ;(preferred ?? closeRef.current)?.focus()
    }, 0)

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault()
        onCloseRef.current()
        return
      }
      if (event.key !== 'Tab') return

      const sheet = sheetRef.current
      if (!sheet) return
      const focusable = Array.from(
        sheet.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
      ).filter((element) => element.getClientRects().length > 0)
      if (focusable.length === 0) {
        event.preventDefault()
        sheet.focus()
        return
      }

      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => {
      window.clearTimeout(focusTimer)
      document.removeEventListener('keydown', handleKeyDown)
      openSheetCount = Math.max(0, openSheetCount - 1)
      if (openSheetCount === 0) document.body.classList.remove('mobile-sheet-open')
      restoreFocusRef.current?.focus()
    }
  }, [open])

  if (!open) return null

  return (
    <div
      className="more-sheet-backdrop bottom-sheet-backdrop"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        ref={sheetRef}
        id={id}
        className={`more-sheet bottom-sheet${className ? ` ${className}` : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
      >
        <div className="more-sheet-handle" aria-hidden="true" />
        <div className="more-sheet-head bottom-sheet-head">
          <div className="bottom-sheet-heading">
            <h2 id={titleId}>{title}</h2>
            {description ? (
              <p id={descriptionId} className="bottom-sheet-description">
                {description}
              </p>
            ) : null}
          </div>
          <button
            ref={closeRef}
            type="button"
            className="more-sheet-close"
            aria-label={closeLabel}
            onClick={onClose}
          >
            <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
              <path
                d="m5 5 10 10M15 5 5 15"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>

        <div className="bottom-sheet-body">{children}</div>
      </div>
    </div>
  )
}
