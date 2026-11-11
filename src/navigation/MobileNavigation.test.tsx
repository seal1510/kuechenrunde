import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { AppHeader } from '../components/AppHeader'
import { mobileRouteKey, moreMenuLinks } from './mobileNavModel'
import { MobileMoreMenuProvider } from './MobileMoreMenu'
import { MobileNavigation } from './MobileNavigation'
import { MoreSheet } from './MoreSheet'

describe('MobileNavigation', () => {
  it('renders exactly the three permanent destinations', () => {
    const html = renderToStaticMarkup(
      <MobileNavigation route={{ name: 'plan' }} />,
    )

    expect(html).toContain('aria-label="Mobile Hauptnavigation"')
    expect(html).toContain('Rezepte')
    expect(html).toContain('Wochenplan')
    expect(html).toContain('Einkauf')
    expect(html).not.toContain('>Mehr<')
    expect(html).not.toContain('aria-expanded')
    expect(html).toContain('href="#/"')
    expect(html).toContain('href="#/plan"')
    expect(html).toContain('href="#/shopping"')
    expect(html.match(/class="mobile-nav-item/g)).toHaveLength(3)
    expect(html.match(/aria-current="page"/g)).toHaveLength(1)
  })

  it('highlights recipes for every recipe sub-page', () => {
    for (const route of [
      { name: 'library' as const },
      { name: 'recipe' as const, id: 'r1' },
      { name: 'recipe-new' as const },
      { name: 'recipe-edit' as const, id: 'r1' },
      { name: 'cook' as const, recipeId: 'r1', cookSessionId: null },
    ]) {
      const html = renderToStaticMarkup(<MobileNavigation route={route} />)
      expect(html.match(/aria-current="page"/g)).toHaveLength(1)
      expect(html).toMatch(/mobile-nav-item is-active[^>]*aria-current="page"/)
    }
  })

  it('keeps all three destinations visible but none active on secondary pages', () => {
    const html = renderToStaticMarkup(
      <MobileNavigation route={{ name: 'import-url' }} />,
    )
    expect(html.match(/class="mobile-nav-item/g)).toHaveLength(3)
    expect(html).not.toContain('aria-current="page"')
  })
})

describe('mobile header menu', () => {
  it('places a three-dot menu trigger in the app header', () => {
    const html = renderToStaticMarkup(
      <MobileMoreMenuProvider>
        <AppHeader subtitle="Familie">
          <nav className="main-nav">Desktop-Navigation</nav>
        </AppHeader>
      </MobileMoreMenuProvider>,
    )

    expect(html).toContain('class="app-header"')
    expect(html).toContain('src="/icons/icon-192.png"')
    expect(html).toContain('class="main-nav"')
    expect(html).toContain('brand-subtitle')
    expect(html).not.toContain('brand-subtitle--mobile')
    expect(html).toContain('class="mobile-menu-button"')
    expect(html).toContain('aria-label="Mehr-Menü öffnen"')
    expect(html).toContain('aria-haspopup="dialog"')
    expect(html).toContain('aria-expanded="false"')
    expect(html).toContain('aria-controls="mobile-more-sheet"')
    expect(html.match(/<circle/g)).toHaveLength(3)
    expect(html).not.toContain('role="dialog"')
    expect(html).not.toContain('URL-Rezeptimport')
  })

  it('keeps the short cloud subtitle explicitly visible on phones', () => {
    const html = renderToStaticMarkup(
      <MobileMoreMenuProvider>
        <AppHeader subtitle="Familien-Cloud" showMobileSubtitle />
      </MobileMoreMenuProvider>,
    )

    expect(html).toContain('brand-subtitle brand-subtitle--mobile')
    expect(html).toContain('Familien-Cloud')
  })

  it('hides the trigger while the cloud account is not ready', () => {
    const html = renderToStaticMarkup(
      <MobileMoreMenuProvider enabled={false}>
        <AppHeader subtitle="Familien-Cloud" />
      </MobileMoreMenuProvider>,
    )

    expect(html).toContain('class="app-header"')
    expect(html).not.toContain('class="mobile-menu-button"')
  })

  it('reuses the complete existing More sheet', () => {
    const html = renderToStaticMarkup(
      <MoreSheet
        open
        includeFamily
        email="familie@example.org"
        onLogout={() => undefined}
        onClose={() => undefined}
      />,
    )

    expect(html).toContain('role="dialog"')
    expect(html).toContain('aria-modal="true"')
    expect(html).toContain('Angemeldetes Konto')
    expect(html).toContain('familie@example.org')
    expect(html).toContain('Abmelden')

    for (const link of moreMenuLinks(true)) {
      expect(html).toContain(link.label)
      expect(html).toContain(`href="${link.href}"`)
    }
    expect(html).toContain('href="#/import/url"')
    expect(html).toContain('href="#/import"')
    expect(html).toContain('href="#/import/foto"')
    expect(html).toContain('Foto / Scan')
    expect(html).toContain('href="#/backup"')
    expect(html).toContain('href="#/family"')
    expect(html).toContain('href="#/about"')
  })

  it('keeps local mode free of cloud account actions', () => {
    const html = renderToStaticMarkup(
      <MoreSheet open onClose={() => undefined} />,
    )

    expect(html).not.toContain('Familie verwalten')
    expect(html).not.toContain('Angemeldetes Konto')
    expect(html).not.toContain('Abmelden')
    expect(html).toContain('URL-Rezeptimport')
    expect(html).toContain('Mela-Import')
    expect(html).not.toContain('Foto / Scan')
  })
})

describe('mobile route key', () => {
  it('changes when navigating between secondary pages', () => {
    expect(mobileRouteKey({ name: 'import' })).not.toBe(
      mobileRouteKey({ name: 'backup' }),
    )
  })
})
