/*
 * Küchenrunde – Cloud-Persistenz, gemeinsame Grundlage
 * Copyright (C) 2026 openCook Web contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Ein bewusst kleiner Dokumentstore über public.records. Kein Nachbau der
 * gesamten Dexie-API, keine Offline-Warteschlange und keine automatische
 * Konfliktauflösung.
 *
 * Garantien:
 *  * Der Snapshot wird einmal vollständig geladen und danach über Realtime
 *    zeilenweise aktuell gehalten.
 *  * Schreiben laufen über apply_ops() und sind pro Aufruf atomar.
 *  * Updates/Deletes tragen die erwartete Revision (Compare-and-Swap). Eine
 *    zwischenzeitliche fremde Änderung führt zu RecordConflictError, nicht zu
 *    einem stillen Überschreiben.
 *  * Lesezugriffe innerhalb einer Transaktion sehen die noch nicht
 *    geschriebenen Änderungen derselben Transaktion.
 */

import {
  CloudConflictError,
  CloudDataError,
  CloudNotLoadedError,
} from './cloudErrors'

export interface RecordRow<T = unknown> {
  collection: string
  id: string
  rev: number
  data: T
}

export interface RecordUpsert {
  collection: string
  id: string
  updated_at: number
  data: unknown
  /** 0 = anlegen, > 0 = nur aktualisieren, wenn die Revision noch stimmt. */
  expected_rev: number
}

export interface RecordDelete {
  collection: string
  id: string
  /** null = unbedingt löschen; Zahl = nur bei passender Revision. */
  expected_rev: number | null
}

export interface ApplyOpsPayload {
  clear: string[]
  upserts: RecordUpsert[]
  deletes: RecordDelete[]
}

export interface ApplyResultEntry {
  collection: string
  id: string
  rev: number
}

export interface ApplyOpsResult {
  applied: ApplyResultEntry[]
  deleted: Array<{ collection: string; id: string }>
}

export type RecordChange =
  | { type: 'upsert'; row: RecordRow }
  | { type: 'delete'; collection: string; id: string; rev?: number }

export interface RecordsSubscriptionHandlers {
  onChange: (change: RecordChange) => void
  onStatus?: (status: string) => void
}

export interface RecordsBackend {
  snapshot(): Promise<RecordRow[]>
  applyOps(payload: ApplyOpsPayload): Promise<ApplyOpsResult>
  fetch(collection: string, id: string): Promise<RecordRow | null>
  /** Liefert eine Abmeldefunktion. */
  subscribe(handlers: RecordsSubscriptionHandlers): () => void
}

export class RecordConflictError extends CloudConflictError {
  readonly collection: string
  readonly id: string
  readonly current: RecordRow | null

  constructor(collection: string, id: string, current: RecordRow | null) {
    super(
      current
        ? 'Der Datensatz wurde zwischenzeitlich geändert. Bitte neu laden.'
        : 'Der Datensatz existiert nicht mehr.',
    )
    this.name = 'RecordConflictError'
    this.collection = collection
    this.id = id
    this.current = current
  }
}

interface PendingEntry {
  collection: string
  id: string
  data: unknown
  expectedRev: number
  deleted: boolean
}

function rowKey(collection: string, id: string): string {
  return `${collection}\u0000${id}`
}

function assertKey(collection: string, id: string): void {
  if (!collection?.trim() || !id?.trim()) {
    throw new CloudDataError('Collection und Datensatz-ID müssen gesetzt sein.')
  }
}

function assertRecordData(data: unknown): void {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    throw new CloudDataError('Es können nur JSON-Objekte gespeichert werden.')
  }
}

function updatedAtOf(data: unknown): number {
  if (typeof data === 'object' && data !== null && !Array.isArray(data)) {
    const value = (data as { updatedAt?: unknown }).updatedAt
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
      return Math.round(value)
    }
  }
  return Date.now()
}

