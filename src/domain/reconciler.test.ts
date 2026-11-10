/*
 * Küchenrunde (vormals openCook Web)
 * Copyright (C) 2026 openCook Web contributors
 * Copyright (C) 2026 olie.xdev <olie.xdeveloper@googlemail.com>
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Portierte Tests zum MealPlanReconciler; Original: openCook v0.4, commit 6e0c234.
 * Für Küchenrunde am 2026-11-10 angepasst.
 */

import { describe, expect, it } from 'vitest'
import { addDays } from './dates'
import { reconcile } from './reconciler'

const TODAY = '2026-05-25'

describe('MealPlanReconciler port', () => {
  it('rolls a procured past dish onto the next free day', () => {
    const moves = reconcile(
      [{ entryId: 'e1', date: addDays(TODAY, -1), procured: true }],
      new Set(),
      new Set(),
      TODAY,
    )
    expect(moves).toEqual([{ entryId: 'e1', toDate: TODAY }])
  })

  it('does not move when no day in the window is free', () => {
    const moves = reconcile(
      [{ entryId: 'e1', date: addDays(TODAY, -1), procured: true }],
      new Set([TODAY, addDays(TODAY, 1), addDays(TODAY, 2)]),
      new Set(),
      TODAY,
    )
    expect(moves).toEqual([])
  })

  it('never moves an unprocured dish', () => {
    const moves = reconcile(
      [{ entryId: 'e1', date: addDays(TODAY, -1), procured: false }],
      new Set(),
      new Set(),
      TODAY,
    )
    expect(moves).toEqual([])
  })

  it('lets two procured dishes claim slots oldest-first', () => {
    const moves = reconcile(
      [
        { entryId: 'newer', date: addDays(TODAY, -1), procured: true },
        { entryId: 'older', date: addDays(TODAY, -3), procured: true },
      ],
      new Set(),
      new Set(),
      TODAY,
    )
    expect(moves).toEqual([
      { entryId: 'older', toDate: TODAY },
      { entryId: 'newer', toDate: addDays(TODAY, 1) },
    ])
  })

  it('ignores skipped days', () => {
    const moves = reconcile(
      [{ entryId: 'e1', date: addDays(TODAY, -1), procured: true }],
      new Set(),
      new Set([TODAY]),
      TODAY,
    )
    expect(moves).toEqual([{ entryId: 'e1', toDate: addDays(TODAY, 1) }])
  })
})
