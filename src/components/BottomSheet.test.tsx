/*
 * Küchenrunde – bottom sheet tests
 * Copyright (C) 2026 openCook Web contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { BottomSheet } from './BottomSheet'

describe('BottomSheet', () => {
  it('renders a labelled modal dialog with a visible close action', () => {
    const html = renderToStaticMarkup(
      <BottomSheet
        open
        title="Filter"
        description="Mehrere Filter lassen sich kombinieren."
        closeLabel="Filter schließen"
        onClose={() => undefined}
      >
        <p>Inhalt</p>
      </BottomSheet>,
    )

    expect(html).toContain('role="dialog"')
    expect(html).toContain('aria-modal="true"')
    expect(html).toContain('aria-labelledby=')
    expect(html).toContain('Filter')
    expect(html).toContain('Mehrere Filter lassen sich kombinieren.')
    expect(html).toContain('aria-label="Filter schließen"')
    expect(html).toContain('Inhalt')
  })

  it('adds no hidden dialog or tab stops while closed', () => {
    const html = renderToStaticMarkup(
      <BottomSheet open={false} title="Filter" onClose={() => undefined}>
        <p>Inhalt</p>
      </BottomSheet>,
    )

    expect(html).toBe('')
  })
})
