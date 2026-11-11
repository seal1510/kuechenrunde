/*
 * Küchenrunde – phone layout detection
 * Copyright (C) 2026 openCook Web contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The existing phone shell uses this exact media query: portrait phones up to
 * 720px and landscape phones with a short, touch-first viewport. Components
 * that need a different DOM order on phones (for example the collapsed past
 * days in the weekly plan) reuse the same query so CSS and markup cannot
 * drift apart.
 */

import { useSyncExternalStore } from 'react'

export const PHONE_LAYOUT_QUERY =
  '(max-width: 720px), (max-height: 500px) and (max-width: 1024px) and (pointer: coarse)'

function mediaQueryList(): MediaQueryList | null {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return null
  }
  return window.matchMedia(PHONE_LAYOUT_QUERY)
}

function subscribe(onChange: () => void): () => void {
  const query = mediaQueryList()
  if (!query) return () => undefined
  if (typeof query.addEventListener === 'function') {
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }
  query.addListener(onChange)
  return () => query.removeListener(onChange)
}

function getSnapshot(): boolean {
  return mediaQueryList()?.matches ?? false
}

/** Server rendering and the first non-browser render stay desktop-first. */
function getServerSnapshot(): boolean {
  return false
}

export function usePhoneLayout(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}
