import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { mobileRouteKey, moreMenuLinks } from './mobileNavModel'
import { MobileNavigation } from './MobileNavigation'
import { MoreSheet } from './MoreSheet'

describe('MobileNavigation', () => {
  it('renders the four permanent destinations and marks the active area', () => {
    const html = renderToStaticMarkup(
      <MobileNavigation route={{ name: 'plan' }} />,
    )

    expect(html).toContain('aria-label="Mobile Hauptnavigation"')
    expect(html).toContain('Rezepte')
    expect(html).toContain('Wochenplan')
    expect(html).toContain('Einkauf')
    expect(html).toContain('Mehr')
    expect(html).toContain('href="#/"')
    expect(html).toContain('href="#/plan"')
    expect(html).toContain('href="#/shopping"')
    expect(html.match(/aria-current="page"/g)).toHaveLength(1)
    expect(html).toContain('aria-expanded="false"')
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
      expect(html).toContain('aria-current="page"')
    }
  })

  it('marks Mehr as the current area on secondary pages', () => {
    const html = renderToStaticMarkup(
      <MobileNavigation route={{ name: 'import-url' }} />,
    )
    expect(html.match(/aria-current="page"/g)).toHaveLength(1)
    expect(html).toContain('aria-expanded="false"')
  })

  it('does not render the sheet until the Mehr trigger is used', () => {
    const html = renderToStaticMarkup(
      <MobileNavigation route={{ name: 'library' }} />,
    )
    expect(html).not.toContain('role="dialog"')
    expect(html).not.toContain('URL-Rezeptimport')
  })
})

describe('MoreSheet', () => {
  const noop = () => {}

  it('lists the secondary actions, the account and logout', () => {
    const html = renderToStaticMarkup(
      <MoreSheet
        open
        includeFamily
        email="familie@example.org"
        onLogout={noop}
        onClose={noop}
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
    expect(html).toContain('href="#/backup"')
    expect(html).toContain('href="#/family"')
    expect(html).toContain('href="#/about"')
  })

  it('keeps local mode free of cloud account actions', () => {
    const html = renderToStaticMarkup(
      <MoreSheet open onClose={noop} />,
    )

    expect(html).not.toContain('Familie verwalten')
    expect(html).not.toContain('Angemeldetes Konto')
    expect(html).not.toContain('Abmelden')
    expect(html).toContain('URL-Rezeptimport')
    expect(html).toContain('Mela-Import')
  })

  it('renders nothing while closed', () => {
    const html = renderToStaticMarkup(
      <MoreSheet open={false} onClose={noop} />,
    )
    expect(html).toBe('')
  })
})

describe('mobile route key', () => {
  it('changes when navigating between secondary pages', () => {
    expect(mobileRouteKey({ name: 'import' })).not.toBe(
      mobileRouteKey({ name: 'backup' }),
    )
  })
})
