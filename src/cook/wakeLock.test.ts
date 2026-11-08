import { describe, expect, it, vi } from 'vitest'
import {
  WakeLockController,
  WAKE_LOCK_ERROR,
  WAKE_LOCK_RELEASED,
  WAKE_LOCK_UNAVAILABLE,
  type WakeLockLike,
  type WakeLockSentinelLike,
} from './wakeLock'

class FakeSentinel implements WakeLockSentinelLike {
  released = false
  private readonly listeners = new Set<() => void>()

  release = async (): Promise<void> => {
    if (this.released) return
    this.released = true
    this.emitRelease()
  }

  addEventListener(_type: 'release', listener: () => void): void {
    this.listeners.add(listener)
  }

  removeEventListener(_type: 'release', listener: () => void): void {
    this.listeners.delete(listener)
  }

  systemRelease(): void {
    if (this.released) return
    this.released = true
    this.emitRelease()
  }

  private emitRelease(): void {
    for (const listener of [...this.listeners]) listener()
  }
}

function fakeWakeLock() {
  const sentinels: FakeSentinel[] = []
  const request = vi.fn(async () => {
    const sentinel = new FakeSentinel()
    sentinels.push(sentinel)
    return sentinel
  })
  const wakeLock: WakeLockLike = { request }
  return { wakeLock, request, sentinels }
}

describe('wake lock controller', () => {
  it('handles missing browser support without throwing', async () => {
    const controller = new WakeLockController({ wakeLock: null, isVisible: () => true })
    expect(controller.getSnapshot()).toMatchObject({
      supported: false,
      held: false,
      status: 'unavailable',
      message: WAKE_LOCK_UNAVAILABLE,
    })

    await controller.enable()
    expect(controller.getSnapshot().wanted).toBe(false)
    expect(controller.getSnapshot().status).toBe('unavailable')
    await controller.dispose()
  })

  it('requests, holds and releases the screen lock', async () => {
    const wake = fakeWakeLock()
    const controller = new WakeLockController({
      wakeLock: wake.wakeLock,
      isVisible: () => true,
    })

    await controller.enable()
    expect(wake.request).toHaveBeenCalledWith('screen')
    expect(controller.getSnapshot()).toMatchObject({
      wanted: true,
      held: true,
      status: 'active',
    })

    await controller.disable()
    expect(wake.sentinels[0]?.released).toBe(true)
    expect(controller.getSnapshot()).toMatchObject({
      wanted: false,
      held: false,
      status: 'off',
      message: null,
    })
  })

  it('releases on hidden tabs and re-requests when visible again', async () => {
    let visible = true
    const wake = fakeWakeLock()
    const controller = new WakeLockController({
      wakeLock: wake.wakeLock,
      isVisible: () => visible,
    })

    await controller.enable()
    expect(wake.sentinels).toHaveLength(1)

    visible = false
    await controller.handleVisibilityChange()
    expect(wake.sentinels[0]?.released).toBe(true)
    expect(controller.getSnapshot()).toMatchObject({
      wanted: true,
      held: false,
      status: 'off',
    })

    visible = true
    await controller.handleVisibilityChange()
    expect(wake.request).toHaveBeenCalledTimes(2)
    expect(controller.getSnapshot()).toMatchObject({
      wanted: true,
      held: true,
      status: 'active',
    })
  })

  it('does not request while hidden and waits for visibility', async () => {
    let visible = false
    const wake = fakeWakeLock()
    const controller = new WakeLockController({
      wakeLock: wake.wakeLock,
      isVisible: () => visible,
    })

    await controller.enable()
    expect(wake.request).not.toHaveBeenCalled()
    expect(controller.getSnapshot()).toMatchObject({
      wanted: true,
      held: false,
      status: 'off',
    })

    visible = true
    await controller.handleVisibilityChange()
    expect(wake.request).toHaveBeenCalledTimes(1)
    expect(controller.getSnapshot().status).toBe('active')
  })

  it('reacts to an automatic browser release without a request loop', async () => {
    const wake = fakeWakeLock()
    const controller = new WakeLockController({
      wakeLock: wake.wakeLock,
      isVisible: () => true,
    })

    await controller.enable()
    wake.sentinels[0]?.systemRelease()

    expect(controller.getSnapshot()).toMatchObject({
      wanted: false,
      held: false,
      status: 'released',
      message: WAKE_LOCK_RELEASED,
    })
    expect(wake.request).toHaveBeenCalledTimes(1)
  })

  it('reports a denied request and lets the user retry', async () => {
    const request = vi.fn(async () => {
      throw new Error('NotAllowedError')
    })
    const controller = new WakeLockController({
      wakeLock: { request },
      isVisible: () => true,
    })

    await controller.enable()
    expect(controller.getSnapshot()).toMatchObject({
      wanted: false,
      held: false,
      status: 'error',
      message: WAKE_LOCK_ERROR,
    })

    await controller.toggle()
    expect(request).toHaveBeenCalledTimes(2)
  })

  it('releases the lock when the cook mode controller is disposed', async () => {
    const wake = fakeWakeLock()
    const controller = new WakeLockController({
      wakeLock: wake.wakeLock,
      isVisible: () => true,
    })

    await controller.enable()
    await controller.dispose()
    expect(wake.sentinels[0]?.released).toBe(true)
    expect(controller.getSnapshot().held).toBe(false)
  })

  it('keeps the wish while suspended and releases the lock', async () => {
    const wake = fakeWakeLock()
    const controller = new WakeLockController({
      wakeLock: wake.wakeLock,
      isVisible: () => true,
    })

    await controller.enable()
    await controller.suspend()
    expect(wake.sentinels[0]?.released).toBe(true)
    expect(controller.getSnapshot()).toMatchObject({
      wanted: true,
      held: false,
      status: 'off',
    })
  })
})
