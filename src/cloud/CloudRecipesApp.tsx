/*
 * Küchenrunde – Cloud-Rezeptbereich
 * Copyright (C) 2026 openCook Web contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Rezeptbibliothek und Wochenplan sind im Cloud-Modus freigeschaltet.
 * Einkaufsliste und Kochmodus bleiben sichtbar als „noch nicht verfügbar“
 * markiert, bis sie korrekt angebunden sind. Die vorhandenen Rezept- und
 * Planungskomponenten werden geteilt; nur die Persistenz ist cloudbasiert.
 *
 * Hier wird außerdem die einzige Bild-Laufzeit erzeugt: Signed-URL-Cache,
 * Storage-Zugriff und Metadaten-Service. Beim Logout wird der Cache verworfen.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react'
import { CloudImageUrlCache } from '../data/cloudImageUrls'
import { CloudRecipeImageService } from '../data/cloudImages'
import type { CloudRecordsStore } from '../data/cloudRecords'
import { PlanBackendProvider } from '../mealplan/planBackend'
import { PlanPage } from '../pages/PlanPage'
import { NavigationGuardProvider } from '../routing/NavigationGuard'
import { parseRoute, type Route } from '../routing/routes'
import { requireSupabase } from '../supabase/client'
import { createSupabaseImageStorage } from '../supabase/imageStorage'
import { CloudImageUrlProvider } from './CloudImageProvider'
import { createCloudPlanBackend } from './cloudPlanBackend'
import { CloudLibraryPage } from './CloudLibraryPage'
import {
  clearCloudImageNotice,
  getCloudImageNotice,
  subscribeCloudImageNotice,
} from './cloudImageNotice'
import { CloudRecipeDetailPage } from './CloudRecipeDetailPage'
import { CloudRecipeEditorPage } from './CloudRecipeEditorPage'

function CloudUnavailablePage() {
  return (
    <div className="page">
      <div className="empty-state">
        <p>Dieser Bereich ist im Cloud-Modus noch nicht verfügbar.</p>
        <p className="muted">
          Einkaufsliste und Kochmodus werden in den nächsten Etappen
          angebunden. Rezeptbibliothek, Bilder und Wochenplan funktionieren
          bereits geräteübergreifend.
        </p>
        <a className="button primary" href="#/plan">
          Zum Wochenplan
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

  const storage = useMemo(
    () => createSupabaseImageStorage(requireSupabase()),
    [],
  )
  const imageUrls = useMemo(
    () => new CloudImageUrlCache({ storage }),
    [storage],
  )
  const imageService = useMemo(
    () => new CloudRecipeImageService({ records: store, storage }),
    [store, storage],
  )
  const planBackend = useMemo(() => createCloudPlanBackend(store), [store])
  const notice = useSyncExternalStore(
    subscribeCloudImageNotice,
    getCloudImageNotice,
    getCloudImageNotice,
  )

  // Signed URLs sind sitzungsgebunden und dürfen nach dem Logout nicht
  // weiterverwendet werden. `clear()` (statt `dispose()`) bleibt auch bei der
  // StrictMode-Doppelmontage im Entwicklungsmodus wiederverwendbar.
  useEffect(() => () => imageUrls.clear(), [imageUrls])

  let content: ReactNode
  if (route.name === 'library') {
    content = <CloudLibraryPage store={store} />
  } else if (route.name === 'plan') {
    content = <PlanPage />
  } else if (route.name === 'recipe') {
    content = <CloudRecipeDetailPage store={store} id={route.id} />
  } else if (route.name === 'recipe-new') {
    content = <CloudRecipeEditorPage key="new" store={store} images={imageService} />
  } else if (route.name === 'recipe-edit') {
    content = (
      <CloudRecipeEditorPage
        key={route.id}
        store={store}
        images={imageService}
        id={route.id}
      />
    )
  } else {
    content = <CloudUnavailablePage />
  }

  return (
    <PlanBackendProvider value={planBackend}>
      <NavigationGuardProvider applyRoute={applyRoute}>
        <nav className="cloud-nav" aria-label="Cloud-Navigation">
          <a
            href="#/"
            className={isLibraryArea(route) ? 'active' : ''}
            aria-current={isLibraryArea(route) ? 'page' : undefined}
          >
            Rezeptbibliothek
          </a>
          <a
            href="#/plan"
            className={route.name === 'plan' ? 'active' : ''}
            aria-current={route.name === 'plan' ? 'page' : undefined}
          >
            Wochenplan
          </a>
          <span className="cloud-nav-note">Einkauf · Kochen folgen</span>
          <span className="cloud-user">{email}</span>
          <button
            type="button"
            className="button quiet"
            onClick={() => {
              clearCloudImageNotice()
              void onLogout()
            }}
          >
            Abmelden
          </button>
        </nav>
        {notice ? (
          <div className="notice cloud-image-notice" role="status">
            <p>{notice}</p>
            <div className="notice-actions">
              <button
                type="button"
                className="button quiet"
                onClick={clearCloudImageNotice}
              >
                Hinweis schließen
              </button>
            </div>
          </div>
        ) : null}
        <CloudImageUrlProvider cache={imageUrls}>{content}</CloudImageUrlProvider>
      </NavigationGuardProvider>
    </PlanBackendProvider>
  )
}
