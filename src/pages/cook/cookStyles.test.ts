import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const css = readFileSync(new URL('../../styles.css', import.meta.url), 'utf8')
const cookStart = css.indexOf('/* --- Focused cook mode')
const cookEnd = css.indexOf('/* --- Kitchen timers')
const cookCss = css.slice(cookStart, cookEnd)

describe('cook mode responsive stylesheet guards', () => {
  it('keeps the desktop row basis but resets it when the header becomes a column', () => {
    expect(cookCss).toMatch(/\.cook-heading\s*\{[^}]*flex: 1 1 20rem;/)
    expect(cookCss).toContain('@media (max-width: 720px)')
    const phoneStart = cookCss.indexOf('@media (max-width: 720px)')
    const phoneEnd = cookCss.indexOf('@media (max-width: 440px)')
    const phoneBlock = cookCss.slice(phoneStart, phoneEnd)
    expect(phoneBlock).toMatch(/\.cook-header\s*\{[^}]*flex-direction: column;/)
    expect(phoneBlock).toMatch(/\.cook-heading\s*\{[^}]*flex: 0 0 auto;/)
  })

  it('does not give the cook page or header a fixed viewport height', () => {
    expect(cookCss).not.toMatch(/\.cook-page\s*\{[^}]*min-height:/)
    expect(cookCss).not.toMatch(/\.cook-page\s*\{[^}]*height:\s*100dvh/)
    expect(cookCss).not.toMatch(/\.cook-header\s*\{[^}]*min-height:/)
    expect(cookCss).not.toMatch(/\.cook-header\s*\{[^}]*height:\s*100dvh/)
  })
})
