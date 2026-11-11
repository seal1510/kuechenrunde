import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/*
 * The supplier artwork is the only logo source. These checks keep the header,
 * the iOS touch icon, the manifest icons and the favicon wired to files that
 * were generated from it.
 */

const root = new URL('../', import.meta.url)
const html = readFileSync(new URL('index.html', root), 'utf8')
const viteConfig = readFileSync(new URL('vite.config.ts', root), 'utf8')
const header = readFileSync(new URL('src/components/AppHeader.tsx', root), 'utf8')
const css = readFileSync(new URL('src/styles.css', root), 'utf8')

interface PngInfo {
  width: number
  height: number
  colorType: number
}

function pngInfo(path: string): PngInfo {
  const bytes = readFileSync(new URL(path, root))
  expect(bytes.subarray(0, 8)).toEqual(
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  )
  return {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
    colorType: bytes[25],
  }
}

describe('Küchenrunde logo and PWA icon references', () => {
  it('keeps the supplied high-resolution source artwork', () => {
    expect(pngInfo('public/icons/icon-kuechenrunde.png')).toMatchObject({
      width: 1254,
      height: 1254,
    })
  })

  it('uses the new logo in the shared application header', () => {
    expect(header).toContain('src="/icons/icon-192.png"')
    expect(header).toContain('width={34}')
    expect(header).toContain('height={34}')
    expect(header).not.toMatch(/>\s*kr\s*</)
  })

  it('wires the Apple touch icon and browser favicon in the document head', () => {
    expect(html).toContain(
      'rel="apple-touch-icon" sizes="180x180" href="/icons/apple-touch-icon.png"',
    )
    expect(html).toContain(
      'rel="icon" type="image/png" href="/icons/favicon-32.png" sizes="32x32"',
    )
  })

  it('declares the regular and maskable manifest icons', () => {
    expect(viteConfig).toContain("src: '/icons/icon-192.png'")
    expect(viteConfig).toContain("src: '/icons/icon-512.png'")
    expect(viteConfig).toContain("src: '/icons/icon-maskable-512.png'")
    expect(viteConfig).toContain("sizes: '512x512'")
    expect(viteConfig).toContain("purpose: 'maskable'")
    expect(viteConfig).toContain("globIgnores: ['icons/icon-kuechenrunde.png']")
  })

  it('ships opaque, correctly sized PNG assets', () => {
    expect(pngInfo('public/icons/apple-touch-icon.png')).toMatchObject({
      width: 180,
      height: 180,
      colorType: 2,
    })
    expect(pngInfo('public/icons/icon-192.png')).toMatchObject({
      width: 192,
      height: 192,
      colorType: 2,
    })
    expect(pngInfo('public/icons/icon-512.png')).toMatchObject({
      width: 512,
      height: 512,
      colorType: 2,
    })
    expect(pngInfo('public/icons/icon-maskable-512.png')).toMatchObject({
      width: 512,
      height: 512,
      colorType: 2,
    })
    expect(pngInfo('public/icons/favicon-32.png')).toMatchObject({
      width: 32,
      height: 32,
      colorType: 2,
    })
  })
})

describe('phone shell styles', () => {
  it('keeps the three-item bottom bar evenly distributed', () => {
    expect(css).toMatch(
      /\.mobile-nav\s*\{[^}]*grid-template-columns: repeat\(3, minmax\(0, 1fr\)\);/,
    )
  })

  it('provides a touch-sized header menu button and hides it on desktop', () => {
    expect(css).toMatch(
      /\.mobile-menu-button,\s*\.library-import-menu\s*\{\s*display: none;/,
    )
    expect(css).toMatch(
      /\.mobile-menu-button\s*\{[^}]*width: 2\.75rem;[^}]*height: 2\.75rem;/,
    )
  })

  it('removes the composited backdrop layer from the phone header', () => {
    expect(css).toContain('backdrop-filter: none;')
    expect(css).toContain('-webkit-backdrop-filter: none;')
    expect(css).toMatch(
      /\.app-header\s*\{[^}]*background: var\(--bg\);[^}]*backdrop-filter: none;/,
    )
  })
})
