import { describe, expect, it, vi } from 'vitest'
import {
  MAX_COOK_TIMERS,
  TIMER_STORAGE_KEY,
  TIMER_STORAGE_READ_ERROR,
  TIMER_STORAGE_UNAVAILABLE,
  type CookTimer,
} from './timer'
import { TimerStore, type TimerStorage } from './timerStore'

class MemoryStorage implements TimerStorage {
  readonly values = new Map<string, string>()

  getItem(key: string): string | null {
    return this.values.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value)
  }

  removeItem(key: string): void {
    this.values.delete(key)
  }
}

function storeWith(
  storage: TimerStorage | null,
  now: () => number,
  onExpired?: (timers: readonly CookTimer[]) => void,
): TimerStore {
  let nextId = 0
  return new TimerStore({
    storage,
    now,
    createId: () => `timer-${++nextId}`,
    onExpired,
  })
}

describe('timer store', () => {
  it('runs several timers in parallel from absolute end times', () => {
    let now = 1_000_000
    const store = storeWith(new MemoryStorage(), () => now)

    const first = store.add({ durationMs: 60_000, name: 'Pasta' })
    const second = store.add({ durationMs: 120_000, name: 'Ofen' })
    expect(first.ok).toBe(true)
    expect(second.ok).toBe(true)
    expect(store.getSnapshot().timers).toHaveLength(2)

    // Deliberately skip 10 seconds instead of ticking every second. Remaining
    // time must still come from endsAt, not from a countdown interval.
    now += 10_000
    store.tick()

    expect(store.getSnapshot().timers[0]).toMatchObject({
      name: 'Pasta',
      status: 'running',
      remainingMs: 50_000,
      endsAt: 1_060_000,
    })
    expect(store.getSnapshot().timers[1]).toMatchObject({
      name: 'Ofen',
      status: 'running',
      remainingMs: 110_000,
      endsAt: 1_120_000,
    })
  })

  it('pauses, resumes and resets one timer without touching the other', () => {
    let now = 2_000_000
    const store = storeWith(new MemoryStorage(), () => now)
    const pasta = store.add({ durationMs: 90_000, name: 'Pasta' }).timer
    store.add({ durationMs: 60_000, name: 'Tee' })
    if (!pasta) throw new Error('timer was not created')

    now += 15_000
    store.pause(pasta.id)
    expect(store.getSnapshot().timers[0]).toMatchObject({
      status: 'paused',
      remainingMs: 75_000,
      endsAt: null,
    })

    now += 30_000
    store.tick()
    expect(store.getSnapshot().timers[0]?.remainingMs).toBe(75_000)

    store.start(pasta.id)
    expect(store.getSnapshot().timers[0]).toMatchObject({
      status: 'running',
      remainingMs: 75_000,
      endsAt: 2_120_000,
    })
    expect(store.getSnapshot().timers[1]).toMatchObject({
      name: 'Tee',
      status: 'running',
      remainingMs: 15_000,
    })

    now += 5_000
    store.tick()
    expect(store.getSnapshot().timers[0]?.remainingMs).toBe(70_000)

    store.reset(pasta.id)
    expect(store.getSnapshot().timers[0]).toMatchObject({
      status: 'paused',
      remainingMs: 90_000,
      endsAt: null,
    })
  })

  it('marks expiry once and does not fire again on later ticks', () => {
    let now = 3_000_000
    const onExpired = vi.fn()
    const store = storeWith(new MemoryStorage(), () => now, onExpired)
    const result = store.add({ durationMs: 5_000, name: 'Ofen' })
    if (!result.timer) throw new Error('timer was not created')

    now += 5_000
    store.tick()
    expect(store.getSnapshot().timers[0]).toMatchObject({
      status: 'expired',
      remainingMs: 0,
      endsAt: null,
    })
    expect(onExpired).toHaveBeenCalledTimes(1)
    expect(onExpired.mock.calls[0]?.[0][0]).toMatchObject({ id: result.timer.id })

    store.tick()
    expect(onExpired).toHaveBeenCalledTimes(1)
  })

  it('marks a timer expired when pause is pressed after its end', () => {
    let now = 4_000_000
    const onExpired = vi.fn()
    const store = storeWith(new MemoryStorage(), () => now, onExpired)
    const result = store.add({ durationMs: 5_000, name: 'Kurz' })
    if (!result.timer) throw new Error('timer was not created')

    now += 6_000
    store.pause(result.timer.id)
    expect(store.getSnapshot().timers[0]?.status).toBe('expired')
    expect(onExpired).toHaveBeenCalledTimes(1)
  })

  it('restores running, paused and already expired timers after a reload', () => {
    let now = 5_000_000
    const storage = new MemoryStorage()
    const first = storeWith(storage, () => now)
    first.add({ durationMs: 60_000, name: 'Läuft' })
    first.add({ durationMs: 120_000, name: 'Pausiert' })
    first.add({ durationMs: 10_000, name: 'Alt' })
    const paused = first.getSnapshot().timers[1]
    if (!paused) throw new Error('timer was not created')
    now += 5_000
    first.pause(paused.id)
    first.setSoundEnabled(false)

    now += 6_000
    const restored = storeWith(storage, () => now)
    expect(restored.getSnapshot().soundEnabled).toBe(false)
    expect(restored.getSnapshot().timers).toHaveLength(3)
    expect(restored.getSnapshot().timers[0]).toMatchObject({
      name: 'Läuft',
      status: 'running',
      remainingMs: 49_000,
    })
    expect(restored.getSnapshot().timers[1]).toMatchObject({
      name: 'Pausiert',
      status: 'paused',
      remainingMs: 115_000,
    })
    expect(restored.getSnapshot().timers[2]).toMatchObject({
      name: 'Alt',
      status: 'expired',
      remainingMs: 0,
    })
  })

  it('limits the number of simultaneous timers', () => {
    const store = storeWith(new MemoryStorage(), () => 0)
    for (let index = 0; index < MAX_COOK_TIMERS; index += 1) {
      expect(store.add({ durationMs: 1_000, name: '' }).ok).toBe(true)
    }
    const extra = store.add({ durationMs: 1_000, name: '' })
    expect(extra.ok).toBe(false)
    expect(extra.error).toContain(String(MAX_COOK_TIMERS))
  })
})