export class CloudRecordsStore {
  private readonly rows = new Map<string, RecordRow>()
  private readonly listeners = new Set<() => void>()
  private queue: Promise<unknown> = Promise.resolve()
  private version = 0
  private loaded = false
  private disposed = false
  private unsubscribeRealtime: (() => void) | null = null
  private realtimeSynced = false
  private sawRealtimeDisconnect = false

  constructor(private readonly backend: RecordsBackend) {}

  isLoaded(): boolean {
    return this.loaded
  }

  getVersion(): number {
    return this.version
  }

  /** Wird bei jeder angewendeten Änderung aufgerufen. Liefert Abmeldefunktion. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /**
   * Lädt den vollständigen Snapshot. Wird beim Start und nach einem
   * Realtime-Reconnect aufgerufen. Schreibvorgänge warten auf den Abschluss.
   */
  async load(): Promise<void> {
    return this.enqueue(() => this.loadSnapshot())
  }

  get<T>(collection: string, id: string): RecordRow<T> | undefined {
    this.assertReady()
    assertKey(collection, id)
    return this.rows.get(rowKey(collection, id)) as RecordRow<T> | undefined
  }

  list<T>(collection: string): RecordRow<T>[] {
    this.assertReady()
    const result: RecordRow<T>[] = []
    for (const row of this.rows.values()) {
      if (row.collection === collection) result.push(row as RecordRow<T>)
    }
    return result
  }

  /** Vorhandene Collection-Namen; für die Leer-Prüfung vor einem Restore. */
  collections(): string[] {
    this.assertReady()
    return [...new Set([...this.rows.values()].map((row) => row.collection))].sort()
  }

  /** Legt einen neuen Datensatz an. Existiert die ID bereits: Konflikt. */
  async create<T>(collection: string, id: string, data: T): Promise<RecordRow<T>> {
    this.assertReady()
    return this.runUpsert(collection, id, data, 0)
  }

  /** Aktualisiert nur, wenn die geladene Revision noch aktuell ist. */
  async update<T>(
    collection: string,
    id: string,
    data: T,
    expectedRev: number,
  ): Promise<RecordRow<T>> {
    this.assertReady()
    if (!Number.isInteger(expectedRev) || expectedRev <= 0) {
      throw new CloudDataError('Für ein Update wird eine positive erwartete Revision benötigt.')
    }
    return this.runUpsert(collection, id, data, expectedRev)
  }

  /** Löscht nur, wenn die geladene Revision noch aktuell ist. */
  async remove(collection: string, id: string, expectedRev: number): Promise<void> {
    this.assertReady()
    assertKey(collection, id)
    if (!Number.isInteger(expectedRev) || expectedRev <= 0) {
      throw new CloudDataError('Für ein Löschen wird eine positive erwartete Revision benötigt.')
    }

    await this.enqueue(async () => {
      try {
        await this.backend.applyOps({
          clear: [],
          upserts: [],
          deletes: [{ collection, id, expected_rev: expectedRev }],
        })
        this.rows.delete(rowKey(collection, id))
        this.emit()
      } catch (cause) {
        if (cause instanceof CloudConflictError) {
          const current = await this.fetchCurrent(collection, id)
          throw new RecordConflictError(collection, id, current)
        }
        throw cause
      }
    })
  }

  /**
   * Führt mehrere Schreibvorgänge als einen atomaren apply_ops-Aufruf aus.
   * Lesen im Callback sehen die gepufferten Änderungen. Bei einem Konflikt
   * wird der gesamte Batch verworfen und der Snapshot neu geladen.
   */
  async transaction<T>(fn: (tx: RecordsTransaction) => Promise<T>): Promise<T> {
    this.assertReady()
    return this.enqueue(async () => {
      const tx = new RecordsTransaction(this)
      const result = await fn(tx)
      const payload = tx.toPayload()
      if (
        payload.clear.length === 0 &&
        payload.upserts.length === 0 &&
        payload.deletes.length === 0
      ) {
        return result
      }

      try {
        const applied = await this.backend.applyOps(payload)
        this.applyTransaction(payload, applied)
        this.emit()
        return result
      } catch (cause) {
        // Die RPC ist atomar. Ein Reload stellt den lokalen Stand wieder her,
        // auch wenn die Antwort verloren gegangen ist.
        try {
          await this.loadSnapshot()
        } catch {
          this.loaded = false
        }
        if (cause instanceof CloudConflictError) {
          throw new CloudConflictError(
            'Die Transaktion wurde wegen einer zwischenzeitlichen Änderung nicht angewendet.',
          )
        }
        throw cause
      }
    })
  }

