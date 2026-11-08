import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
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
})
