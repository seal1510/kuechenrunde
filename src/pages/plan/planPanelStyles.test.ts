import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const css = readFileSync(new URL('../../styles.css', import.meta.url), 'utf8')

describe('planning panel responsive stylesheet guards', () => {
  it('turns the panel into a full-screen view on phones', () => {
    expect(css).toContain('.plan-panel-backdrop')
    expect(css).toMatch(/\.plan-panel\s*\{[^}]*height: 100dvh;/)
    expect(css).toMatch(
      /\.plan-panel-body\s*\{[^}]*overflow-y: auto;[^}]*overscroll-behavior: contain;/,
    )
    expect(css).toContain('env(safe-area-inset-top)')
    expect(css).toContain('env(safe-area-inset-bottom)')
    expect(css).toContain('body.plan-panel-open')
  })

  it('keeps a 420–520 px side panel on tablets and desktops', () => {
    expect(css).toContain('@media (min-width: 900px)')
    expect(css).toContain('width: min(520px, calc(100vw - 2rem));')
    expect(css).toContain('border-radius: var(--radius-xl);')
    expect(css).toContain('@media (max-width: 899px)')
  })

  it('keeps recipe cards compact and long titles wrapping', () => {
    expect(css).toContain('.plan-picker-card')
    expect(css).toContain('.plan-picker-cover')
    expect(css).toContain('.plan-picker-title')
    expect(css).toContain('overflow-wrap: anywhere;')
    expect(css).toContain('.plan-summary')
    expect(css).toContain('.dish-selected-remove')
  })
})
