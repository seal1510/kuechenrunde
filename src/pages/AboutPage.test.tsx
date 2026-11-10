import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { AboutPage } from './AboutPage'

describe('About page', () => {
  it('describes both local and cloud operation', () => {
    const html = renderToStaticMarkup(<AboutPage sourceCodeUrl={null} />)
    expect(html).toContain('standardmäßig lokal im Browser')
    expect(html).toContain('VITE_DATA_MODE=cloud')
    expect(html).not.toContain('geplant, aber noch nicht implementiert')
    expect(html).not.toContain('keine Konten, keine Cloud')
  })

  it('renders a configured source-code link and no invented fallback URL', () => {
    const html = renderToStaticMarkup(
      <AboutPage sourceCodeUrl="https://github.com/example/kuechenrunde" />,
    )
    expect(html).toContain('href="https://github.com/example/kuechenrunde"')
    expect(html).toContain('öffentlichen Repository')
    expect(html).not.toContain('beim Betreiber erhältlich')
  })

  it('links the ODbL ingredient catalogue, its sources and its download', () => {
    const html = renderToStaticMarkup(<AboutPage sourceCodeUrl={null} />)
    expect(html).toContain('ODbL 1.0')
    expect(html).toContain('Open Food Facts contributors')
    expect(html).toContain('/legal/ingredient-catalog.json')
    expect(html).toContain('ingredients.txt')
    expect(html).toContain('ingredients_processing.txt')
    expect(html).toContain('GPL-3.0-or-later')
    expect(html).not.toContain('reuse@openfoodfacts.org')
    expect(html).not.toContain('schriftlich')
  })

  it('shows the on-request fallback when no source URL is configured', () => {
    const html = renderToStaticMarkup(<AboutPage sourceCodeUrl={null} />)
    expect(html).toContain('beim Betreiber erhältlich')
    expect(html).not.toContain('github.com/example/kuechenrunde')
    expect(html).not.toContain('öffentlichen Repository')
  })
})
