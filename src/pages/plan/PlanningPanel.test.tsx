import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { DiscardPrompt, PlanningPanel } from './PlanningPanel'

describe('responsive planning panel shell', () => {
  it('renders one labelled modal dialog with header, scroll body and footer', () => {
    const html = renderToStaticMarkup(
      <PlanningPanel
        title="Rezept auswählen"
        subtitle="Fr, 29.05."
        backLabel="Zurück zur Planung"
        onBack={() => undefined}
        onRequestClose={() => undefined}
        footer={<button type="button">Einplanen</button>}
      >
        <p>Inhalt</p>
      </PlanningPanel>,
    )

    expect(html).toContain('class="plan-panel')
    expect(html).toContain('role="dialog"')
    expect(html).toContain('aria-modal="true"')
    expect(html).toContain('plan-panel-body')
    expect(html).toContain('plan-panel-footer')
    expect(html).toContain('Rezept auswählen')
    expect(html).toContain('Fr, 29.05.')
    expect(html).toContain('aria-label="Zurück zur Planung"')
    expect(html).toContain('aria-label="Schließen"')
    expect(html).toContain('Einplanen')

    const labelId = /aria-labelledby="([^"]+)"/.exec(html)?.[1]
    expect(labelId).toBeTruthy()
    expect(html).toContain(`id="${labelId}"`)
  })

  it('renders the local discard confirmation without a second overlay', () => {
    const html = renderToStaticMarkup(
      <DiscardPrompt
        onKeepEditing={() => undefined}
        onDiscard={() => undefined}
      />,
    )

    expect(html).toContain('role="alertdialog"')
    expect(html).toContain('Änderungen verwerfen?')
    expect(html).toContain('Nicht gespeicherte Esstage und Portionen')
    expect(html).toContain('Weiter bearbeiten')
    expect(html).toContain('Verwerfen')
    expect(html).not.toContain('modal-backdrop')
  })
})
