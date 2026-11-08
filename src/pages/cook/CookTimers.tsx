/*
 * openCook Web
 * Copyright (C) 2026 openCook Web contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Compact cook-mode timer controls. The panel is only mounted while open, so
 * cook mode stays uncluttered when no timer is in use. The always-visible
 * topbar toggle carries a count and the next running timer when collapsed.
 */

import {
  useId,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type Ref,
} from 'react'
import {
  MAX_TIMER_MINUTES,
  MAX_TIMER_NAME_LENGTH,
  TIMER_LIMIT_ERROR,
  accessibleTimerRemaining,
  displayTimerName,
  formatTimerClock,
  parseTimerDraft,
  type CookTimer,
} from '../../cook/timer'
import type { AddTimerResult } from '../../cook/timerStore'
import type { WakeLockSnapshot } from '../../cook/wakeLock'

function TimerIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      width="15"
      height="15"
      aria-hidden="true"
      focusable="false"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="8" cy="8.5" r="5.5" />
      <path d="M8 5.5v3.2l2 1.3M5.8 1.2h4.4" />
    </svg>
  )
}

function PlayIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      width="14"
      height="14"
      aria-hidden="true"
      focusable="false"
      fill="currentColor"
    >
      <path d="M5 3.3a.6.6 0 0 1 .9-.5l6 4.7a.6.6 0 0 1 0 1l-6 4.7a.6.6 0 0 1-.9-.5V3.3Z" />
    </svg>
  )
}

function PauseIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      width="14"
      height="14"
      aria-hidden="true"
      focusable="false"
      fill="currentColor"
    >
      <rect x="4" y="3" width="2.8" height="10" rx="0.7" />
      <rect x="9.2" y="3" width="2.8" height="10" rx="0.7" />
    </svg>
  )
}

function ResetIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      width="14"
      height="14"
      aria-hidden="true"
      focusable="false"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3.2 6.2A5.2 5.2 0 1 1 3 9.8M3.2 2.7v3.5h3.5" />
    </svg>
  )
}

function TrashIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      width="14"
      height="14"
      aria-hidden="true"
      focusable="false"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 4.5h10M6.4 4.5V3.1c0-.3.3-.6.6-.6h2c.3 0 .6.3.6.6v1.4M4.3 4.5l.6 8.2c0 .5.4.8.9.8h4.4c.5 0 .9-.3.9-.8l.6-8.2M6.8 7v4.2M9.2 7v4.2" />
    </svg>
  )
}

function SoundIcon({ muted }: { muted: boolean }) {
  return (
    <svg
      viewBox="0 0 16 16"
      width="15"
      height="15"
      aria-hidden="true"
      focusable="false"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M2.5 6.2h2.2L8 3.6v8.8L4.7 9.8H2.5V6.2Z" />
      {muted ? (
        <path d="m10.4 6.1 3.2 3.2M13.6 6.1l-3.2 3.2" />
      ) : (
        <path d="M10.6 5.5a3.6 3.6 0 0 1 0 5M12.4 4a5.5 5.5 0 0 1 0 8" />
      )}
    </svg>
  )
}

function WakeIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      width="15"
      height="15"
      aria-hidden="true"
      focusable="false"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="8" cy="8" r="2.8" />
      <path d="M8 1.3v1.6M8 13.1v1.6M1.3 8h1.6M13.1 8h1.6M3.3 3.3l1.1 1.1M11.6 11.6l1.1 1.1M12.7 3.3l-1.1 1.1M4.4 11.6l-1.1 1.1" />
    </svg>
  )
}

export function CookTimerToggle({
  timers,
  open,
  onToggle,
  buttonRef,
}: {
  timers: readonly CookTimer[]
  open: boolean
  onToggle: () => void
  buttonRef?: Ref<HTMLButtonElement>
}) {
  const running = timers.filter((timer) => timer.status === 'running')
  const expiredCount = timers.filter((timer) => timer.status === 'expired').length
  const nearest =
    running.length === 0
      ? null
      : running.reduce((best, timer) =>
          timer.remainingMs < best.remainingMs ? timer : best,
        )
  const summary =
    nearest !== null
      ? formatTimerClock(nearest.remainingMs)
      : expiredCount > 0
        ? 'abgelaufen'
        : timers.length > 0
          ? 'pausiert'
          : ''

  const accessible = ['Küchentimer', open ? 'schließen' : 'öffnen']
  if (timers.length > 0) {
    accessible.push(`${timers.length} Timer`)
    accessible.push(`${running.length} aktiv`)
    if (expiredCount > 0) accessible.push(`${expiredCount} abgelaufen`)
  }

  return (
    <button
      type="button"
      ref={buttonRef}
      className={`cook-timer-toggle${expiredCount > 0 ? ' has-expired' : ''}`}
      aria-expanded={open}
      aria-controls={open ? 'cook-timer-panel' : undefined}
      aria-label={accessible.join(', ')}
      onClick={onToggle}
    >
      <TimerIcon />
      <span className="cook-timer-toggle-label">Timer</span>
      {timers.length > 0 ? (
        <span className="cook-timer-count" aria-hidden="true">
          {timers.length}
        </span>
      ) : null}
      {summary ? (
        <span className="cook-timer-summary" aria-hidden="true">
          {summary}
        </span>
      ) : null}
      {expiredCount > 0 ? <span className="cook-timer-alert-dot" aria-hidden="true" /> : null}
    </button>
  )
}

