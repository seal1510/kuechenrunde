/*
 * openCook Web
 * Copyright (C) 2026 openCook Web contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Standalone kitchen timers for cook mode. Timers are intentionally detached
 * from recipes, cook sessions and cook progress. They only use a small,
 * versioned localStorage record owned by this module.
 */

export type CookTimerStatus = 'running' | 'paused' | 'expired'

export interface CookTimer {
  id: string
  /** Optional user label. Empty strings are valid and shown as "Timer N". */
  name: string
  durationMs: number
  /** Remaining time at the last tick, or the frozen value while paused. */
  remainingMs: number
  /** Absolute wall-clock end for running timers; null while paused/expired. */
  endsAt: number | null
  status: CookTimerStatus
}

export interface TimerDraft {
  minutes: string
  seconds: string
  name: string
}

export type TimerDraftResult =
  | { ok: true; durationMs: number; name: string }
  | { ok: false; error: string }

export interface TimerState {
  timers: CookTimer[]
  soundEnabled: boolean
}

export interface ParsedTimerState {
  state: TimerState
  error: string | null
}

export const TIMER_STORAGE_KEY = 'opencook.cookTimers.v1'
export const TIMER_STORAGE_VERSION = 1
export const MAX_COOK_TIMERS = 12
export const MAX_TIMER_MINUTES = 1440
export const MAX_TIMER_DURATION_MS = MAX_TIMER_MINUTES * 60_000
export const MAX_TIMER_NAME_LENGTH = 40
/** Refuse unexpectedly large records before handing them to JSON.parse. */
export const MAX_TIMER_STORAGE_LENGTH = 20_000

export const TIMER_STORAGE_UNAVAILABLE =
  'Timer können in diesem Browser nicht dauerhaft gespeichert werden.'
export const TIMER_STORAGE_READ_ERROR = 'Gespeicherte Timer konnten nicht gelesen werden.'
export const TIMER_LIMIT_ERROR = `Es sind höchstens ${MAX_COOK_TIMERS} Timer gleichzeitig möglich.`

export function normalizeTimerName(value: unknown): string {
  if (typeof value !== 'string') return ''
  return value
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_TIMER_NAME_LENGTH)
    .trim()
}

/**
 * Reads the compact minute/second form. Empty fields count as zero, so a
 * 30-second timer only needs the seconds field.
 */
export function parseTimerDraft(draft: TimerDraft): TimerDraftResult {
  const minutesText = String(draft.minutes ?? '').trim()
  const secondsText = String(draft.seconds ?? '').trim()

  if (!/^\d*$/.test(minutesText) || !/^\d*$/.test(secondsText)) {
    return { ok: false, error: 'Bitte nur ganze Minuten und Sekunden eingeben.' }
  }

  const minutes = minutesText === '' ? 0 : Number(minutesText)
  const seconds = secondsText === '' ? 0 : Number(secondsText)

  if (!Number.isSafeInteger(minutes) || !Number.isSafeInteger(seconds)) {
    return { ok: false, error: 'Bitte nur ganze Minuten und Sekunden eingeben.' }
  }
  if (seconds > 59) {
    return { ok: false, error: 'Sekunden müssen zwischen 0 und 59 liegen.' }
  }

  const durationMs = (minutes * 60 + seconds) * 1000
  if (durationMs < 1000) {
    return { ok: false, error: 'Bitte eine Dauer von mindestens einer Sekunde eingeben.' }
  }
  if (durationMs > MAX_TIMER_DURATION_MS) {
    return { ok: false, error: 'Die Dauer ist zu lang (maximal 24 Stunden).' }
  }

  return { ok: true, durationMs, name: normalizeTimerName(draft.name) }
}

/** Display value in MM:SS, or H:MM:SS once the timer reaches an hour. */
export function formatTimerClock(remainingMs: number): string {
  const safeMs = Number.isFinite(remainingMs) ? Math.max(0, remainingMs) : 0
  const totalSeconds = Math.ceil(safeMs / 1000)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  const paddedMinutes = String(minutes).padStart(2, '0')
  const paddedSeconds = String(seconds).padStart(2, '0')
  return hours > 0
    ? `${hours}:${paddedMinutes}:${paddedSeconds}`
    : `${paddedMinutes}:${paddedSeconds}`
}

function spokenAmount(value: number, singular: string, plural: string): string {
  return `${value} ${value === 1 ? singular : plural}`
}

