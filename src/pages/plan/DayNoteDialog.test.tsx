import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { DayNoteDialog } from './DayNoteDialog'

describe('comment dialog back navigation', () => {
  it('returns from a new comment to the shared chooser', () => {
    const html = renderToStaticMarkup(
      <DayNoteDialog
        date="2026-05-29"
        initialText=""
        onBackToChooser={() => undefined}
        onClose={() => undefined}
      />,
    )

    expect(html).toContain('Kommentar')
    expect(html).toContain('Fr, 29.05.')
    expect(html).toContain('aria-label="Zurück zu Hinzufügen"')
    expect(html).toContain('aria-label="Schließen"')
  })

  it('keeps existing comments as a direct calendar entry without a back step', () => {
    const html = renderToStaticMarkup(
      <DayNoteDialog
        date="2026-05-29"
        initialText="Essen gehen"
        onClose={() => undefined}
      />,
    )

    expect(html).toContain('Essen gehen')
    expect(html).not.toContain('aria-label="Zurück')
    expect(html).toContain('aria-label="Schließen"')
  })
})
