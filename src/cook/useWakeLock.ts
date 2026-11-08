/*
 * openCook Web
 * Copyright (C) 2026 openCook Web contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Cook-mode binding for the Screen Wake Lock controller. The controller is
 * created after mount so React StrictMode's effect replay cannot leave the
 * component with a disposed controller.
 */

import { useEffect, useRef, useState } from 'react'
import {
  WakeLockController,
  WAKE_LOCK_UNAVAILABLE,
  type WakeLockLike,
  type WakeLockSnapshot,
} from './wakeLock'

export interface WakeLockControllerView {
  snapshot: WakeLockSnapshot
  toggle(): void
  enable(): void
  disable(): void
}

const INITIAL_SNAPSHOT: WakeLockSnapshot = {
  supported: false,
  wanted: false,
  held: false,
  status: 'unavailable',
  message: WAKE_LOCK_UNAVAILABLE,
}

export function useWakeLock(): WakeLockControllerView {
  const [snapshot, setSnapshot] = useState<WakeLockSnapshot>(INITIAL_SNAPSHOT)
  const controllerRef = useRef<WakeLockController | null>(null)

  useEffect(() => {
    if (typeof navigator === 'undefined' || typeof document === 'undefined') return

    const wakeLock =
      (navigator as Navigator & { wakeLock?: WakeLockLike }).wakeLock ?? null
    const controller = new WakeLockController({
      wakeLock,
      isVisible: () => document.visibilityState === 'visible',
    })
    controllerRef.current = controller
    setSnapshot(controller.getSnapshot())
    const unsubscribe = controller.subscribe(setSnapshot)

    const onVisibilityChange = () => {
      void controller.handleVisibilityChange()
    }
    const onPageHide = () => {
      void controller.suspend()
    }
    const onPageShow = () => {
      void controller.handleVisibilityChange()
    }

    document.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener('pagehide', onPageHide)
    window.addEventListener('pageshow', onPageShow)

    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('pagehide', onPageHide)
      window.removeEventListener('pageshow', onPageShow)
      unsubscribe()
      void controller.dispose()
      if (controllerRef.current === controller) controllerRef.current = null
    }
  }, [])

  return {
    snapshot,
    toggle: () => {
      void controllerRef.current?.toggle()
    },
    enable: () => {
      void controllerRef.current?.enable()
    },
    disable: () => {
      void controllerRef.current?.disable()
    },
  }
}
