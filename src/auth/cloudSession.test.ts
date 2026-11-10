import { describe, expect, it } from 'vitest'
import { CloudDataError, CloudPermissionError } from '../data/cloudErrors'
import {
  CloudSessionController,
  type CloudAuthPort,
  type CloudSession,
  type CloudSessionState,
  type CloudStorePort,
} from './cloudSession'

const SESSION: CloudSession = {
  user: { id: 'user-1', email: 'familie@example.org' },
}

class FakeAuth implements CloudAuthPort {
  session: CloudSession | null = null
  getSessionCalls = 0
  signInCalls: Array<{ email: string; password: string }> = []
  signOutCalls = 0
  getSessionError: Error | null = null
  signInError: Error | null = null
  signOutError: Error | null = null
  private readonly listeners = new Set<
    (event: string, session: CloudSession | null) => void
  >()

  async getSession(): Promise<CloudSession | null> {
    this.getSessionCalls += 1
    if (this.getSessionError) throw this.getSessionError
    return this.session
  }

  onAuthStateChange(
    callback: (event: string, session: CloudSession | null) => void,
  ): () => void {
    this.listeners.add(callback)
    return () => {
      this.listeners.delete(callback)
    }
  }

  async signIn(email: string, password: string): Promise<CloudSession> {
    this.signInCalls.push({ email, password })
    if (this.signInError) throw this.signInError
    this.session = { user: { id: 'user-1', email } }
    this.emit('SIGNED_IN', this.session)
    return this.session
  }

  async signOut(): Promise<void> {
    this.signOutCalls += 1
    this.session = null
    this.emit('SIGNED_OUT', null)
    if (this.signOutError) throw this.signOutError
  }

  emit(event: string, session: CloudSession | null): void {
    for (const listener of [...this.listeners]) listener(event, session)
  }

  listenerCount(): number {
    return this.listeners.size
  }
}

class FakeStore implements CloudStorePort {
  loadCalls = 0
  disposeCalls = 0
  loadError: Error | null = null
  gate: Promise<void> | null = null
  private readonly data = new Map<string, unknown[]>()

  constructor(data: Record<string, unknown[]> = {}) {
    for (const [collection, rows] of Object.entries(data)) {
      this.data.set(collection, rows)
    }
  }

  async load(): Promise<void> {
    this.loadCalls += 1
    if (this.gate) await this.gate
    if (this.loadError) throw this.loadError
  }

  dispose(): void {
    this.disposeCalls += 1
  }

  list(collection: string): unknown[] {
    return this.data.get(collection) ?? []
  }
}

function setup(options: { session?: CloudSession | null; stores?: FakeStore[] } = {}) {
  const auth = new FakeAuth()
  auth.session = options.session ?? null
  const pool = [...(options.stores ?? [])]
  const created: FakeStore[] = []
  const states: CloudSessionState[] = []
  const controller = new CloudSessionController({
    auth,
    createStore: () => {
      const store = pool.shift() ?? new FakeStore()
      created.push(store)
      return store
    },
    onChange: (state) => states.push(state),
  })
  return { auth, controller, states, created }
}

