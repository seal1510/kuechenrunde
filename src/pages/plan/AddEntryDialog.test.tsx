import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { AddEntryDialog } from './AddEntryDialog'

describe('shared add entry dialog', () => {
  it('offers recipe, free dish and comment in the shared add workflow', () => {
    const html = renderToStaticMarkup(
      <AddEntryDialog
        date="2026-05-29"
        onChooseRecipe={() => undefined}
        onChooseFreeDish={() => undefined}
        onChooseNote={() => undefined}
        onClose={() => undefined}
      />,
    )

    expect(html).toContain('Hinzufügen')
    expect(html).toContain('Fr, 29.05.')
    expect(html).toContain('Rezept')
    expect(html).toContain('Freies Gericht')
    expect(html).toContain('Kommentar')
    expect(html.match(/class="add-entry-option"/g)).toHaveLength(3)
  })
})
