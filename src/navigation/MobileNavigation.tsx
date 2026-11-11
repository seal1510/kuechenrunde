/*
 * Küchenrunde – permanent phone bottom navigation
 * Copyright (C) 2026 openCook Web contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * On narrow screens this replaces the wrapped desktop link rows. The three
 * destinations reuse the existing hash routes and are spread evenly. The
 * secondary menu lives in the phone header (MobileMoreMenu) instead. The
 * component is CSS-hidden from the desktop breakpoint up.
 */

import { useEffect } from 'react'
import type { Route } from '../routing/routes'
import { useMobileMoreMenu } from './MobileMoreMenu'
import {
  MOBILE_NAV_ITEMS,
  mobileAreaForRoute,
  mobileRouteKey,
  type MobileArea,
} from './mobileNavModel'

export interface MobileNavigationProps {
  route: Route
}

function NavIcon({ area }: { area: MobileArea }) {
  if (area === 'recipes') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path
          d="M4.5 5.2c2.7-1 5.2-.7 7.5.9v13c-2.3-1.6-4.8-1.9-7.5-.9v-13Zm15 0c-2.7-1-5.2-.7-7.5.9v13c2.3-1.6 4.8-1.9 7.5-.9v-13Z"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    )
  }
  if (area === 'plan') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path
          d="M5 5.5h14v14H5v-14Zm0 4.5h14M8.5 3.5v4M15.5 3.5v4M8.5 13.5h2M13.5 13.5h2M8.5 16.5h2"
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
      <path
        d="M4.5 8.5h15l-1.2 10H5.7l-1.2-10Zm3.5 0V7a4 4 0 0 1 8 0v1.5M9 12.5v3M12 12.5v3M15 12.5v3"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  if (target.tagName === 'TEXTAREA') return true
  if (target.tagName === 'SELECT') return true
  if (target.tagName !== 'INPUT') return false
  const type = (target as HTMLInputElement).type
  return ![
    'button',
    'checkbox',
    'color',
    'file',
    'hidden',
    'image',
    'radio',
    'range',
    'reset',
    'submit',
  ].includes(type)
}

/**
 * While an input is focused the iPhone keyboard covers the lower part of the
 * viewport. Hiding the bar prevents it from sitting on top of form controls.
 */
function useHideNavWhileTyping() {
  useEffect(() => {
    const root = document.documentElement
    let blurTimer: number | undefined

    function handleFocusIn(event: FocusEvent) {
      if (!isEditableTarget(event.target)) return
      window.clearTimeout(blurTimer)
      root.classList.add('kr-keyboard-open')
    }

    function handleFocusOut() {
      window.clearTimeout(blurTimer)
      blurTimer = window.setTimeout(() => {
        if (!isEditableTarget(document.activeElement)) {
          root.classList.remove('kr-keyboard-open')
        }
      }, 0)
    }

    document.addEventListener('focusin', handleFocusIn, true)
    document.addEventListener('focusout', handleFocusOut, true)
    return () => {
      window.clearTimeout(blurTimer)
      document.removeEventListener('focusin', handleFocusIn, true)
      document.removeEventListener('focusout', handleFocusOut, true)
      root.classList.remove('kr-keyboard-open')
    }
  }, [])
}

export function MobileNavigation({ route }: MobileNavigationProps) {
  const activeArea = mobileAreaForRoute(route)
  const routeKey = mobileRouteKey(route)
  const menu = useMobileMoreMenu()
  const closeMore = menu?.closeMore

  useHideNavWhileTyping()

  // A deep link or the browser back button changes the route; the shared
  // secondary sheet must not stay on top of the new page.
  useEffect(() => {
    closeMore?.()
  }, [routeKey, closeMore])

  return (
    <nav className="mobile-nav" aria-label="Mobile Hauptnavigation">
      {MOBILE_NAV_ITEMS.map((item) => {
        const isActive = activeArea === item.area
        return (
          <a
            key={item.area}
            className={`mobile-nav-item${isActive ? ' is-active' : ''}`}
            href={item.href ?? '#/'}
            aria-current={isActive ? 'page' : undefined}
            onClick={closeMore}
          >
            <NavIcon area={item.area} />
            <span>{item.label}</span>
          </a>
        )
      })}
    </nav>
  )
}