  /** Holt eine einzelne Zeile frisch vom Server und aktualisiert den Snapshot. */
  async refresh(collection: string, id: string): Promise<RecordRow | null> {
    this.assertReady()
    assertKey(collection, id)
    return this.enqueue(() => this.fetchCurrent(collection, id))
  }

  dispose(): void {
    this.disposed = true
    this.unsubscribeRealtime?.()
    this.unsubscribeRealtime = null
    this.listeners.clear()
    this.rows.clear()
    this.loaded = false
  }

  /* ---------------------------------------------------------------- */
  /* Intern                                                            */
  /* ---------------------------------------------------------------- */

  private assertReady(): void {
    if (this.disposed) throw new CloudNotLoadedError('Der Cloud-Store wurde beendet.')
    if (!this.loaded) throw new CloudNotLoadedError()
  }

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task, task)
    this.queue = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }

  private async loadSnapshot(): Promise<void> {
    const rows = await this.backend.snapshot()
    const next = new Map<string, RecordRow>()
    for (const row of rows) {
      if (
        !row ||
        typeof row.collection !== 'string' ||
        !row.collection.trim() ||
        typeof row.id !== 'string' ||
        !row.id.trim() ||
        !Number.isInteger(row.rev) ||
        row.rev <= 0 ||
        typeof row.data !== 'object' ||
        row.data === null ||
        Array.isArray(row.data)
      ) {
        throw new CloudDataError('Supabase hat ungültige Datensätze geliefert.')
      }
      const key = rowKey(row.collection, row.id)
      if (next.has(key)) {
        throw new CloudDataError(
          `Doppelter Datensatz in Supabase: ${row.collection}/${row.id}.`,
        )
      }
      next.set(key, row)
    }

    this.rows.clear()
    for (const [key, row] of next) this.rows.set(key, row)
    this.loaded = true
    this.startRealtime()
    this.emit()
  }

  private startRealtime(): void {
    if (this.disposed || this.unsubscribeRealtime) return
    this.unsubscribeRealtime = this.backend.subscribe({
      onChange: (change) => this.applyChange(change),
      onStatus: (status) => this.handleRealtimeStatus(status),
    })
  }

  private handleRealtimeStatus(status: string): void {
    if (this.disposed) return
    if (status === 'SUBSCRIBED') {
      // Beim ersten Subscribe und nach einem Abbruch einmal vollständig
      // nachladen, um das Fenster zwischen Snapshot und Kanal zu schließen.
      if (!this.realtimeSynced || this.sawRealtimeDisconnect) {
        this.realtimeSynced = true
        this.sawRealtimeDisconnect = false
        void this.load().catch(() => {
          // Der nächste Reconnect oder ein manueller Reload versucht es erneut.
        })
      }
      return
    }
    if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
      this.sawRealtimeDisconnect = true
    }
  }

  private applyChange(change: RecordChange): void {
    if (this.disposed) return
    if (change.type === 'delete') {
      const key = rowKey(change.collection, change.id)
      const current = this.rows.get(key)
      // Ein veraltetes DELETE darf eine neuere Zeile mit derselben ID nicht
      // entfernen. `replica identity full` liefert die alte Revision mit.
      if (current && change.rev !== undefined && current.rev > change.rev) return
      if (!this.rows.delete(key)) return
      this.emit()
      return
    }

    const key = rowKey(change.row.collection, change.row.id)
    const current = this.rows.get(key)
    // Realtime kann ein älteres Update nach einem neueren lokalen Schreiben
    // zustellen. Die serverseitige Revision verhindert das Zurückrollen.
    if (current && change.row.rev <= current.rev) return
    this.rows.set(key, change.row)
    this.emit()
  }

  private async runUpsert<T>(
    collection: string,
    id: string,
    data: T,
    expectedRev: number,
  ): Promise<RecordRow<T>> {
    assertKey(collection, id)
    assertRecordData(data)
    return this.enqueue(async () => {
      this.assertReady()
      const payload: ApplyOpsPayload = {
        clear: [],
        upserts: [
          {
            collection,
            id,
            updated_at: updatedAtOf(data),
            data,
            expected_rev: expectedRev,
          },
        ],
        deletes: [],
      }
      try {
        const result = await this.backend.applyOps(payload)
        const applied = result.applied.find(
          (entry) => entry.collection === collection && entry.id === id,
        )
        if (!applied) {
          throw new CloudDataError('Supabase hat die Änderung nicht bestätigt.')
        }
        const row: RecordRow<T> = { collection, id, rev: applied.rev, data }
        this.rows.set(rowKey(collection, id), row)
        this.emit()
        return row
      } catch (cause) {
        if (cause instanceof CloudConflictError) {
          const current = await this.fetchCurrent(collection, id)
          throw new RecordConflictError(collection, id, current)
        }
        throw cause
      }
    })
  }

  private async fetchCurrent(
    collection: string,
    id: string,
  ): Promise<RecordRow | null> {
    try {
      const row = await this.backend.fetch(collection, id)
      const key = rowKey(collection, id)
      if (row) this.rows.set(key, row)
      else this.rows.delete(key)
      this.emit()
      return row
    } catch {
      return null
    }
  }

  private applyTransaction(payload: ApplyOpsPayload, result: ApplyOpsResult): void {
    for (const collection of payload.clear) {
      for (const [key, row] of this.rows) {
        if (row.collection === collection) this.rows.delete(key)
      }
    }

    const upserts = new Map(
      payload.upserts.map((entry) => [rowKey(entry.collection, entry.id), entry]),
    )
    for (const applied of result.applied) {
      const upsert = upserts.get(rowKey(applied.collection, applied.id))
      if (!upsert) continue
      this.rows.set(rowKey(applied.collection, applied.id), {
        collection: applied.collection,
        id: applied.id,
        rev: applied.rev,
        data: upsert.data,
      })
    }
    for (const deleted of result.deleted) {
      this.rows.delete(rowKey(deleted.collection, deleted.id))
    }
  }

  /** Nur für die Transaktion: liest ohne erneute Ready-Prüfung. */
  peek<T>(collection: string, id: string): RecordRow<T> | undefined {
    return this.rows.get(rowKey(collection, id)) as RecordRow<T> | undefined
  }

  /** Nur für die Transaktion: alle Zeilen einer Collection ohne Ready-Prüfung. */
  peekCollection<T>(collection: string): RecordRow<T>[] {
    const result: RecordRow<T>[] = []
    for (const row of this.rows.values()) {
      if (row.collection === collection) result.push(row as RecordRow<T>)
    }
    return result
  }

  private emit(): void {
    this.version += 1
    for (const listener of this.listeners) listener()
  }
}

