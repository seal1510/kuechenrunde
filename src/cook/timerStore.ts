/*
 * openCook Web
 * Copyright (C) 2026 openCook Web contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Small timer store with explicit, testable clock and storage seams. The
 * store never touches recipes or cook progress and keeps no resources of its
 * own; the React hook owns the display interval and sound context.
 */

import { randomId } from '../lib/id'
import {
  MAX_COOK_TIMERS,
  MAX_TIMER_DURATION_MS,
  TIMER_LIMIT_ERROR,
  TIMER_STORAGE_KEY,
  TIMER_STORAGE_READ_ERROR,
  TIMER_STORAGE_UNAVAILABLE,
  normalizeTimerName,
  parseTimerState,
  serializeTimerState,
  type CookTimer,
} from './timer'

export interface TimerStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export interface TimerStoreSnapshot {
  timers: readonly CookTimer[]
  soundEnabled: boolean
  storageError: string | null
}

export interface TimerStoreOptions {
  storage: TimerStorage | null
  now?: () => number
  createId?: () => string
  onExpired?: (timers: readonly CookTimer[]) => void
  initialStorageError?: string | null
}

export interface AddTimerResult {
  ok: boolean
  timer?: CookTimer
  error?: string
}

/**
 * Resolve localStorage without reading recipe or shopping data. The probe key
 * belongs to this module, so a blocked or quota-limited store is detected
 * before the first real write.
 */
export function resolveTimerStorage(): TimerStorage | null {
  try {
    if (typeof window === 'undefined') return null
    const storage = window.localStorage
    if (!storage) return null
    const probeKey = `${TIMER_STORAGE_KEY}.probe`
    storage.setItem(probeKey, '1')
    storage.removeItem(probeKey)
    return storage
  } catch {
    return null
  }
}

export class TimerStore {
  private readonly storage: TimerStorage | null
  private readonly clock: () => number
  private readonly createId: () => string
  private readonly onExpired: ((timers: readonly CookTimer[]) => void) | undefined
  private timers: CookTimer[] = []
  private soundEnabled = true
  private storageError: string | null = null
  private listeners = new Set<(snapshot: TimerStoreSnapshot) => void>()
  private snapshot: TimerStoreSnapshot

  constructor(options: TimerStoreOptions) {
    this.storage = options.storage
    this.clock = options.now ?? (() => Date.now())
    this.createId = options.createId ?? randomId
    this.onExpired = options.onExpired
    this.storageError = options.initialStorageError ?? null

    if (!this.storage) {
      this.storageError = this.storageError ?? TIMER_STORAGE_UNAVAILABLE
    } else {
      try {
        const raw = this.storage.getItem(TIMER_STORAGE_KEY)
        const parsed = parseTimerState(raw, this.clock())
        this.timers = parsed.state.timers
        this.soundEnabled = parsed.state.soundEnabled
        if (parsed.error) this.storageError = parsed.error
      } catch {
        this.storageError = TIMER_STORAGE_READ_ERROR
      }
    }

    this.snapshot = this.makeSnapshot()
  }

  getSnapshot(): TimerStoreSnapshot {
    return this.snapshot
  }