export function formatSpokenDuration(remainingMs: number): string {
  const safeMs = Number.isFinite(remainingMs) ? Math.max(0, remainingMs) : 0
  const totalSeconds = Math.ceil(safeMs / 1000)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  const parts: string[] = []
  if (hours > 0) parts.push(spokenAmount(hours, 'Stunde', 'Stunden'))
  if (minutes > 0) parts.push(spokenAmount(minutes, 'Minute', 'Minuten'))
  if (seconds > 0 || parts.length === 0) {
    parts.push(spokenAmount(seconds, 'Sekunde', 'Sekunden'))
  }
  return parts.join(' ')
}

export function accessibleTimerRemaining(timer: CookTimer): string {
  switch (timer.status) {
    case 'expired':
      return 'abgelaufen'
    case 'paused':
      return `pausiert bei ${formatSpokenDuration(timer.remainingMs)}`
    case 'running':
      return `noch ${formatSpokenDuration(timer.remainingMs)}`
  }
}

export function displayTimerName(name: string, index: number): string {
  return name.trim() || `Timer ${index + 1}`
}

function readFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/**
 * Validates one persisted timer and derives its status from the wall clock.
 * Malformed entries are dropped instead of breaking the whole cook mode.
 */
function sanitizeStoredTimer(value: unknown, now: number): CookTimer | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  const id = typeof record.id === 'string' ? record.id.trim() : ''
  if (!id || id.length > 120) return null

  const rawDuration = readFiniteNumber(record.durationMs)
  if (rawDuration === null) return null
  const durationMs = Math.round(rawDuration)
  if (durationMs < 1000 || durationMs > MAX_TIMER_DURATION_MS) return null

  const name = normalizeTimerName(record.name)
  const status = record.status
  if (status === 'expired') {
    return { id, name, durationMs, remainingMs: 0, endsAt: null, status: 'expired' }
  }

  if (status === 'paused') {
    const rawRemaining = readFiniteNumber(record.remainingMs)
    const remainingMs =
      rawRemaining === null
        ? durationMs
        : Math.max(0, Math.min(Math.round(rawRemaining), durationMs))
    return remainingMs <= 0
      ? { id, name, durationMs, remainingMs: 0, endsAt: null, status: 'expired' }
      : { id, name, durationMs, remainingMs, endsAt: null, status: 'paused' }
  }

  if (status !== 'running') return null
  const rawEndsAt = readFiniteNumber(record.endsAt)
  if (rawEndsAt === null) return null
  const remainingMs = Math.max(0, Math.min(durationMs, Math.round(rawEndsAt - now)))
  if (remainingMs <= 0) {
    return { id, name, durationMs, remainingMs: 0, endsAt: null, status: 'expired' }
  }
  return {
    id,
    name,
    durationMs,
    remainingMs,
    endsAt: now + remainingMs,
    status: 'running',
  }
}

export function parseTimerState(raw: string | null, now: number): ParsedTimerState {
  const empty: TimerState = { timers: [], soundEnabled: true }
  if (raw === null) return { state: empty, error: null }
  if (raw.length > MAX_TIMER_STORAGE_LENGTH) {
    return { state: empty, error: TIMER_STORAGE_READ_ERROR }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { state: empty, error: TIMER_STORAGE_READ_ERROR }
  }
  if (!parsed || typeof parsed !== 'object') {
    return { state: empty, error: TIMER_STORAGE_READ_ERROR }
  }

  const record = parsed as Record<string, unknown>
  if (record.version !== TIMER_STORAGE_VERSION) {
    return { state: empty, error: TIMER_STORAGE_READ_ERROR }
  }

  const rawTimers = Array.isArray(record.timers) ? record.timers : []
  const timers: CookTimer[] = []
  const seen = new Set<string>()
  for (const entry of rawTimers) {
    if (timers.length >= MAX_COOK_TIMERS) break
    const timer = sanitizeStoredTimer(entry, now)
    if (!timer || seen.has(timer.id)) continue
    timers.push(timer)
    seen.add(timer.id)
  }

  const droppedEntries = rawTimers.length > timers.length
  return {
    state: {
      timers,
      soundEnabled: record.soundEnabled !== false,
    },
    error: droppedEntries && rawTimers.length > 0 ? TIMER_STORAGE_READ_ERROR : null,
  }
}

export function serializeTimerState(state: TimerState): string {
  return JSON.stringify({
    version: TIMER_STORAGE_VERSION,
    soundEnabled: state.soundEnabled,
    timers: state.timers.map((timer) => ({
      id: timer.id,
      name: timer.name,
      durationMs: timer.durationMs,
      remainingMs: timer.remainingMs,
      endsAt: timer.endsAt,
      status: timer.status,
    })),
  })
}