/**
 * Gepufferte Sicht einer Transaktion. Mehrfache Änderungen an derselben Zeile
 * werden zusammengefasst; die erste erwartete Revision bleibt erhalten.
 */
export class RecordsTransaction {
  private readonly pending = new Map<string, PendingEntry>()
  private readonly cleared = new Set<string>()

  constructor(private readonly store: CloudRecordsStore) {}

  get<T>(collection: string, id: string): RecordRow<T> | undefined {
    assertKey(collection, id)
    const entry = this.pending.get(rowKey(collection, id))
    if (entry) {
      if (entry.deleted) return undefined
      return {
        collection,
        id,
        rev: entry.expectedRev,
        data: entry.data as T,
      }
    }
    if (this.cleared.has(collection)) return undefined
    return this.store.peek<T>(collection, id)
  }

  list<T>(collection: string): RecordRow<T>[] {
    const result = new Map<string, RecordRow<T>>()
    if (!this.cleared.has(collection)) {
      for (const row of this.store.peekCollection<T>(collection)) {
        result.set(row.id, row)
      }
    }
    for (const entry of this.pending.values()) {
      if (entry.collection !== collection) continue
      if (entry.deleted) {
        result.delete(entry.id)
      } else {
        result.set(entry.id, {
          collection,
          id: entry.id,
          rev: entry.expectedRev,
          data: entry.data as T,
        })
      }
    }
    return [...result.values()]
  }

