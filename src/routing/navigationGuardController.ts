/*
 * openCook Web
 * Copyright (C) 2026 openCook Web contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Central hash-navigation guard. The controller tracks a small numeric index
 * in each history entry so it can undo a blocked Back/Forward traversal with
 * history.go() instead of adding replacement entries. It never edits recipe
 * data and never changes the target itself.
 */

import { normalizeHash } from './routes'

export const HISTORY_INDEX_KEY = '__openCookHistoryIndex'
export const UNSAVED_CHANGES_QUESTION = 'Ungespeicherte Änderungen verwerfen?'

export interface NavigationHistoryLike {
  state: unknown
  replaceState(data: unknown, title: string, url?: string | null): void
  go(delta?: number): void
}

export interface NavigationLocationLike {
  hash: string
}

export interface NavigationPrompt {
  question: string
  hash: string
}

export interface NavigationGuardOptions {
  history: NavigationHistoryLike
  location: NavigationLocationLike
  applyRoute: (hash: string) => void
  onPromptChange: (prompt: NavigationPrompt | null) => void
}

type PendingAction = {
  kind: 'action'
  hash: string
  action: () => void
}

type PendingRoute = {
  kind: 'route'
  hash: string
  targetIndex: number | null
}

type PendingNavigation = PendingAction | PendingRoute
type RequestResult = 'applied' | 'prompted'

function sameHash(a: string, b: string): boolean {
  return normalizeHash(a) === normalizeHash(b)
}

export function readHistoryIndex(state: unknown): number | null {
  if (!state || typeof state !== 'object' || Array.isArray(state)) return null
  const value = (state as Record<string, unknown>)[HISTORY_INDEX_KEY]
  return typeof value === 'number' && Number.isInteger(value) ? value : null
}

export class NavigationGuardController {
  private readonly history: NavigationHistoryLike
  private readonly location: NavigationLocationLike
  private readonly applyRoute: (hash: string) => void
  private readonly onPromptChange: (prompt: NavigationPrompt | null) => void
  private readonly guards = new Set<() => boolean>()
  private committedHash: string
  private currentIndex: number
  private bypassNext = false
  private bypassHash: string | null = null
  private pending: PendingNavigation | null = null
  private promptVisible = false

  constructor(options: NavigationGuardOptions) {
    this.history = options.history
    this.location = options.location
    this.applyRoute = options.applyRoute
    this.onPromptChange = options.onPromptChange
    this.committedHash = this.location.hash
    const initialIndex = readHistoryIndex(this.history.state)
    this.currentIndex = initialIndex ?? 0
    if (initialIndex === null) this.writeIndex(this.currentIndex)
  }

  register(guard: () => boolean): () => void {
    this.guards.add(guard)
    return () => {
      this.guards.delete(guard)
    }
  }

  isDirty(): boolean {
    for (const guard of this.guards) {
      if (guard()) return true
    }
    return false
  }

  /** A click/cancel action can still be intercepted before the URL changes. */
  shouldPromptFor(hash: string): boolean {
    return (
      !this.isBypassed(hash) &&
      this.isDirty() &&
      !sameHash(hash, this.committedHash)
    )
  }

  /** Link clicks and the editor's own Cancel action use this path. */
  requestAction(action: () => void, hash: string): RequestResult {
    if (!this.shouldPromptFor(hash)) {
      action()
      return 'applied'
    }
    if (this.pending) return 'prompted'
    this.clearBypass()
    this.pending = { kind: 'action', hash, action }
    this.showPrompt(hash)
    return 'prompted'
  }

  /** Mark the next location change as intentional, e.g. after a successful save. */
  allowNextNavigation(hash?: string): void {
    this.bypassNext = true
    this.bypassHash = hash ?? null
  }

  /**
   * Called for every hashchange. For a blocked Back/Forward traversal the URL
   * has already changed; the route is only applied after the user confirms.
   */
  handleLocationChange(): RequestResult {
    const hash = this.location.hash
    if (this.isBypassed(hash)) {
      this.clearBypass()
      this.commitAndApply(hash)
      return 'applied'
    }
    this.clearBypass()
    if (!this.isDirty()) {
      this.commitAndApply(hash)
      return 'applied'
    }
    if (sameHash(hash, this.committedHash)) {
      // Usually the return leg of a cancelled history traversal.
      this.clearPrompt()
      const index = readHistoryIndex(this.history.state)
      if (index !== null) this.currentIndex = index
      this.applyRoute(this.committedHash)
      return 'applied'
    }

    const targetIndex = this.ensureTargetIndex()
    this.pending = { kind: 'route', hash, targetIndex }
    this.showPrompt(hash)
    return 'prompted'
  }

  confirmPending(): void {
    const pending = this.pending
    if (!pending) return
    this.clearPrompt()
    if (pending.kind === 'route') {
      this.commitAndApply(pending.hash)
      return
    }
    this.bypassNext = true
    this.bypassHash = pending.hash
    pending.action()
  }

  cancelPending(): void {
    const pending = this.pending
    if (!pending) return
    this.clearPrompt()
    if (pending.kind === 'action') return

    const targetIndex = readHistoryIndex(this.history.state) ?? pending.targetIndex
    if (targetIndex !== null) {
      const delta = this.currentIndex - targetIndex
      if (delta !== 0) {
        this.history.go(delta)
        return
      }
    }

    // Defensive fallback for a legacy entry without an index. It restores the
    // visible URL without adding an entry, but can collapse the forward slot.
    this.history.replaceState(this.stateWithIndex(this.currentIndex), '', this.committedHash)
    this.applyRoute(this.committedHash)
  }

  private isBypassed(hash: string): boolean {
    return (
      this.bypassNext &&
      (this.bypassHash === null || sameHash(hash, this.bypassHash))
    )
  }

  private clearBypass(): void {
    this.bypassNext = false
    this.bypassHash = null
  }

  private ensureTargetIndex(): number {
    const existing = readHistoryIndex(this.history.state)
    if (existing !== null) return existing
    const pendingTarget = this.pending?.kind === 'route' ? this.pending.targetIndex : null
    const base = pendingTarget ?? this.currentIndex
    const next = base + 1
    this.writeIndex(next)
    return next
  }

  private commitAndApply(hash: string): void {
    const index = readHistoryIndex(this.history.state)
    if (index === null) {
      this.currentIndex += 1
      this.writeIndex(this.currentIndex)
    } else {
      this.currentIndex = index
    }
    this.committedHash = hash
    this.clearPrompt()
    this.applyRoute(hash)
  }

  private stateWithIndex(index: number): Record<string, unknown> {
    const current = this.history.state
    const base =
      current && typeof current === 'object' && !Array.isArray(current)
        ? (current as Record<string, unknown>)
        : {}
    return { ...base, [HISTORY_INDEX_KEY]: index }
  }

  private writeIndex(index: number): void {
    this.history.replaceState(this.stateWithIndex(index), '')
  }

  private showPrompt(hash: string): void {
    if (this.promptVisible) return
    this.promptVisible = true
    this.onPromptChange({ question: UNSAVED_CHANGES_QUESTION, hash })
  }

  private clearPrompt(): void {
    this.pending = null
    if (!this.promptVisible) return
    this.promptVisible = false
    this.onPromptChange(null)
  }
}
