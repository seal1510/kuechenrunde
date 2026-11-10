/*
 * Küchenrunde – Cloud-Sitzung und Bootstrap
 * Copyright (C) 2026 openCook Web contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Bewusst React-frei, damit Login, Bootstrap, Logout, Mitgliedschaftsfehler
 * und Rennen zwischen Auth-Events und Snapshot-Laden ohne DOM testbar sind.
 *
 * Der Controller ist die einzige Stelle, die den CloudRecordsStore erzeugt,
 * lädt und wieder verwirft. Beim Logout werden Snapshot und Realtime-Kanal
 * über store.dispose() geschlossen.
 */

import { CloudPermissionError } from '../data/cloudErrors'

export interface CloudSessionUser {
  id: string
  email: string | null
}

export interface CloudSession {
  user: CloudSessionUser
}

export interface CloudAuthPort {
  getSession(): Promise<CloudSession | null>
  onAuthStateChange(
    callback: (event: string, session: CloudSession | null) => void,
  ): () => void
  signIn(email: string, password: string): Promise<CloudSession>
  signOut(): Promise<void>
}

/** Enger Ausschnitt des CloudRecordsStore, den der Bootstrap benötigt. */
export interface CloudStorePort {
  load(): Promise<void>
  dispose(): void
  list(collection: string): unknown[]
}

export interface CloudSnapshotCounts {
  recipes: number
  mealPlans: number
  shoppingLists: number
  shoppingPurchases: number
}

export type CloudSessionState =
  | { status: 'checking' }
  | { status: 'signed-out'; error: string | null }
  | { status: 'signing-in'; email: string }
  | { status: 'loading'; email: string }
  | { status: 'ready'; email: string; counts: CloudSnapshotCounts }
  | { status: 'membership-missing'; email: string }
  | { status: 'error'; email: string | null; message: string }

export interface CloudSessionControllerOptions {
  auth: CloudAuthPort
  createStore: () => CloudStorePort
  onChange: (state: CloudSessionState) => void
}

function errorMessage(cause: unknown, fallback: string): string {
  if (cause instanceof Error && cause.message.trim()) return cause.message
  return fallback
}

function isMembershipError(cause: unknown): boolean {
  if (cause instanceof CloudPermissionError) return true
  return (
    typeof cause === 'object' &&
    cause !== null &&
    (cause as { code?: unknown }).code === '42501'
  )
}

export class CloudSessionController {
  private state: CloudSessionState = { status: 'checking' }
  private store: CloudStorePort | null = null
  private unsubscribeAuth: (() => void) | null = null
  private session: CloudSession | null = null
  private sessionUserId: string | null = null
  private started = false
  private disposed = false
  /** Invalidiert laufende Ladevorgänge nach Logout/Kontowechsel. */
  private runId = 0
  /** Läuft gerade ein Snapshot-Load? Mehrfache Auth-Events warten darauf. */
  private loadPromise: Promise<void> | null = null

  constructor(private readonly options: CloudSessionControllerOptions) {}

  getState(): CloudSessionState {
    return this.state
  }

  async start(): Promise<void> {
    if (this.started || this.disposed) return
    this.started = true
    this.setState({ status: 'checking' })
    this.unsubscribeAuth = this.options.auth.onAuthStateChange((event, session) => {
      this.handleAuthEvent(event, session)
    })
    await this.checkSession()
  }

  async signIn(email: string, password: string): Promise<void> {
    if (this.disposed) return
    if (this.state.status === 'signing-in' || this.state.status === 'loading') return
    const cleanEmail = String(email ?? '').trim().toLowerCase()
    this.setState({ status: 'signing-in', email: cleanEmail })
    try {
      const session = await this.options.auth.signIn(cleanEmail, password)
      if (this.disposed) return
      await this.bootstrap(session)
    } catch (cause) {
      if (this.disposed) return
      this.setState({
        status: 'signed-out',
        error: errorMessage(cause, 'Die Anmeldung ist fehlgeschlagen.'),
      })
    }
  }

  async retry(): Promise<void> {
    if (this.disposed) return
    if (this.session) {
      await this.bootstrap(this.session, true)
      return
    }
    this.setState({ status: 'checking' })
    await this.checkSession()
  }

