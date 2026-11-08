/*
 * openCook Web
 * Copyright (C) 2026 openCook Web contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Screen Wake Lock controller for cook mode. The standardized API is optional;
 * unsupported browsers simply see a disabled control. The controller keeps the
 * user's wish across tab visibility changes but never holds a lock outside the
 * mounted cook mode.
 */

export interface WakeLockSentinelLike {
  readonly released: boolean
  release(): Promise<void>
  addEventListener(type: 'release', listener: () => void): void
  removeEventListener(type: 'release', listener: () => void): void
}

export interface WakeLockLike {
  request(type: 'screen'): Promise<WakeLockSentinelLike>
}

export type WakeLockStatus =
  | 'unavailable'
  | 'off'
  | 'requesting'
  | 'active'
  | 'released'
  | 'error'

export interface WakeLockSnapshot {
  supported: boolean
  wanted: boolean
  held: boolean
  status: WakeLockStatus
  message: string | null
}

export interface WakeLockControllerOptions {
  wakeLock: WakeLockLike | null
  isVisible: () => boolean
}

export const WAKE_LOCK_UNAVAILABLE = 'In diesem Browser nicht verfügbar.'
export const WAKE_LOCK_ERROR = 'Wachhalten konnte nicht aktiviert werden.'
export const WAKE_LOCK_RELEASED = 'Der Browser hat das Wachhalten beendet.'

const UNAVAILABLE_SNAPSHOT: WakeLockSnapshot = {
  supported: false,
  wanted: false,
  held: false,
  status: 'unavailable',
  message: WAKE_LOCK_UNAVAILABLE,
}

export class WakeLockController {
  private readonly wakeLock: WakeLockLike | null
  private readonly isVisible: () => boolean
  private readonly listeners = new Set<(snapshot: WakeLockSnapshot) => void>()
  private snapshot: WakeLockSnapshot
  private sentinel: WakeLockSentinelLike | null = null
  private wanted = false
  private requesting = false
  private releasing = false
  private suspended = false
  private disposed = false

  constructor(options: WakeLockControllerOptions) {
    this.wakeLock = options.wakeLock
    this.isVisible = options.isVisible
    this.snapshot = this.wakeLock
      ? { supported: true, wanted: false, held: false, status: 'off', message: null }
      : { ...UNAVAILABLE_SNAPSHOT }
  }

  getSnapshot(): WakeLockSnapshot {
    return this.snapshot
  }

  subscribe(listener: (snapshot: WakeLockSnapshot) => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  async enable(): Promise<void> {
    if (this.disposed) return
    if (!this.wakeLock) {
      this.wanted = false
      this.emit({ ...UNAVAILABLE_SNAPSHOT })
      return
    }
    this.suspended = false
    this.wanted = true
    if (this.sentinel) {
      this.emit({ wanted: true, held: true, status: 'active', message: null })
      return
    }
    await this.request()
  }

  async disable(): Promise<void> {
    if (this.disposed) return
    this.suspended = false
    this.wanted = false
    await this.releaseSentinel()
    if (this.disposed) return
    this.emit(
      this.wakeLock
        ? { wanted: false, held: false, status: 'off', message: null }
        : { ...UNAVAILABLE_SNAPSHOT },
    )
  }

  async toggle(): Promise<void> {
    if (this.wanted || this.sentinel) {
      await this.disable()
    } else {
      await this.enable()
    }
  }

  /** Release while keeping the user's wish for the next visibility change. */
  async suspend(): Promise<void> {
    if (this.disposed) return
    this.suspended = true
    await this.releaseSentinel()
    if (this.disposed) return
    this.emit({ held: false, status: 'off', message: null })
  }

  async handleVisibilityChange(): Promise<void> {
    if (this.disposed) return
    if (!this.isVisible()) {
      this.suspended = false
      await this.releaseSentinel()
      if (!this.disposed) {
        this.emit({ held: false, status: 'off', message: null })
      }
      return
    }
    if (!this.wanted) return
    this.suspended = false
    if (this.sentinel) {
      this.emit({ held: true, status: 'active', message: null })
      return
    }
    await this.request()
  }

  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    this.wanted = false
    await this.releaseSentinel()
    this.snapshot = {
      ...this.snapshot,
      wanted: false,
      held: false,
      status: this.wakeLock ? 'off' : 'unavailable',
      message: this.wakeLock ? null : WAKE_LOCK_UNAVAILABLE,
    }
    this.listeners.clear()
  }

  private async request(): Promise<void> {
    const wakeLock = this.wakeLock
    if (!wakeLock || this.disposed || !this.wanted || this.requesting || this.sentinel) {
      return
    }
    if (!this.isVisible()) {
      this.emit({ wanted: this.wanted, held: false, status: 'off', message: null })
      return
    }

    this.requesting = true
    this.emit({ wanted: this.wanted, status: 'requesting', message: null })
    try {
      const sentinel = await wakeLock.request('screen')
      if (this.disposed) {
        await sentinel.release().catch(() => undefined)
        return
      }
      if (!this.wanted) {
        await sentinel.release().catch(() => undefined)
        return
      }
      if (this.suspended) {
        await sentinel.release().catch(() => undefined)
        this.emit({ held: false, status: 'off', message: null })
        return
      }
      if (!this.isVisible()) {
        await sentinel.release().catch(() => undefined)
        this.emit({ held: false, status: 'off', message: null })
        return
      }
      this.sentinel = sentinel
      sentinel.addEventListener('release', this.handleRelease)
      this.emit({ wanted: true, held: true, status: 'active', message: null })
    } catch {
      if (!this.disposed && this.wanted && !this.suspended) {
        this.wanted = false
        this.emit({
          wanted: false,
          held: false,
          status: 'error',
          message: WAKE_LOCK_ERROR,
        })
      }
    } finally {
      this.requesting = false
    }
  }

  private async releaseSentinel(): Promise<void> {
    const sentinel = this.sentinel
    if (!sentinel) return
    this.sentinel = null
    sentinel.removeEventListener('release', this.handleRelease)
    this.releasing = true
    try {
      await sentinel.release()
    } catch {
      // A failed release still means we no longer hold this sentinel.
    } finally {
      this.releasing = false
    }
  }

  private handleRelease = (): void => {
    this.sentinel = null
    if (this.disposed || this.releasing) return
    if (this.isVisible()) {
      // Automatic releases (battery saver, tab switch, user agent policy)
      // must not trigger an endless re-request loop.
      this.wanted = false
      this.emit({
        wanted: false,
        held: false,
        status: 'released',
        message: WAKE_LOCK_RELEASED,
      })
      return
    }
    this.emit({ held: false, status: 'off', message: null })
  }

  private emit(patch: Partial<WakeLockSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch }
    for (const listener of [...this.listeners]) listener(this.snapshot)
  }
}
