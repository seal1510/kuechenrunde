/*
 * Küchenrunde – shared application header
 * Copyright (C) 2026 openCook Web contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The desktop navigation remains page-specific and is passed as children. On
 * phones the header keeps the brand plus the shared three-dot secondary menu.
 */

import type { ReactNode } from 'react'
import { MobileMoreMenuButton } from '../navigation/MobileMoreMenu'

export interface AppHeaderProps {
  subtitle: string
  badge?: ReactNode
  children?: ReactNode
  /**
   * Local mode links the brand to the library. The cloud shell keeps its
   * previous non-link brand (`null`).
   */
  brandHref?: string | null
}

export function AppHeader({
  subtitle,
  badge,
  children,
  brandHref = '#/',
}: AppHeaderProps) {
  const brand = (
    <>
      <img
        className="brand-mark"
        src="/icons/icon-192.png"
        alt=""
        width={34}
        height={34}
        decoding="async"
      />
      <span>
        <strong>Küchenrunde</strong>
        <small className="brand-subtitle">{subtitle}</small>
      </span>
    </>
  )

  return (
    <header className="app-header">
      <div className="app-header-inner">
        {brandHref === null ? (
          <div className="brand">{brand}</div>
        ) : (
          <a className="brand" href={brandHref}>
            {brand}
          </a>
        )}
        {children}
        {badge}
        <MobileMoreMenuButton />
      </div>
    </header>
  )
}
