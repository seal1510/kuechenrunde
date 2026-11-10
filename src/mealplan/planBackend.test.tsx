/*
 * Küchenrunde – lokaler Planungsstandard bleibt unverändert
 * Copyright (C) 2026 openCook Web contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { localPlanBackend, usePlanBackend } from './planBackend'

function Probe() {
  const backend = usePlanBackend()
  return <span>{backend.cookModeEnabled ? 'lokal' : 'cloud'}</span>
}

describe('Planungs-Backend ohne Cloud-Provider', () => {
  it('bleibt vollständig lokal und bietet den vorhandenen Kochmodus', () => {
    const html = renderToStaticMarkup(<Probe />)
    expect(html).toContain('lokal')
    expect(localPlanBackend.cookModeEnabled).toBe(true)
    expect(localPlanBackend.renderRecipeCover).toBeUndefined()
  })
})
