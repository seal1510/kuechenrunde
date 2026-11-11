/*
 * Küchenrunde – shared mobile "Mehr" menu
 * Copyright (C) 2026 openCook Web contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The phone header owns the three-dot trigger. The existing MoreSheet stays the
 * single secondary menu; this module only shares its open state between the
 * header button and the sheet.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { MoreSheet, type MoreSheetProps } from './MoreSheet'

export interface MobileMoreMenuApi {
  enabled: boolean
  open: boolean
  openMore: () => void
  closeMore: () => void
}

const MobileMoreMenuContext = createContext<MobileMoreMenuApi | null>(null)

export interface MobileMoreMenuProviderProps
  extends Pick<MoreSheetProps, 'includeFamily' | 'email' | 'onLogout'> {
  children: ReactNode
  /** Cloud pages without a usable account do not show the secondary menu. */
  enabled?: boolean
}

export function MobileMoreMenuProvider({
  children,
  includeFamily,
  email,
  onLogout,
  enabled = true,
}: MobileMoreMenuProviderProps) {
  const [open, setOpen] = useState(false)
  const openMore = useCallback(() => setOpen(true), [])
  const closeMore = useCallback(() => setOpen(false), [])

  useEffect(() => {
    if (!enabled) setOpen(false)
  }, [enabled])

  // Browser back, an in-sheet link or any other hash navigation must not leave
  // the sheet on top of the new page.
  useEffect(() => {
    if (!open) return
    const close = () => setOpen(false)
    window.addEventListener('hashchange', close)
    return () => window.removeEventListener('hashchange', close)
  }, [open])

  const value = useMemo<MobileMoreMenuApi>(
    () => ({
      enabled,
      open: enabled && open,
      openMore,
      closeMore,
    }),
    [enabled, open, openMore, closeMore],
  )

  return (
    <MobileMoreMenuContext.Provider value={value}>
      {children}
      {enabled ? (
        <MoreSheet
          open={open}
          includeFamily={includeFamily}
          email={email}
          onLogout={onLogout}
          onClose={closeMore}
        />
      ) : null}
    </MobileMoreMenuContext.Provider>
  )
}

/** Optional so components can also render outside the provider in tests. */
export function useMobileMoreMenu(): MobileMoreMenuApi | null {
  return useContext(MobileMoreMenuContext)
}

/**
 * Small touch-sized three-dot trigger for the phone header. It is hidden by
 * CSS on the desktop layout, where the existing navigation stays unchanged.
 */
export function MobileMoreMenuButton() {
  const menu = useMobileMoreMenu()
  if (!menu?.enabled) return null

  return (
    <button
      type="button"
      className={`mobile-menu-button${menu.open ? ' is-open' : ''}`}
      aria-label={menu.open ? 'Mehr-Menü schließen' : 'Mehr-Menü öffnen'}
      aria-haspopup="dialog"
      aria-expanded={menu.open}
      aria-controls="mobile-more-sheet"
      onClick={() => {
        if (menu.open) menu.closeMore()
        else menu.openMore()
      }}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <circle cx="5" cy="12" r="1.7" fill="currentColor" />
        <circle cx="12" cy="12" r="1.7" fill="currentColor" />
        <circle cx="19" cy="12" r="1.7" fill="currentColor" />
      </svg>
    </button>
  )
}
