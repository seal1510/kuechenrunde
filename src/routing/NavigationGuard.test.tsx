import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { UNSAVED_CHANGES_QUESTION } from './navigationGuardController'
import { UnsavedChangesDialog } from './NavigationGuard'

describe('unsaved changes dialog', () => {
  it('offers continuing and discarding with the shared question', () => {
    const html = renderToStaticMarkup(
      <UnsavedChangesDialog open onContinue={() => undefined} onDiscard={() => undefined} />,
    )

    expect(html).toContain('role="alertdialog"')
    expect(html).toContain('aria-modal="true"')
    expect(html).toContain(UNSAVED_CHANGES_QUESTION)
    expect(html).toContain('Weiter bearbeiten')
    expect(html).toContain('Verwerfen und verlassen')
  })

  it('renders nothing while no navigation is blocked', () => {
    const html = renderToStaticMarkup(
      <UnsavedChangesDialog
        open={false}
        onContinue={() => undefined}
        onDiscard={() => undefined}
      />,
    )
    expect(html).toBe('')
  })
})
