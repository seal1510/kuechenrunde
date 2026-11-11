import { useCallback, useState } from 'react'
import { AppHeader } from './components/AppHeader'
import { LibraryPage } from './pages/LibraryPage'
import { RecipePage } from './pages/RecipePage'
import { RecipeEditorPage } from './pages/RecipeEditorPage'
import { CookPage } from './pages/CookPage'
import { LocalImportPage } from './pages/LocalImportPage'
import { LocalUrlImportPage } from './pages/LocalUrlImportPage'
import { PlanPage } from './pages/PlanPage'
import { ShoppingPage } from './pages/ShoppingPage'
import { LocalBackupPage } from './pages/LocalBackupPage'
import { AboutPage } from './pages/AboutPage'
import { MobileMoreMenuProvider } from './navigation/MobileMoreMenu'
import { isLibraryArea } from './navigation/mobileNavModel'
import { MobileNavigation } from './navigation/MobileNavigation'
import { NavigationGuardProvider } from './routing/NavigationGuard'
import { parseRoute, type Route } from './routing/routes'

export function LocalApp() {
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.hash))
  const applyRoute = useCallback((hash: string) => {
    setRoute(parseRoute(hash))
  }, [])

  const focused = route.name === 'cook'

  return (
    <NavigationGuardProvider applyRoute={applyRoute}>
      <MobileMoreMenuProvider>
        <div className={`app-shell${focused ? ' is-cook-mode' : ''}`}>
          {focused ? null : (
            <AppHeader subtitle="Rezepte · Wochenplan · Einkaufsliste">
              <nav className="main-nav" aria-label="Hauptnavigation">
                <a
                  className={isLibraryArea(route) ? 'active' : ''}
                  href="#/"
                  aria-current={isLibraryArea(route) ? 'page' : undefined}
                >
                  Bibliothek
                </a>
                <a
                  className={route.name === 'plan' ? 'active' : ''}
                  href="#/plan"
                  aria-current={route.name === 'plan' ? 'page' : undefined}
                >
                  Woche
                </a>
                <a
                  className={route.name === 'shopping' ? 'active' : ''}
                  href="#/shopping"
                  aria-current={route.name === 'shopping' ? 'page' : undefined}
                >
                  Einkaufsliste
                </a>
                <a
                  className={route.name === 'import' || route.name === 'import-url' ? 'active' : ''}
                  href="#/import"
                  aria-current={
                    route.name === 'import' || route.name === 'import-url' ? 'page' : undefined
                  }
                >
                  Import
                </a>
                <a
                  className={route.name === 'backup' ? 'active' : ''}
                  href="#/backup"
                  aria-current={route.name === 'backup' ? 'page' : undefined}
                >
                  Backup
                </a>
              </nav>
            </AppHeader>
          )}

          <main className="app-main">
            {route.name === 'library' ? <LibraryPage /> : null}
            {route.name === 'recipe' ? <RecipePage id={route.id} /> : null}
            {route.name === 'recipe-new' ? <RecipeEditorPage key="new" /> : null}
            {route.name === 'recipe-edit' ? <RecipeEditorPage key={route.id} id={route.id} /> : null}
            {route.name === 'cook' ? (
              <CookPage
                key={`${route.recipeId}:${route.cookSessionId ?? ''}`}
                recipeId={route.recipeId}
                cookSessionId={route.cookSessionId}
              />
            ) : null}
            {route.name === 'plan' ? <PlanPage /> : null}
            {route.name === 'shopping' ? <ShoppingPage /> : null}
            {route.name === 'import' ? <LocalImportPage /> : null}
            {route.name === 'import-url' ? <LocalUrlImportPage /> : null}
            {route.name === 'backup' ? <LocalBackupPage /> : null}
            {route.name === 'about' ? <AboutPage /> : null}
          </main>

          {route.name === 'cook' ? null : <MobileNavigation route={route} />}

          {focused ? null : (
            <footer className="app-footer">
              <span>Lokal im Browser gespeichert · keine Cloud, keine Konten</span>
              <span>
                <a href="#/about">Über Küchenrunde</a> · GPL-3.0-or-later · basiert auf{' '}
                <a
                  href="https://github.com/oliexdev/openCook"
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  openCook
                </a>
              </span>
            </footer>
          )}
        </div>
      </MobileMoreMenuProvider>
    </NavigationGuardProvider>
  )
}
