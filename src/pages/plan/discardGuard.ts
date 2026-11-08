/*
 * openCook Web
 * Copyright (C) 2026 openCook Web contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Small, dialog-local protection against losing unsaved eat days or portions.
 * The pure decision helpers are kept separate so the state machine can be
 * tested without a browser environment.
 */

import { useRef, useState } from 'react'

/** Stable string used to compare the initial draft with the current one. */
export function draftSignature(value: unknown): string {
  return JSON.stringify(value)
}

export function isDraftDirty(
  initialSignature: string,
  currentSignature: string,
): boolean {
  return initialSignature !== currentSignature
}

export interface DiscardRequest {
  /** Show the local confirmation instead of running the requested action. */
  prompt: boolean
  /** True when the requested action can run immediately. */
  proceed: boolean
}

export function requestDiscard(dirty: boolean): DiscardRequest {
  return dirty ? { prompt: true, proceed: false } : { prompt: false, proceed: true }
}

export function resolveDiscard(choice: 'discard' | 'keep'): {
  prompt: false
  proceed: boolean
} {
  return { prompt: false, proceed: choice === 'discard' }
}

export interface DiscardGuard {
  dirty: boolean
  prompted: boolean
  /** Run an action, or ask before doing so when there are unsaved changes. */
  request: (action: () => void) => void
  /** User chose "Verwerfen": run the remembered action. */
  confirm: () => void
  /** User chose "Weiter bearbeiten": keep the draft. */
  cancel: () => void
  /** Close the confirmation without running anything; returns true if shown. */
  cancelIfPrompted: () => boolean
}

export function useDiscardGuard(currentSignature: string): DiscardGuard {
  const initialSignature = useRef(currentSignature).current
  const [prompted, setPrompted] = useState(false)
  const pendingAction = useRef<null | (() => void)>(null)
  const dirty = isDraftDirty(initialSignature, currentSignature)

  function request(action: () => void) {
    const decision = requestDiscard(dirty)
    if (decision.proceed) {
      pendingAction.current = null
      action()
      return
    }
    pendingAction.current = action
    setPrompted(decision.prompt)
  }

  function confirm() {
    const action = pendingAction.current
    const decision = resolveDiscard('discard')
    pendingAction.current = null
    setPrompted(decision.prompt)
    if (decision.proceed) action?.()
  }

  function cancel() {
    const decision = resolveDiscard('keep')
    pendingAction.current = null
    setPrompted(decision.prompt)
  }

  function cancelIfPrompted(): boolean {
    if (!prompted) return false
    cancel()
    return true
  }

  return { dirty, prompted, request, confirm, cancel, cancelIfPrompted }
}
