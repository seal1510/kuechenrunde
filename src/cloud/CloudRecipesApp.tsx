/*
 * Küchenrunde – Cloud-Rezeptbereich
 * Copyright (C) 2026 openCook Web contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Rezeptbibliothek, Wochenplan, Einkaufsliste und Kochmodus sind im
 * Cloud-Modus freigeschaltet. Die vorhandenen Rezept-, Planungs-, Einkaufs-
 * und Kochkomponenten werden geteilt; nur die gemeinsame Persistenz ist
 * cloudbasiert. Timer, Wake Lock und Kochfortschritt bleiben gerätelokal.
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
import { CookBackendProvider } from '../cook/cookBackend'
import { CloudImageUrlCache } from '../data/cloudImageUrls'
import { CloudRecipeImageService } from '../data/cloudImages'
import type { CloudRecordsStore } from '../data/cloudRecords'
import { PlanBackendProvider } from '../mealplan/planBackend'
import { isLibraryArea } from '../navigation/mobileNavModel'
import { MobileNavigation } from '../navigation/MobileNavigation'
import { CookPage } from '../pages/CookPage'
import { PlanPage } from '../pages/PlanPage'
import { ShoppingPage } from '../pages/ShoppingPage'
import { NavigationGuardProvider } from '../routing/NavigationGuard'
import { parseRoute, type Route } from '../routing/routes'
import { requireSupabase } from '../supabase/client'
import { createSupabaseImageStorage } from '../supabase/imageStorage'
import { ShoppingBackendProvider } from '../shopping/shoppingBackend'
import { CloudImageUrlProvider } from './CloudImageProvider'
import { createCloudCookBackend } from './cloudCookBackend'
import { createCloudPlanBackend } from './cloudPlanBackend'
import { createCloudShoppingBackend } from './cloudShoppingBackend'
import { CloudLibraryPage } from './CloudLibraryPage'
import {
  clearCloudImageNotice,
  getCloudImageNotice,
  subscribeCloudImageNotice,
} from './cloudImageNotice'
import { CloudRecipeDetailPage } from './CloudRecipeDetailPage'
import { CloudRecipeEditorPage } from './CloudRecipeEditorPage'
import { CloudUrlImportPage } from './CloudUrlImportPage'
import { CloudImportPage } from './CloudImportPage'
import { CloudBackupPage } from './CloudBackupPage'
import { FamilyPage } from './FamilyPage'
import { AboutPage } from '../pages/AboutPage'

function CloudUnavailablePage() {
  return (
    <div className="page">
      <div className="empty-state">
        <p>Dieser Bereich ist im Cloud-Modus noch nicht verfügbar.</p>
        <p className="muted">
          Rezeptbibliothek, Bilder, Wochenplan, Einkaufsliste und Kochmodus
          funktionieren bereits geräteübergreifend. Dieser Bereich gehört nicht
          dazu.
        </p>
        <a className="button primary" href="#/">
          Zur Rezeptbibliothek
        </a>
      </div>
    </div>
  )
}

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
  const handleLogout = useCallback(() => {
    clearCloudImageNotice()
    void onLogout()
  }, [onLogout])

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
  const shoppingBackend = useMemo(
    () => createCloudShoppingBackend(store),
    [store],
  )
  const cookBackend = useMemo(() => createCloudCookBackend(store), [store])
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
  } else if (route.name === 'shopping') {
    content = <ShoppingPage />
  } else if (route.name === 'cook') {
    content = (
      <CookPage
        key={`${route.recipeId}:${route.cookSessionId ?? ''}`}
        recipeId={route.recipeId}
        cookSessionId={route.cookSessionId}
      />
    )
  } else if (route.name === 'recipe') {
    content = <CloudRecipeDetailPage store={store} id={route.id} />
  } else if (route.name === 'import') {
    content = <CloudImportPage store={store} images={imageService} />
  } else if (route.name === 'import-url') {
    content = <CloudUrlImportPage store={store} images={imageService} />
  } else if (route.name === 'backup') {
    content = <CloudBackupPage store={store} storage={storage} />
  } else if (route.name === 'family') {
    content = <FamilyPage />
  } else if (route.name === 'about') {
    content = <AboutPage />
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
      <ShoppingBackendProvider value={shoppingBackend}>
        <CookBackendProvider value={cookBackend}>
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
              <a
                href="#/shopping"
                className={route.name === 'shopping' ? 'active' : ''}
                aria-current={route.name === 'shopping' ? 'page' : undefined}
              >
                Einkaufsliste
              </a>
              <a
                href="#/import"
                className={route.name === 'import' || route.name === 'import-url' ? 'active' : ''}
                aria-current={
                  route.name === 'import' || route.name === 'import-url' ? 'page' : undefined
                }
              >
                Import
              </a>
              <a
                href="#/backup"
                className={route.name === 'backup' ? 'active' : ''}
                aria-current={route.name === 'backup' ? 'page' : undefined}
              >
                Backup
              </a>
              <a
                href="#/family"
                className={route.name === 'family' ? 'active' : ''}
                aria-current={route.name === 'family' ? 'page' : undefined}
              >
                Familie
              </a>
              <a
                href="#/about"
                className={route.name === 'about' ? 'active' : ''}
                aria-current={route.name === 'about' ? 'page' : undefined}
              >
                Über
              </a>
              <span className="cloud-user">{email}</span>
              <button
                type="button"
                className="button quiet"
                onClick={handleLogout}
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
            {route.name === 'cook' ? null : (
              <MobileNavigation
                route={route}
                email={email}
                includeFamily
                onLogout={handleLogout}
              />
            )}
          </NavigationGuardProvider>
        </CookBackendProvider>
      </ShoppingBackendProvider>
    </PlanBackendProvider>
  )
}
