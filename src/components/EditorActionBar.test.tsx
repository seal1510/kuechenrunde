import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { EditorActionBar } from './EditorActionBar'

describe('editor action bar', () => {
  it('keeps save and cancel reachable and reports unsaved changes', () => {
    const html = renderToStaticMarkup(
      <EditorActionBar
        formId="recipe-editor"
        saving={false}
        dirty
        isNew={false}
        onCancel={() => undefined}
      />,
    )

    expect(html).toContain('role="group"')
    expect(html).toContain('Ungespeicherte Änderungen')
    expect(html).toContain('Abbrechen')
    expect(html).toContain('form="recipe-editor"')
    expect(html).toContain('Speichern')
  })

  it('shows the saving state and disables both actions', () => {
    const html = renderToStaticMarkup(
      <EditorActionBar
        formId="url-import-form"
        saving
        dirty
        isNew
        onCancel={() => undefined}
      />,
    )

    expect(html).toContain('Speichere …')
    expect(html.match(/disabled=""/g)).toHaveLength(2)
    expect(html).toContain('aria-busy="true"')
    expect(html).toContain('form="url-import-form"')
  })
})
