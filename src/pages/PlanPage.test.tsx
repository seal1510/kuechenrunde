import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as service from '../mealplan/service'
import { PlanPage } from './PlanPage'

vi.mock('dexie-react-hooks', () => ({
  // A recipe keeps the calendar surface rendered; the other queries only need
  // to resolve so the page leaves its loading state.
  useLiveQuery: () => [{ id: 'r1', title: 'Testgericht' }],
}))

describe('plan page base version', () => {
  it('opens without an automatic planner entry point or automatic planning', () => {
    const generatePlan = vi.spyOn(service, 'generatePlan')
    const html = renderToStaticMarkup(<PlanPage />)

    expect(html).toContain('Essensplan')
    expect(html).not.toMatch(/automatisch/i)
    expect(html).not.toContain('⋯')
    expect(generatePlan).not.toHaveBeenCalled()
    expect(html).toContain('Wochenbeginn')
    expect(html).toContain('Tage davor')
    expect(html).toContain('Tage danach')
  })

  describe('fixed mobile week header', () => {
    beforeEach(() => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date(2026, 10, 11, 12, 0, 0))
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('renders the relative week label, reference range and labeled navigation', () => {
      const html = renderToStaticMarkup(<PlanPage />)

      expect(html).toContain('class="plan-week-relation"')
      expect(html).toContain('Diese Woche')
      expect(html).toContain('class="plan-range plan-range--mobile"')
      expect(html).toContain('class="plan-range plan-range--desktop"')
      expect(html).toContain('05.11. – 11.11.2026')
      expect(html).toContain('← Vorige Woche')
      expect(html).toContain('Nächste Woche →')
      expect(html).toContain('Heute')
      expect(html).toContain('Wochen beginnen donnerstags und enden mittwochs.')
    })
  })
})
