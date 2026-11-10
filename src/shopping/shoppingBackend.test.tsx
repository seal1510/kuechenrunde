/*
 * Küchenrunde – lokaler Einkaufsstandard bleibt unverändert
 * Copyright (C) 2026 openCook Web contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { localShoppingBackend, useShoppingBackend } from './shoppingBackend'

function Probe() {
  const backend = useShoppingBackend()
  return <span>{backend === localShoppingBackend ? 'lokal' : 'cloud'}</span>
}

describe('Einkaufs-Backend ohne Cloud-Provider', () => {
  it('bleibt vollständig lokal', () => {
    const html = renderToStaticMarkup(<Probe />)
    expect(html).toContain('lokal')
    expect(localShoppingBackend.useShoppingData).toBeTypeOf('function')
  })
})