describe('timer storage failures', () => {
  it('keeps timers usable when storage is unavailable', () => {
    const store = storeWith(null, () => 1_000)
    expect(store.getSnapshot().storageError).toBe(TIMER_STORAGE_UNAVAILABLE)
    expect(store.add({ durationMs: 5_000, name: 'Ohne Speicher' }).ok).toBe(true)
    expect(store.getSnapshot().timers).toHaveLength(1)
  })

  it('ignores corrupt records, reports the problem and recovers on the next write', () => {
    const storage = new MemoryStorage()
    storage.setItem(TIMER_STORAGE_KEY, '{broken')
    const store = storeWith(storage, () => 1_000)
    expect(store.getSnapshot().timers).toHaveLength(0)
    expect(store.getSnapshot().storageError).toBe(TIMER_STORAGE_READ_ERROR)

    expect(store.add({ durationMs: 5_000, name: 'Neu' }).ok).toBe(true)
    expect(store.getSnapshot().storageError).toBeNull()
    expect(storage.getItem(TIMER_STORAGE_KEY)).toContain('"version":1')
  })

  it('keeps timers in memory when writing to storage fails', () => {
    const storage: TimerStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error('QuotaExceededError')
      },
      removeItem: () => undefined,
    }
    const store = storeWith(storage, () => 1_000)
    expect(store.add({ durationMs: 5_000, name: 'Im Speicher' }).ok).toBe(true)
    expect(store.getSnapshot().timers).toHaveLength(1)
    expect(store.getSnapshot().storageError).toBe(TIMER_STORAGE_UNAVAILABLE)
  })
})
