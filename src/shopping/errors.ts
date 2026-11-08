/*
 * openCook Web
 * Copyright (C) 2026 openCook Web contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Typed domain errors shared by the shopping services. Keeping them in a
 * separate module avoids a circular import between the legacy shopping
 * service and the multi-list service.
 */

export type ShoppingListErrorCode =
  | 'invalid-period'
  | 'invalid-list-name'
  | 'list-not-found'
  | 'standard-list-protected'
  | 'invalid-target-list'
  | 'list-period-mismatch'
  | 'position-not-found'
  | 'invalid-quantity'
  | 'incompatible-unit'
  | 'ambiguous-quantity'
  | 'over-allocation'
  | 'allocation-not-found'
  | 'allocation-merge-conflict'
  | 'full-allocation-conflict'
  | 'confirmation-required'
  | 'purchase-conflict'
  | 'orphaned-allocation'

export class ShoppingListError extends Error {
  readonly code: ShoppingListErrorCode
  readonly details: Record<string, unknown>

  constructor(
    code: ShoppingListErrorCode,
    message: string,
    details: Record<string, unknown> = {},
  ) {
    super(message)
    this.name = 'ShoppingListError'
    this.code = code
    this.details = details
  }
}
