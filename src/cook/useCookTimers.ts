/*
 * openCook Web
 * Copyright (C) 2026 openCook Web contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * React binding for the standalone timer store. Only the display interval and
 * the optional audio context are resources; both are released on unmount.
 */

import { useEffect, useRef, useState } from 'react'
import { MAX_COOK_TIMERS, type CookTimer } from './timer'
import {
  TimerStore,
  resolveTimerStorage,
  type AddTimerResult,
  type TimerStoreSnapshot,
} from './timerStore'
import { createTimerSignal, type TimerSignal } from './timerSignal'

export interface CookTimersController {
  timers: readonly CookTimer[]
  soundEnabled: boolean
  storageError: string | null
  expiredNotice: string | null
  atLimit: boolean
  addTimer(input: { durationMs: number; name: string }): AddTimerResult
  startTimer(id: string): void
  pauseTimer(id: string): void
  resetTimer(id: string): void
  removeTimer(id: string): void
  toggleSound(): void
}

function expiryMessage(timers: readonly CookTimer[]): string {
  if (timers.length === 1) {
    const name = timers[0]?.name.trim()
    return name ? `Timer „${name}“ ist abgelaufen.` : 'Ein Timer ist abgelaufen.'
  }
  const names = timers
    .map((timer) => timer.name.trim())
    .filter(Boolean)
    .map((name) => `„${name}“`)
  return names.length > 0
    ? `${timers.length} Timer sind abgelaufen: ${names.join(', ')}.`
    : `${timers.length} Timer sind abgelaufen.`
}

export function useCookTimers(): CookTimersController {
  const storeRef = useRef<TimerStore | null>(null)
  const signalRef = useRef<TimerSignal | null>(null)
  const onExpiredRef = useRef<(timers: readonly CookTimer[]) => void>(() => undefined)
  const noticeTimeoutRef = useRef<number | null>(null)

  if (!storeRef.current) {
    storeRef.current = new TimerStore({
      storage: resolveTimerStorage(),
      onExpired: (timers) => onExpiredRef.current(timers),
    })
  }
  if (!signalRef.current) {
    signalRef.current = createTimerSignal()
  }

  const store = storeRef.current
  const signal = signalRef.current
  const [snapshot, setSnapshot] = useState<TimerStoreSnapshot>(() => store.getSnapshot())
  const [expiredNotice, setExpiredNotice] = useState<string | null>(null)

  useEffect(() => {
    setSnapshot(store.getSnapshot())
    return store.subscribe(setSnapshot)
  }, [store])

  useEffect(() => {
    onExpiredRef.current = (timers) => {
      if (store.getSnapshot().soundEnabled) signal.play()
      setExpiredNotice(expiryMessage(timers))
      if (typeof window !== 'undefined') {
        if (noticeTimeoutRef.current !== null) {
          window.clearTimeout(noticeTimeoutRef.current)
        }
        noticeTimeoutRef.current = window.setTimeout(() => {
          noticeTimeoutRef.current = null
          setExpiredNotice(null)
        }, 10_000)
      }
    }

    return () => {
      onExpiredRef.current = () => undefined
      if (noticeTimeoutRef.current !== null && typeof window !== 'undefined') {
        window.clearTimeout(noticeTimeoutRef.current)
        noticeTimeoutRef.current = null
      }
      signal.dispose()
      store.dispose()
    }
  }, [signal, store])

  const hasRunningTimer = snapshot.timers.some((timer) => timer.status === 'running')

  useEffect(() => {
    if (!hasRunningTimer || typeof window === 'undefined') return
    const tick = () => store.tick()
    tick()
    const interval = window.setInterval(tick, 250)
    const onVisibilityChange = () => {
      // Background tabs throttle intervals; catch up immediately when the
      // user returns, still using absolute end times.
      store.tick()
    }
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', onVisibilityChange)
    }
    return () => {
      window.clearInterval(interval)
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onVisibilityChange)
      }
    }
  }, [store, hasRunningTimer])

  function addTimer(input: { durationMs: number; name: string }): AddTimerResult {
    const result = store.add(input)
    if (result.ok) signal.prime()
    return result
  }

  function startTimer(id: string): void {
    store.start(id)
    signal.prime()
  }

  function toggleSound(): void {
    const next = !store.getSnapshot().soundEnabled
    store.setSoundEnabled(next)
    if (next) signal.prime()
  }

  return {
    timers: snapshot.timers,
    soundEnabled: snapshot.soundEnabled,
    storageError: snapshot.storageError,
    expiredNotice,
    atLimit: snapshot.timers.length >= MAX_COOK_TIMERS,
    addTimer,
    startTimer,
    pauseTimer: (id) => store.pause(id),
    resetTimer: (id) => store.reset(id),
    removeTimer: (id) => store.remove(id),
    toggleSound,
  }
}