export function WakeLockToggle({
  snapshot,
  onToggle,
}: {
  snapshot: WakeLockSnapshot
  onToggle: () => void
}) {
  const statusId = useId()
  const noteId = useId()
  const statusText = !snapshot.supported
    ? 'Nicht verfügbar'
    : snapshot.status === 'requesting'
      ? 'Wird aktiviert'
      : snapshot.status === 'error'
        ? 'Nicht aktiv'
        : snapshot.status === 'released'
          ? 'Vom Browser beendet'
          : snapshot.held
            ? 'Aktiv'
            : snapshot.wanted
              ? 'Pausiert'
              : ''

  return (
    <div className="cook-wake">
      <button
        type="button"
        className="cook-wake-toggle"
        aria-pressed={snapshot.held}
        aria-describedby={`${statusId} ${noteId}`}
        disabled={!snapshot.supported || snapshot.status === 'requesting'}
        onClick={onToggle}
        title={
          snapshot.supported
            ? 'Bildschirm wach halten. Nicht auf jedem Gerät verfügbar.'
            : 'Dieser Browser unterstützt das Wachhalten des Bildschirms nicht.'
        }
      >
        <WakeIcon />
        <span>Wachhalten</span>
      </button>
      <span id={statusId} className="cook-wake-status" role="status" aria-live="polite">
        {statusText}
      </span>
      <span id={noteId} className="visually-hidden">
        Die Verfügbarkeit hängt vom Browser und Gerät ab.
      </span>
    </div>
  )
}

function CookTimerCard({
  timer,
  index,
  onStart,
  onPause,
  onReset,
  onRemove,
}: {
  timer: CookTimer
  index: number
  onStart: (id: string) => void
  onPause: (id: string) => void
  onReset: (id: string) => void
  onRemove: (id: string) => void
}) {
  const name = displayTimerName(timer.name, index)
  const isRunning = timer.status === 'running'
  const statusLabel = isRunning
    ? 'Läuft'
    : timer.status === 'paused'
      ? 'Pausiert'
      : 'Abgelaufen'
  const primaryLabel = isRunning
    ? 'Pause'
    : timer.status === 'expired'
      ? 'Neu starten'
      : 'Start'
  const primaryAction = isRunning
    ? `Timer ${name} pausieren`
    : timer.status === 'expired'
      ? `Timer ${name} erneut starten`
      : `Timer ${name} starten`

  return (
    <li className={`cook-timer-card is-${timer.status}`}>
      <div className="cook-timer-card-head">
        <h3 className="cook-timer-name">{name}</h3>
        <span className={`badge cook-timer-status is-${timer.status}`}>{statusLabel}</span>
      </div>
      <p className="cook-timer-remaining">
        <span className="cook-timer-clock" aria-hidden="true">
          {formatTimerClock(timer.remainingMs)}
        </span>
        <span className="visually-hidden">{accessibleTimerRemaining(timer)}</span>
      </p>
      <div className="cook-timer-actions">
        <button
          type="button"
          className="button primary cook-timer-action"
          aria-label={primaryAction}
          onClick={() => (isRunning ? onPause(timer.id) : onStart(timer.id))}
        >
          {isRunning ? <PauseIcon /> : <PlayIcon />}
          <span>{primaryLabel}</span>
        </button>
        <button
          type="button"
          className="button cook-timer-action"
          aria-label={`Timer ${name} zurücksetzen`}
          onClick={() => onReset(timer.id)}
        >
          <ResetIcon />
          <span>Zurücksetzen</span>
        </button>
        <button
          type="button"
          className="button quiet cook-timer-action cook-timer-remove"
          aria-label={`Timer ${name} entfernen`}
          onClick={() => onRemove(timer.id)}
        >
          <TrashIcon />
          <span>Entfernen</span>
        </button>
      </div>
    </li>
  )
}

