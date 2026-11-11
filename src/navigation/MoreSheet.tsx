/*
 * Küchenrunde – mobile "Mehr" bottom sheet
 * Copyright (C) 2026 openCook Web contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * A small, dismissible sheet for secondary destinations. It deliberately does
 * not introduce a new page area: every entry links to an existing hash route.
 */

import { useEffect, useRef } from 'react'
import { moreMenuLinks, type MoreMenuLink } from './mobileNavModel'

export interface MoreSheetProps {
  open: boolean
  includeFamily?: boolean
  email?: string
  onLogout?: () => void | Promise<void>
  onClose: () => void
}

function LinkIcon({ icon }: { icon: MoreMenuLink['icon'] }) {
  if (icon === 'url') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path
          d="M10 13a4.5 4.5 0 0 0 6.4.1l2.2-2.2a4.5 4.5 0 0 0-6.4-6.4L10.9 5.8M14 11a4.5 4.5 0 0 0-6.4-.1l-2.2 2.2a4.5 4.5 0 0 0 6.4 6.4l1.3-1.3"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    )
  }
  if (icon === 'mela') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path
          d="M7 3.5h7l4 4v13H7a1.5 1.5 0 0 1-1.5-1.5V5A1.5 1.5 0 0 1 7 3.5Zm7 0v4h4M9.5 12h6M9.5 15.5h6"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    )
  }
  if (icon === 'backup') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path
          d="M4.5 7.5h15v11h-15v-11Zm3-3h9M12 10v5m-2-3 2-2 2 2"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    )
  }
  if (icon === 'family') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path
          d="M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm7 0a2.4 2.4 0 1 0 0-4.8M3.8 19a5.2 5.2 0 0 1 10.4 0M14.8 14.2A4.4 4.4 0 0 1 20.2 19"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    )
  }
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <circle
        cx="12"
        cy="12"
        r="8.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <path
        d="M12 10.8v5M12 7.8h.01"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  )
}

function Chevron() {
  return (
    <svg
      className="more-sheet-chevron"
      viewBox="0 0 16 16"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="m6 3.5 4.5 4.5L6 12.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/**
 * The sheet is rendered only while it is open. Focus moves into it, Tab stays
 * inside, Escape and a backdrop tap close it, and focus returns to the trigger.
 */
export function MoreSheet({
  open,
  includeFamily = false,
  email,
  onLogout,
  onClose,
}: MoreSheetProps) {
  const closeRef = useRef<HTMLButtonElement>(null)
  const restoreFocusRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!open) return

    restoreFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null
    document.body.classList.add('mobile-sheet-open')

    const focusTimer = window.setTimeout(() => closeRef.current?.focus(), 0)

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
        return
      }
      if (event.key !== 'Tab') return

      const sheet = closeRef.current?.closest('.more-sheet')
      if (!sheet) return
      const focusable = Array.from(
        sheet.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((element) => element.offsetParent !== null)
      if (focusable.length === 0) return

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
      document.body.classList.remove('mobile-sheet-open')
      restoreFocusRef.current?.focus()
    }
  }, [open, onClose])

  if (!open) return null

  const links = moreMenuLinks(includeFamily)

  return (
    <div
      className="more-sheet-backdrop"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        id="mobile-more-sheet"
        className="more-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="mobile-more-sheet-title"
      >
        <div className="more-sheet-handle" aria-hidden="true" />
        <div className="more-sheet-head">
          <h2 id="mobile-more-sheet-title">Mehr</h2>
          <button
            ref={closeRef}
            type="button"
            className="more-sheet-close"
            aria-label="Menü schließen"
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

        <nav className="more-sheet-links" aria-label="Weitere Bereiche">
          {links.map((link) => (
            <a
              key={link.href}
              className="more-sheet-link"
              href={link.href}
              onClick={onClose}
            >
              <span className="more-sheet-link-icon" aria-hidden="true">
                <LinkIcon icon={link.icon} />
              </span>
              <span className="more-sheet-link-label">{link.label}</span>
              <Chevron />
            </a>
          ))}
        </nav>

        {email ? (
          <section className="more-sheet-account" aria-label="Angemeldetes Konto">
            <p className="more-sheet-account-label">Angemeldetes Konto</p>
            <p className="more-sheet-account-email">{email}</p>
          </section>
        ) : null}

        {onLogout ? (
          <button
            type="button"
            className="button quiet more-sheet-logout"
            onClick={() => {
              onClose()
              void onLogout()
            }}
          >
            Abmelden
          </button>
        ) : null}
      </div>
    </div>
  )
}
