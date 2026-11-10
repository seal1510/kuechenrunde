/*
 * Küchenrunde – Cloud-Rezeptbereich
 * Copyright (C) 2026 openCook Web contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Nur die Rezeptbibliothek ist im Cloud-Modus freigeschaltet. Alle anderen
 * Bereiche bleiben sichtbar als „noch nicht verfügbar“ markiert, bis sie
 * korrekt angebunden sind. Die vorhandenen Rezeptkomponenten werden geteilt.
 */

import { useCallback, useState, type ReactNode } from 'react'
import type { CloudRecordsStore } from '../data/cloudRecords'
import { NavigationGuardProvider } from '../routing/NavigationGuard'
import { parseRoute, type Route } from '../routing/routes'
import { CloudLibraryPage } from './CloudLibraryPage'
import { CloudRecipeDetailPage } from './CloudRecipeDetailPage'
import { CloudRecipeEditorPage } from './CloudRecipeEditorPage'

function CloudUnavailablePage() {
  return (
    <div className="page">
      <div className="empty-state">
        <p>Dieser Bereich ist im Cloud-Modus noch nicht verfügbar.</p>
        <p className="muted">
          Wochenplan, Einkaufsliste und Kochmodus werden in den nächsten
          Etappen angebunden. Die Rezeptbibliothek funktioniert bereits
          geräteübergreifend.
        </p>
        <a className="button primary" href="#/">
          Zur Rezeptbibliothek
        </a>
      </div>
    </div>
  )
}

const isLibraryArea = (route: Route): boolean =>
  route.name === 'library' ||
  route.name === 'recipe' ||
  route.name === 'recipe-new' ||
  route.name === 'recipe-edit'

export function CloudRecipesApp({
  store,
  email,
  onLogout,
}: {
  store: CloudRecordsStore
  email: string
  onLogout: () => Promise<void>
}) {
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.hash))
  const applyRoute = useCallback((hash: string) => {
    setRoute(parseRoute(hash))
  }, [])

  let content: ReactNode
  if (route.name === 'library') {
    content = <CloudLibraryPage store={store} />
  } else if (route.name === 'recipe') {
    content = <CloudRecipeDetailPage store={store} id={route.id} />
  } else if (route.name === 'recipe-new') {
    content = <CloudRecipeEditorPage key="new" store={store} />
  } else if (route.name === 'recipe-edit') {
    content = <CloudRecipeEditorPage key={route.id} store={store} id={route.id} />
  } else {
    content = <CloudUnavailablePage />
  }

  return (
    <NavigationGuardProvider applyRoute={applyRoute}>
      <nav className="cloud-nav" aria-label="Cloud-Navigation">
        <a
          href="#/"
          className={isLibraryArea(route) ? 'active' : ''}
          aria-current={isLibraryArea(route) ? 'page' : undefined}
        >
          Rezeptbibliothek
        </a>
        <span className="cloud-nav-note">Wochenplan · Einkauf · Kochen folgen</span>
        <span className="cloud-user">{email}</span>
        <button
          type="button"
          className="button quiet"
          onClick={() => void onLogout()}
        >
          Abmelden
        </button>
      </nav>
      {content}
    </NavigationGuardProvider>
  )
}