export function CookTimerPanel({
  timers,
  soundEnabled,
  storageError,
  atLimit,
  onAdd,
  onStart,
  onPause,
  onReset,
  onRemove,
  onToggleSound,
  onClose,
}: {
  timers: readonly CookTimer[]
  soundEnabled: boolean
  storageError: string | null
  atLimit: boolean
  onAdd: (input: { durationMs: number; name: string }) => AddTimerResult
  onStart: (id: string) => void
  onPause: (id: string) => void
  onReset: (id: string) => void
  onRemove: (id: string) => void
  onToggleSound: () => void
  onClose: () => void
}) {
  const minutesId = useId()
  const secondsId = useId()
  const nameId = useId()
  const errorId = useId()
  const headingRef = useRef<HTMLHeadingElement>(null)
  const [minutes, setMinutes] = useState('5')
  const [seconds, setSeconds] = useState('0')
  const [name, setName] = useState('')
  const [formError, setFormError] = useState<string | null>(null)

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const parsed = parseTimerDraft({ minutes, seconds, name })
    if (!parsed.ok) {
      setFormError(parsed.error)
      return
    }
    const result = onAdd({ durationMs: parsed.durationMs, name: parsed.name })
    if (!result.ok) {
      setFormError(result.error ?? 'Der Timer konnte nicht angelegt werden.')
      return
    }
    setFormError(null)
    setName('')
  }

  function removeTimer(id: string) {
    onRemove(id)
    // The remove button disappears with the card; keep keyboard users in the
    // panel instead of dropping focus to the document body.
    headingRef.current?.focus()
  }

  function handleKeyDown(event: ReactKeyboardEvent<HTMLElement>) {
    if (event.key === 'Escape') {
      event.stopPropagation()
      onClose()
    }
  }

  return (
    <section
      id="cook-timer-panel"
      className="cook-timers"
      aria-labelledby="cook-timers-title"
      onKeyDown={handleKeyDown}
    >
      <div className="cook-timer-panel-head">
        <h2 id="cook-timers-title" ref={headingRef} tabIndex={-1}>
          Küchentimer
        </h2>
        <button
          type="button"
          className="button quiet cook-timer-sound"
          aria-pressed={soundEnabled}
          onClick={onToggleSound}
          title="Kurzer Signalton beim Ablauf, falls der Browser Audio erlaubt."
        >
          <SoundIcon muted={!soundEnabled} />
          <span>{soundEnabled ? 'Ton an' : 'Ton aus'}</span>
        </button>
      </div>

      <form className="cook-timer-form" onSubmit={submit} noValidate>
        <div className="cook-timer-fields">
          <div className="cook-timer-field cook-timer-field-time">
            <label htmlFor={minutesId}>Minuten</label>
            <input
              id={minutesId}
              type="number"
              inputMode="numeric"
              min={0}
              max={MAX_TIMER_MINUTES}
              step={1}
              value={minutes}
              aria-describedby={formError ? errorId : undefined}
              onChange={(event) => setMinutes(event.target.value)}
            />
          </div>
          <div className="cook-timer-field cook-timer-field-time">
            <label htmlFor={secondsId}>Sekunden</label>
            <input
              id={secondsId}
              type="number"
              inputMode="numeric"
              min={0}
              max={59}
              step={1}
              value={seconds}
              aria-describedby={formError ? errorId : undefined}
              onChange={(event) => setSeconds(event.target.value)}
            />
          </div>
          <div className="cook-timer-field cook-timer-field-name">
            <label htmlFor={nameId}>Name (optional)</label>
            <input
              id={nameId}
              type="text"
              maxLength={MAX_TIMER_NAME_LENGTH}
              autoComplete="off"
              placeholder="z. B. Pasta"
              value={name}
              aria-describedby={formError ? errorId : undefined}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
        </div>
        <button type="submit" className="button primary cook-timer-add" disabled={atLimit}>
          <PlayIcon />
          <span>Timer starten</span>
        </button>
      </form>

      {atLimit ? (
        <p className="cook-timer-limit" role="status">
          {TIMER_LIMIT_ERROR}
        </p>
      ) : null}
      {formError ? (
        <p id={errorId} className="cook-timer-form-error" role="alert">
          {formError}
        </p>
      ) : null}
      {storageError ? (
        <p className="cook-timer-storage-note" role="status">
          {storageError}
        </p>
      ) : null}

      {timers.length > 0 ? (
        <ol className="cook-timer-list" aria-label="Timer">
          {timers.map((timer, index) => (
            <CookTimerCard
              key={timer.id}
              timer={timer}
              index={index}
              onStart={onStart}
              onPause={onPause}
              onReset={onReset}
              onRemove={removeTimer}
            />
          ))}
        </ol>
      ) : null}
    </section>
  )
}
