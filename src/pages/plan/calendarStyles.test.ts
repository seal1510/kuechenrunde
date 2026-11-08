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

  it('switches to the date strip and one selected day on smartphones', () => {
    expect(css).toContain('@media (max-width: 720px)')
    expect(css).toContain('.calendar-day-strip')
    expect(css).toContain('.calendar-week .calendar-day.is-selected')
  })
})
