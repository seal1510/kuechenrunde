import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/*
 * Diese Prüfungen halten die iOS-Installationsfähigkeit fest. Sie lesen die
 * statische Konfiguration als Text, weil Manifest und Head-Tags erst beim
 * Build zusammengeführt werden (dist/ entsteht nicht in der Testumgebung).
 */

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8')
const viteConfig = readFileSync(new URL('../vite.config.ts', import.meta.url), 'utf8')
const css = readFileSync(new URL('./styles.css', import.meta.url), 'utf8')

describe('iOS-Web-App-Konfiguration', () => {
  it('liefert die Standalone-Metadaten und das Apple-Touch-Icon im Head', () => {
    expect(html).toContain('viewport-fit=cover')
    expect(html).toContain('name="apple-mobile-web-app-capable" content="yes"')
    expect(html).toContain('name="apple-mobile-web-app-title" content="Küchenrunde"')
    expect(html).toContain('name="apple-mobile-web-app-status-bar-style"')
    expect(html).toContain('rel="apple-touch-icon" href="/icons/apple-touch-icon.png"')
  })

  it('beschreibt ein installierbares Manifest mit eigenständigem Fenster', () => {
    expect(viteConfig).toContain("name: 'Küchenrunde'")
    expect(viteConfig).toContain("short_name: 'Küchenrunde'")
    expect(viteConfig).toContain("display: 'standalone'")
    expect(viteConfig).toContain("start_url: '/'")
    expect(viteConfig).toContain("scope: '/'")
    expect(viteConfig).toContain('192x192')
    expect(viteConfig).toContain('512x512')
  })

  it('lädt auch die Katalog-JSON in den Precache', () => {
    // Ohne diesen Eintrag beantwortet der Navigation-Fallback den direkten
    // Aufruf von /legal/ingredient-catalog.json mit index.html.
    expect(viteConfig).toMatch(/globPatterns:\s*\[[^\]]*\bjson\b/)
  })

  it('respektiert die sicheren Bereiche in allen vier Richtungen', () => {
    expect(css).toContain('env(safe-area-inset-top)')
    expect(css).toContain('env(safe-area-inset-right)')
    expect(css).toContain('env(safe-area-inset-bottom)')
    expect(css).toContain('env(safe-area-inset-left)')
  })
})