  create<T>(collection: string, id: string, data: T): void {
    assertKey(collection, id)
    const current = this.get(collection, id)
    if (current) throw new RecordConflictError(collection, id, current)
    this.setPending(collection, id, data, 0)
  }

  /**
   * Replaces a row that this transaction created itself. Such a row has no
   * server revision yet, so a normal compare-and-swap update cannot address it.
   * Used only for merging two writes to the same new row within one batch.
   */
  updateCreated<T>(collection: string, id: string, data: T): void {
    assertKey(collection, id)
    const entry = this.pending.get(rowKey(collection, id))
    if (!entry || entry.deleted || entry.expectedRev !== 0) {
      throw new CloudDataError(
        'Die Zeile wurde in dieser Transaktion nicht neu angelegt.',
      )
    }
    assertRecordData(data)
    entry.data = data
  }

  update<T>(collection: string, id: string, data: T, expectedRev: number): void {
    assertKey(collection, id)
    if (!Number.isInteger(expectedRev) || expectedRev <= 0) {
      throw new CloudDataError('Für ein Update wird eine positive erwartete Revision benötigt.')
    }
    const current = this.get(collection, id)
    if (!current) throw new RecordConflictError(collection, id, null)
    if (current.rev !== expectedRev) {
      throw new RecordConflictError(collection, id, current)
    }
    this.setPending(collection, id, data, expectedRev)
  }

  remove(collection: string, id: string, expectedRev: number): void {
    assertKey(collection, id)
    if (!Number.isInteger(expectedRev) || expectedRev <= 0) {
      throw new CloudDataError('Für ein Löschen wird eine positive erwartete Revision benötigt.')
    }
    const current = this.get(collection, id)
    // Bereits weg: idempotent.
    if (!current) return
    if (current.rev !== expectedRev) {
      throw new RecordConflictError(collection, id, current)
    }
    const key = rowKey(collection, id)
    const entry = this.pending.get(key)
    // In dieser Transaktion angelegt und wieder entfernt: kein DB-Aufruf.
    if (entry && entry.expectedRev === 0) {
      this.pending.delete(key)
      return
    }
    this.setPending(collection, id, current.data, expectedRev, true)
  }

  clear(collection: string): void {
    if (!collection?.trim()) throw new CloudDataError('Collection muss gesetzt sein.')
    this.cleared.add(collection)
    for (const [key, entry] of this.pending) {
      if (entry.collection === collection) this.pending.delete(key)
    }
  }

  toPayload(): ApplyOpsPayload {
    const upserts: RecordUpsert[] = []
    const deletes: RecordDelete[] = []
    for (const entry of this.pending.values()) {
      if (entry.deleted) {
        deletes.push({
          collection: entry.collection,
          id: entry.id,
          expected_rev: entry.expectedRev,
        })
      } else {
        upserts.push({
          collection: entry.collection,
          id: entry.id,
          updated_at: updatedAtOf(entry.data),
          data: entry.data,
          expected_rev: entry.expectedRev,
        })
      }
    }
    return { clear: [...this.cleared], upserts, deletes }
  }

  private setPending(
    collection: string,
    id: string,
    data: unknown,
    expectedRev: number,
    deleted = false,
  ): void {
    if (!deleted) assertRecordData(data)
    this.pending.set(rowKey(collection, id), {
      collection,
      id,
      data,
      expectedRev,
      deleted,
    })
  }
}