  async logout(): Promise<void> {
    if (this.disposed) return
    this.runId += 1
    this.session = null
    this.sessionUserId = null
    this.disposeStore()

    let failure: string | null = null
    try {
      await this.options.auth.signOut()
    } catch (cause) {
      failure = errorMessage(cause, 'Die Abmeldung ist fehlgeschlagen.')
    }
    if (this.disposed) return
    this.setState({ status: 'signed-out', error: failure })
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.runId += 1
    this.unsubscribeAuth?.()
    this.unsubscribeAuth = null
    this.disposeStore()
    this.session = null
    this.sessionUserId = null
  }

  /* ---------------------------------------------------------------- */
  /* Intern                                                            */
  /* ---------------------------------------------------------------- */

  private async checkSession(): Promise<void> {
    const checkId = this.runId
    try {
      const session = await this.options.auth.getSession()
      if (this.disposed || this.runId !== checkId) return
      if (!session) {
        this.setState({ status: 'signed-out', error: null })
        return
      }
      // Ein paralleles INITIAL_SESSION/SIGNED_IN hat bereits einen Store
      // aufgebaut; dann nicht ein zweites Mal laden.
      if (this.store && this.sessionUserId === session.user.id) return
      await this.bootstrap(session)
    } catch (cause) {
      if (this.disposed || this.runId !== checkId) return
      this.setState({
        status: 'error',
        email: null,
        message: errorMessage(cause, 'Die Sitzung konnte nicht geprüft werden.'),
      })
    }
  }

  private handleAuthEvent(event: string, session: CloudSession | null): void {
    if (this.disposed) return

    if (event === 'SIGNED_OUT' || !session) {
      if (event === 'SIGNED_OUT' || this.sessionUserId) {
        this.resetToSignedOut(null)
      }
      return
    }

    if (event === 'SIGNED_IN' || event === 'INITIAL_SESSION') {
      if (this.store && this.sessionUserId === session.user.id) return
      void this.bootstrap(session)
    }
    // TOKEN_REFRESHED/USER_UPDATED benötigen keinen erneuten Snapshot.
  }

  private resetToSignedOut(error: string | null): void {
    this.runId += 1
    this.session = null
    this.sessionUserId = null
    this.disposeStore()
    this.setState({ status: 'signed-out', error })
  }

  private async bootstrap(session: CloudSession, force = false): Promise<void> {
    if (this.disposed) return
    // Ein bereits laufender oder abgeschlossener Bootstrap für dasselbe Konto
    // wird nicht doppelt gestartet. retry() erzwingt einen neuen Versuch.
    if (!force && this.sessionUserId === session.user.id) {
      await this.loadPromise?.catch(() => undefined)
      return
    }

    const runId = ++this.runId
    this.session = session
    this.sessionUserId = session.user.id
    const email = session.user.email ?? 'Mitglied'
    this.disposeStore()
    this.setState({ status: 'loading', email })

    let store: CloudStorePort | null = null
    let load: Promise<void> | null = null
    try {
      store = this.options.createStore()
      this.store = store
      load = store.load()
      this.loadPromise = load
      await load
      if (this.disposed || runId !== this.runId) {
        this.dropStore(store)
        return
      }
      this.setState({ status: 'ready', email, counts: this.counts(store) })
    } catch (cause) {
      if (store) this.dropStore(store)
      if (this.disposed || runId !== this.runId) return
      if (isMembershipError(cause)) {
        this.setState({ status: 'membership-missing', email })
        return
      }
      this.setState({
        status: 'error',
        email,
        message: errorMessage(cause, 'Die Cloud-Daten konnten nicht geladen werden.'),
      })
    } finally {
      if (this.loadPromise === load) this.loadPromise = null
    }
  }

  private counts(store: CloudStorePort): CloudSnapshotCounts {
    return {
      recipes: store.list('recipes').length,
      mealPlans: store.list('mealPlans').length,
      shoppingLists: store.list('shoppingLists').length,
      shoppingPurchases: store.list('shoppingPurchases').length,
    }
  }

  private disposeStore(): void {
    const store = this.store
    if (!store) return
    this.store = null
    store.dispose()
  }

  /** Verwirft nur den Store, der zu diesem Ladevorgang gehört. */
  private dropStore(store: CloudStorePort): void {
    if (this.store !== store) return
    this.store = null
    store.dispose()
  }

  private setState(next: CloudSessionState): void {
    if (this.disposed) return
    this.state = next
    this.options.onChange(next)
  }
}