  subscribe(listener: (snapshot: TimerStoreSnapshot) => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  add(input: { durationMs: number; name: string }): AddTimerResult {
    if (this.timers.length >= MAX_COOK_TIMERS) {
      return { ok: false, error: TIMER_LIMIT_ERROR }
    }
    const durationMs = Math.round(input.durationMs)
    if (
      !Number.isFinite(durationMs) ||
      durationMs < 1000 ||
      durationMs > MAX_TIMER_DURATION_MS
    ) {
      return { ok: false, error: 'Die gewählte Dauer ist ungültig.' }
    }

    const now = this.clock()
    let id = this.createId()
    let attempt = 0
    while (this.timers.some((timer) => timer.id === id) && attempt < 5) {
      id = this.createId()
      attempt += 1
    }
    if (this.timers.some((timer) => timer.id === id)) {
      id = `${id}-${this.timers.length + 1}`
    }

    const timer: CookTimer = {
      id,
      name: normalizeTimerName(input.name),
      durationMs,
      remainingMs: durationMs,
      endsAt: now + durationMs,
      status: 'running',
    }
    this.timers = [...this.timers, timer]
    this.persist()
    this.emit()
    return { ok: true, timer }
  }

  start(id: string): void {
    const timer = this.find(id)
    if (!timer || timer.status === 'running') return
    const now = this.clock()
    const remainingMs =
      timer.status === 'expired' || timer.remainingMs <= 0
        ? timer.durationMs
        : Math.min(timer.remainingMs, timer.durationMs)
    this.replace({
      ...timer,
      status: 'running',
      remainingMs,
      endsAt: now + remainingMs,
    })
  }

  pause(id: string): void {
    const timer = this.find(id)
    if (!timer || timer.status !== 'running') return
    const now = this.clock()
    const remainingMs =
      timer.endsAt === null ? 0 : Math.max(0, Math.min(timer.durationMs, timer.endsAt - now))
    if (remainingMs <= 0) {
      this.expireByIds(new Set([timer.id]))
      return
    }
    this.replace({ ...timer, status: 'paused', remainingMs, endsAt: null })
  }

  reset(id: string): void {
    const timer = this.find(id)
    if (!timer) return
    this.replace({
      ...timer,
      status: 'paused',
      remainingMs: timer.durationMs,
      endsAt: null,
    })
  }

  remove(id: string): void {
    if (!this.timers.some((timer) => timer.id === id)) return
    this.timers = this.timers.filter((timer) => timer.id !== id)
    this.persist()
    this.emit()
  }

  setSoundEnabled(enabled: boolean): void {
    if (this.soundEnabled === enabled) return
    this.soundEnabled = enabled
    this.persist()
    this.emit()
  }

  /**
   * Recompute running timers from their absolute end times. The display is
   * only updated when the whole-second value changes.
   */
  tick(now = this.clock()): void {
    if (!this.timers.some((timer) => timer.status === 'running')) return

    let changed = false
    const expired: CookTimer[] = []
    const next = this.timers.map((timer) => {
      if (timer.status !== 'running' || timer.endsAt === null) return timer
      const remainingMs = Math.max(
        0,
        Math.min(timer.durationMs, timer.endsAt - now),
      )
      if (remainingMs <= 0) {
        const expiredTimer: CookTimer = {
          ...timer,
          status: 'expired',
          remainingMs: 0,
          endsAt: null,
        }
        expired.push(expiredTimer)
        changed = true
        return expiredTimer
      }
      if (Math.ceil(remainingMs / 1000) === Math.ceil(timer.remainingMs / 1000)) {
        return timer
      }
      changed = true
      return { ...timer, remainingMs }
    })

    if (!changed) return
    this.timers = next
    if (expired.length > 0) this.persist()
    this.emit()
    if (expired.length > 0) this.onExpired?.(expired)
  }

  dispose(): void {
    this.listeners.clear()
  }

  private find(id: string): CookTimer | undefined {
    return this.timers.find((timer) => timer.id === id)
  }

  private replace(timer: CookTimer): void {
    this.timers = this.timers.map((entry) => (entry.id === timer.id ? timer : entry))
    this.persist()
    this.emit()
  }

  private expireByIds(ids: ReadonlySet<string>): void {
    const expired: CookTimer[] = []
    this.timers = this.timers.map((timer) => {
      if (timer.status !== 'running' || !ids.has(timer.id)) return timer
      const next: CookTimer = {
        ...timer,
        status: 'expired',
        remainingMs: 0,
        endsAt: null,
      }
      expired.push(next)
      return next
    })
    if (expired.length === 0) return
    this.persist()
    this.emit()
    this.onExpired?.(expired)
  }

  private persist(): void {
    if (!this.storage) {
      this.storageError = TIMER_STORAGE_UNAVAILABLE
      return
    }
    try {
      this.storage.setItem(
        TIMER_STORAGE_KEY,
        serializeTimerState({ timers: this.timers, soundEnabled: this.soundEnabled }),
      )
      this.storageError = null
    } catch {
      // A full or blocked storage must not stop timers in this tab.
      this.storageError = TIMER_STORAGE_UNAVAILABLE
    }
  }

  private makeSnapshot(): TimerStoreSnapshot {
    return {
      timers: [...this.timers],
      soundEnabled: this.soundEnabled,
      storageError: this.storageError,
    }
  }

  private emit(): void {
    this.snapshot = this.makeSnapshot()
    for (const listener of [...this.listeners]) listener(this.snapshot)
  }
}
