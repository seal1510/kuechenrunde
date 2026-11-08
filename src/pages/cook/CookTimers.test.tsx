import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { CookTimer } from '../../cook/timer'
import type { WakeLockSnapshot } from '../../cook/wakeLock'
import { CookTimerPanel, CookTimerToggle, WakeLockToggle } from './CookTimers'

const runningTimer: CookTimer = {
  id: 't1',
  name: 'Pasta',
  durationMs: 120_000,
  remainingMs: 65_000,
  endsAt: 1_065_000,
  status: 'running',
}

const pausedTimer: CookTimer = {
  id: 't2',
  name: '',
  durationMs: 60_000,
  remainingMs: 30_000,
  endsAt: null,
  status: 'paused',
}

const expiredTimer: CookTimer = {
  id: 't3',
  name: 'Ofen',
  durationMs: 300_000,
  remainingMs: 0,
  endsAt: null,
  status: 'expired',
}

const noop = () => undefined

function panelMarkup(
  timers: readonly CookTimer[],
  options: { soundEnabled?: boolean; storageError?: string | null; atLimit?: boolean } = {},
) {
  return renderToStaticMarkup(
    <CookTimerPanel
      timers={timers}
      soundEnabled={options.soundEnabled ?? true}
      storageError={options.storageError ?? null}
      atLimit={options.atLimit ?? false}
      onAdd={() => ({ ok: true })}
      onStart={noop}
      onPause={noop}
      onReset={noop}
      onRemove={noop}
      onToggleSound={noop}
      onClose={noop}
    />,
  )
}

describe('cook timer panel', () => {
  it('shows compact inputs and all timer states', () => {
    const html = panelMarkup([runningTimer, pausedTimer, expiredTimer])

    expect(html).toContain('Küchentimer')
    expect(html).toContain('Minuten')
    expect(html).toContain('Sekunden')
    expect(html).toContain('Name (optional)')
    expect(html).toContain('Timer starten')
    expect(html).toContain('Ton an')

    expect(html).toContain('Pasta')
    expect(html).toContain('Timer 2')
    expect(html).toContain('Läuft')
    expect(html).toContain('Pausiert')
    expect(html).toContain('Abgelaufen')
    expect(html).toContain('Pause')
    expect(html).toContain('Start')
    expect(html).toContain('Neu starten')
    expect(html).toContain('Zurücksetzen')
    expect(html).toContain('Entfernen')

    expect(html).toContain('01:05')
    expect(html).toContain('00:30')
    expect(html).toContain('00:00')
    expect(html).toContain('noch 1 Minute 5 Sekunden')
    expect(html).toContain('pausiert bei 30 Sekunden')
    expect(html).toContain('abgelaufen')
  })

  it('keeps the ticking clock out of live regions', () => {
    const html = panelMarkup([runningTimer])
    expect(html).toContain('cook-timer-clock')
    expect(html).not.toMatch(/cook-timer-clock[^>]*aria-live/)
    expect(html).not.toMatch(/cook-timer-remaining[^>]*aria-live/)
  })

  it('shows storage limitations and the simultaneous timer limit', () => {
    const html = panelMarkup([], {
      storageError: 'Timer können nicht gespeichert werden.',
      atLimit: true,
    })
    expect(html).toContain('Timer können nicht gespeichert werden.')
    expect(html).toContain('höchstens 12 Timer')
    expect(html).toMatch(/<button[^>]*cook-timer-add[^>]*disabled=""/)
  })

  it('labels the sound toggle without requiring sound permission', () => {
    const off = panelMarkup([runningTimer], { soundEnabled: false })
    expect(off).toContain('Ton aus')
    expect(off).toContain('aria-pressed="false"')
  })
})

describe('collapsed timer and wake-lock entries', () => {
  it('keeps active timers recognisable in the collapsed topbar entry', () => {
    const html = renderToStaticMarkup(
      <CookTimerToggle
        timers={[runningTimer, expiredTimer]}
        open={false}
        onToggle={noop}
      />,
    )
    expect(html).toContain('aria-expanded="false"')
    expect(html).toContain('Timer')
    expect(html).toContain('01:05')
    expect(html).toContain('1 aktiv')
    expect(html).toContain('1 abgelaufen')
    expect(html).toContain('has-expired')
  })

  it('describes the wake lock state and supports unavailable browsers', () => {
    const active: WakeLockSnapshot = {
      supported: true,
      wanted: true,
      held: true,
      status: 'active',
      message: null,
    }
    const activeHtml = renderToStaticMarkup(
      <WakeLockToggle snapshot={active} onToggle={noop} />,
    )
    expect(activeHtml).toContain('aria-pressed="true"')
    expect(activeHtml).toContain('Aktiv')

    const unavailable: WakeLockSnapshot = {
      supported: false,
      wanted: false,
      held: false,
      status: 'unavailable',
      message: 'In diesem Browser nicht verfügbar.',
    }
    const unavailableHtml = renderToStaticMarkup(
      <WakeLockToggle snapshot={unavailable} onToggle={noop} />,
    )
    expect(unavailableHtml).toContain('Nicht verfügbar')
    expect(unavailableHtml).toMatch(/<button[^>]*cook-wake-toggle[^>]*disabled=""/)
  })
})
