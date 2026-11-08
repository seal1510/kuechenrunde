import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const css = readFileSync(new URL('../../styles.css', import.meta.url), 'utf8')

describe('calendar responsive stylesheet guards', () => {
  it('contains the shared calendar surface and both preview rows', () => {
    expect(css).toContain('.calendar-shell')
    expect(css).toContain('.calendar-preview-row--before')
    expect(css).toContain('.calendar-preview-row--after')
  })

  it('keeps the seven-column desktop grid and the tablet column fallbacks', () => {
    expect(css).toContain('grid-template-columns: repeat(7, minmax(0, 1fr));')
    expect(css).toContain('@media (min-width: 721px) and (max-width: 1180px)')
    expect(css).toContain('@media (min-width: 721px) and (max-width: 900px)')
  })

  it('keeps mobile-only helpers hidden on desktop and tablet', () => {
    expect(css).toMatch(
      /\.calendar-group-title,\s*\.calendar-empty-hint\s*\{\s*display:\s*none;/,
    )
    expect(css).toMatch(
      /\.calendar-entry\.is-preview-extra\s*\{\s*display:\s*none;/,
    )
  })

  it('uses one continuous eleven-day list on smartphones', () => {
    expect(css).toContain('@media (max-width: 720px)')
    expect(css).toContain('.calendar-group-title')
    expect(css).toContain('grid-template-columns: 58px minmax(0, 1fr) 44px;')
    expect(css).toContain('.calendar-entry--preview.is-preview-extra')
    expect(css).toMatch(/\.calendar-preview-more\s*\{\s*display:\s*none;/)
    expect(css).not.toContain('.calendar-day-strip')
    expect(css).not.toContain('.calendar-week .calendar-day.is-selected')
  })
})
