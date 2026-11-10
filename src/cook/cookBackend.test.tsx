/*
 * Küchenrunde – lokaler Kochmodus bleibt unverändert
 * Copyright (C) 2026 openCook Web contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { localCookBackend, useCookBackend } from './cookBackend'

function Probe() {
  const backend = useCookBackend()
  return <span>{backend === localCookBackend ? 'lokal' : 'cloud'}</span>
}

describe('Koch-Backend ohne Cloud-Provider', () => {
  it('bleibt vollständig lokal', () => {
    const html = renderToStaticMarkup(<Probe />)
    expect(html).toContain('lokal')
    expect(localCookBackend.useCookData).toBeTypeOf('function')
  })
})