describe('CloudSessionController', () => {
  it('startet ohne Session im abgemeldeten Zustand', async () => {
    const { auth, controller, states } = setup()
    await controller.start()

    expect(states.at(-1)).toEqual({ status: 'signed-out', error: null })
    expect(auth.getSessionCalls).toBe(1)
    expect(auth.listenerCount()).toBe(1)
    controller.dispose()
  })

  it('lädt bei vorhandener Session den Snapshot und meldet Bereitschaft', async () => {
    const store = new FakeStore({
      recipes: [{}, {}],
      mealPlans: [{}],
      shoppingLists: [{}],
      shoppingPurchases: [{}, {}],
    })
    const { controller, states } = setup({ session: SESSION, stores: [store] })

    await controller.start()

    expect(states.map((state) => state.status)).toEqual([
      'checking',
      'loading',
      'ready',
    ])
    expect(states.at(-1)).toMatchObject({
      status: 'ready',
      email: 'familie@example.org',
      counts: {
        recipes: 2,
        mealPlans: 1,
        shoppingLists: 1,
        shoppingPurchases: 2,
      },
    })
    expect(store.loadCalls).toBe(1)
  })

  it('meldet an, normalisiert die E-Mail und lädt genau einmal', async () => {
    const store = new FakeStore()
    const { auth, controller, states } = setup({ stores: [store] })
    await controller.start()

    await controller.signIn('  Familie@Example.org  ', 'geheim')

    expect(auth.signInCalls).toEqual([
      { email: 'familie@example.org', password: 'geheim' },
    ])
    expect(states.at(-1)).toMatchObject({
      status: 'ready',
      email: 'familie@example.org',
    })
    expect(store.loadCalls).toBe(1)
  })

  it('bleibt bei falschen Zugangsdaten abgemeldet und zeigt den Fehler', async () => {
    const { auth, controller } = setup()
    await controller.start()
    auth.signInError = new Error('E-Mail oder Passwort ist falsch.')

    await controller.signIn('familie@example.org', 'falsch')

    expect(controller.getState()).toEqual({
      status: 'signed-out',
      error: 'E-Mail oder Passwort ist falsch.',
    })
  })

  it('erkennt eine fehlende Haushaltsmitgliedschaft und kann erneut prüfen', async () => {
    const missing = new FakeStore()
    missing.loadError = new CloudPermissionError()
    const ok = new FakeStore({ recipes: [{}] })
    const { controller } = setup({
      session: SESSION,
      stores: [missing, ok],
    })

    await controller.start()
    expect(controller.getState()).toEqual({
      status: 'membership-missing',
      email: 'familie@example.org',
    })
    expect(missing.disposeCalls).toBe(1)

    await controller.retry()
    expect(controller.getState()).toMatchObject({
      status: 'ready',
      counts: { recipes: 1 },
    })
    expect(ok.loadCalls).toBe(1)
  })

  it('behandelt Netzwerkfehler und lädt bei Wiederholung neu', async () => {
    const broken = new FakeStore()
    broken.loadError = new CloudDataError('Netzwerk nicht erreichbar.')
    const ok = new FakeStore()
    const { controller } = setup({
      session: SESSION,
      stores: [broken, ok],
    })

    await controller.start()
    expect(controller.getState()).toEqual({
      status: 'error',
      email: 'familie@example.org',
      message: 'Netzwerk nicht erreichbar.',
    })

    await controller.retry()
    expect(controller.getState()).toMatchObject({ status: 'ready' })
    expect(ok.loadCalls).toBe(1)
  })

  it('meldet ab und verwirft Snapshot und Store', async () => {
    const store = new FakeStore()
    const { auth, controller } = setup({ session: SESSION, stores: [store] })
    await controller.start()

    await controller.logout()

    expect(auth.signOutCalls).toBe(1)
    expect(store.disposeCalls).toBe(1)
    expect(controller.getState()).toEqual({ status: 'signed-out', error: null })
  })

  it('reinigt auch dann, wenn die Serverabmeldung fehlschlägt', async () => {
    const store = new FakeStore()
    const { auth, controller } = setup({ session: SESSION, stores: [store] })
    await controller.start()
    auth.signOutError = new Error('Server nicht erreichbar.')

    await controller.logout()

    expect(store.disposeCalls).toBe(1)
    expect(controller.getState()).toEqual({
      status: 'signed-out',
      error: 'Server nicht erreichbar.',
    })
  })

  it('reagiert auf ein SIGNED_OUT-Ereignis mit Cleanup', async () => {
    const store = new FakeStore()
    const { auth, controller } = setup({ session: SESSION, stores: [store] })
    await controller.start()

    auth.emit('SIGNED_OUT', null)

    expect(store.disposeCalls).toBe(1)
    expect(controller.getState()).toEqual({ status: 'signed-out', error: null })
  })

  it('startet bei doppeltem SIGNED_IN keinen zweiten Snapshot-Load', async () => {
    const store = new FakeStore()
    const { auth, controller } = setup({ session: SESSION, stores: [store] })
    await controller.start()

    auth.emit('SIGNED_IN', SESSION)

    expect(store.loadCalls).toBe(1)
  })

  it('verwirft einen laufenden Load bei Logout und bleibt abgemeldet', async () => {
    const store = new FakeStore()
    let release!: () => void
    store.gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const { controller, states } = setup({ session: SESSION, stores: [store] })

    const starting = controller.start()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(store.loadCalls).toBe(1)

    await controller.logout()
    release()
    await starting

    expect(controller.getState()).toEqual({ status: 'signed-out', error: null })
    expect(states.some((state) => state.status === 'ready')).toBe(false)
    expect(store.disposeCalls).toBeGreaterThanOrEqual(1)
  })

  it('gibt bei dispose Listener und Store frei', async () => {
    const store = new FakeStore()
    const { auth, controller } = setup({ session: SESSION, stores: [store] })
    await controller.start()

    controller.dispose()

    expect(auth.listenerCount()).toBe(0)
    expect(store.disposeCalls).toBe(1)
    const stateBefore = controller.getState()
    auth.emit('SIGNED_IN', SESSION)
    expect(controller.getState()).toBe(stateBefore)
  })

  it('behandelt einen Fehler beim initialen Session-Check', async () => {
    const { auth, controller } = setup()
    auth.getSessionError = new Error('Sitzung nicht lesbar.')

    await controller.start()

    expect(controller.getState()).toEqual({
      status: 'error',
      email: null,
      message: 'Sitzung nicht lesbar.',
    })
  })
})
