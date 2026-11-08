import { useCallback, useState } from 'react'
import { LibraryPage } from './pages/LibraryPage'
import { RecipePage } from './pages/RecipePage'
import { RecipeEditorPage } from './pages/RecipeEditorPage'
import { CookPage } from './pages/CookPage'
import { ImportPage } from './pages/ImportPage'
import { UrlImportPage } from './pages/UrlImportPage'
import { PlanPage } from './pages/PlanPage'
import { ShoppingPage } from './pages/ShoppingPage'
import { BackupPage } from './pages/BackupPage'
import { NavigationGuardProvider } from './routing/NavigationGuard'
import { parseRoute, type Route } from './routing/routes'

const isLibraryArea = (route: Route) =>
  route.name === 'library' ||
  route.name === 'recipe' ||
  route.name === 'recipe-new' ||
  route.name === 'recipe-edit' ||
  route.name === 'cook'

export default function App() {
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.hash))
  const applyRoute = useCallback((hash: string) => {
    setRoute(parseRoute(hash))
  }, [])

  const focused = route.name === 'cook'

  return (
    <NavigationGuardProvider applyRoute={applyRoute}>
      <div className={`app-shell${focused ? ' is-cook-mode' : ''}`}>
        {focused ? null : (
        <header className="app-header">
          <div className="app-header-inner">
            <a className="brand" href="#/">
              <span className="brand-mark" aria-hidden="true">
                oc
              </span>
              <span>
                <strong>openCook</strong>
                <small>Web</small>
              </span>
            </a>
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
                aria-current={route.name === 'import' || route.name === 'import-url' ? 'page' : undefined}
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
          </div>
        </header>
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
          {route.name === 'import' ? <ImportPage /> : null}
          {route.name === 'import-url' ? <UrlImportPage /> : null}
          {route.name === 'backup' ? <BackupPage /> : null}
        </main>

        {focused ? null : (
        <footer className="app-footer">
          <span>Lokal im Browser gespeichert · keine Cloud, keine Konten</span>
          <span>
            GPLv3 · basiert auf{' '}
            <a href="https://github.com/oliexdev/openCook" target="_blank" rel="noreferrer noopener">
              openCook
            </a>
          </span>
        </footer>
        )}
      </div>
    </NavigationGuardProvider>
  )
}
