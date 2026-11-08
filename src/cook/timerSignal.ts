/*
 * openCook Web
 * Copyright (C) 2026 openCook Web contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Optional, tiny expiry signal. Browsers only allow audible output after a
 * user gesture, so the context is primed from start/toggle clicks and all
 * failures are intentionally silent.
 */

export interface TimerSignal {
  prime(): void
  play(): void
  dispose(): void
}

type AudioContextConstructor = new () => AudioContext

interface WebkitAudioWindow extends Window {
  webkitAudioContext?: AudioContextConstructor
}

function audioContextConstructor(): AudioContextConstructor | null {
  if (typeof window === 'undefined') return null
  const webkit = (window as WebkitAudioWindow).webkitAudioContext
  if (typeof webkit === 'function') return webkit
  if (typeof AudioContext !== 'undefined') return AudioContext
  return null
}

export function createTimerSignal(): TimerSignal {
  let context: AudioContext | null = null
  // Never create/resume audio from a restored timer alone: only a real user
  // gesture (start or sound toggle) may arm the optional signal.
  let primed = false

  function ensureContext(): AudioContext | null {
    if (context) return context
    const Constructor = audioContextConstructor()
    if (!Constructor) return null
    try {
      context = new Constructor()
    } catch {
      context = null
    }
    return context
  }

  function emitBeep(activeContext: AudioContext): void {
    try {
      const start = activeContext.currentTime
      for (const offset of [0, 0.24]) {
        const oscillator = activeContext.createOscillator()
        const gain = activeContext.createGain()
        const beepStart = start + offset
        const beepEnd = beepStart + 0.16
        oscillator.type = 'sine'
        oscillator.frequency.setValueAtTime(880, beepStart)
        gain.gain.setValueAtTime(0.0001, beepStart)
        gain.gain.exponentialRampToValueAtTime(0.08, beepStart + 0.015)
        gain.gain.exponentialRampToValueAtTime(0.0001, beepEnd)
        oscillator.connect(gain)
        gain.connect(activeContext.destination)
        oscillator.start(beepStart)
        oscillator.stop(beepEnd + 0.01)
        oscillator.onended = () => {
          oscillator.disconnect()
          gain.disconnect()
        }
      }
    } catch {
      // Audio is an optional nicety; never let it break a timer.
    }
  }

  return {
    prime() {
      primed = true
      const activeContext = ensureContext()
      if (!activeContext) return
      if (activeContext.state === 'suspended') {
        void activeContext.resume().catch(() => undefined)
      }
    },
    play() {
      if (!primed) return
      const activeContext = ensureContext()
      if (!activeContext) return
      if (activeContext.state === 'running') {
        emitBeep(activeContext)
        return
      }
      // Some browsers suspend a previously allowed context. A successful
      // resume still plays the short signal; a blocked one stays silent.
      void activeContext
        .resume()
        .then(() => {
          if (context?.state === 'running') emitBeep(context)
        })
        .catch(() => undefined)
    },
    dispose() {
      primed = false
      const activeContext = context
      context = null
      if (!activeContext) return
      void activeContext.close().catch(() => undefined)
    },
  }
}
