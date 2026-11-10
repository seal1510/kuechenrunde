import { beforeEach, describe, expect, it } from 'vitest'
import { CloudConflictError, CloudNotLoadedError } from './cloudErrors'
import {
  CloudRecordsStore,
  RecordConflictError,
  type ApplyOpsPayload,
  type ApplyOpsResult,
  type RecordChange,
  type RecordRow,
  type RecordsBackend,
  type RecordsSubscriptionHandlers,
} from './cloudRecords'

const COLLECTION = 'recipes'

function key(collection: string, id: string): string {
  return `${collection}\u0000${id}`
}

/**
 * In-Memory-Testbackend. Es bildet die CAS-Semantik von apply_ops nach:
 * erst alle Prüfungen, dann atomar übernehmen. Kein Simulator, sondern ein
 * Test-Double für die Store-Logik.
 */
class TestBackend implements RecordsBackend {
  readonly rows = new Map<string, RecordRow>()
  readonly calls: ApplyOpsPayload[] = []
  snapshotCalls = 0
  failNext: Error | null = null
  private handlers: RecordsSubscriptionHandlers | null = null

  async snapshot(): Promise<RecordRow[]> {
    this.snapshotCalls += 1
    return [...this.rows.values()].map((row) => structuredClone(row))
  }

  async fetch(collection: string, id: string): Promise<RecordRow | null> {
    const row = this.rows.get(key(collection, id))
    return row ? structuredClone(row) : null
  }

  async applyOps(payload: ApplyOpsPayload): Promise<ApplyOpsResult> {
    this.calls.push(structuredClone(payload))
    if (this.failNext) {
      const error = this.failNext
      this.failNext = null
      throw error
    }

    const next = new Map(this.rows)
    const applied: ApplyOpsResult['applied'] = []
    const deleted: ApplyOpsResult['deleted'] = []

    for (const collection of payload.clear) {
      for (const [entryKey, row] of next) {
        if (row.collection === collection) next.delete(entryKey)
      }
    }

    for (const upsert of payload.upserts) {
      const entryKey = key(upsert.collection, upsert.id)
      const current = next.get(entryKey)
      if (upsert.expected_rev === 0) {
        if (current) throw new CloudConflictError()
        next.set(entryKey, {
          collection: upsert.collection,
          id: upsert.id,
          rev: 1,
          data: structuredClone(upsert.data),
        })
        applied.push({ collection: upsert.collection, id: upsert.id, rev: 1 })
        continue
      }

      if (!current || current.rev !== upsert.expected_rev) {
        throw new CloudConflictError()
      }
      const rev = current.rev + 1
      next.set(entryKey, {
        collection: upsert.collection,
        id: upsert.id,
        rev,
        data: structuredClone(upsert.data),
      })
      applied.push({ collection: upsert.collection, id: upsert.id, rev })
    }

    for (const remove of payload.deletes) {
      const entryKey = key(remove.collection, remove.id)
      const current = next.get(entryKey)
      if (!current) continue
      if (remove.expected_rev !== null && current.rev !== remove.expected_rev) {
        throw new CloudConflictError()
      }
      next.delete(entryKey)
      deleted.push({ collection: remove.collection, id: remove.id })
    }

    this.rows.clear()
    for (const [entryKey, row] of next) this.rows.set(entryKey, row)
    return { applied, deleted }
  }

  subscribe(handlers: RecordsSubscriptionHandlers): () => void {
    this.handlers = handlers
    return () => {
      this.handlers = null
    }
  }

  emit(change: RecordChange): void {
    this.handlers?.onChange(change)
  }

  emitStatus(status: string): void {
    this.handlers?.onStatus?.(status)
  }

  seed(collection: string, id: string, data: unknown, rev: number): void {
    this.rows.set(key(collection, id), {
      collection,
      id,
      rev,
      data: structuredClone(data),
    })
  }

  /** Simuliert ein direktes Schreiben eines anderen Clients ohne Realtime. */
  writeDirect(collection: string, id: string, data: unknown): number {
    const current = this.rows.get(key(collection, id))
    const rev = (current?.rev ?? 0) + 1
    this.rows.set(key(collection, id), {
      collection,
      id,
      rev,
      data: structuredClone(data),
    })
    return rev
  }

  row(collection: string, id: string): RecordRow | undefined {
    return this.rows.get(key(collection, id))
  }
}

describe('CloudRecordsStore', () => {
  let backend: TestBackend
  let store: CloudRecordsStore

  beforeEach(async () => {
    backend = new TestBackend()
    backend.seed(COLLECTION, 'r1', { id: 'r1', title: 'Alt', updatedAt: 1 }, 3)
    store = new CloudRecordsStore(backend)
    await store.load()
  })

  it('lädt den Snapshot und liest Zeilen über get/list', () => {
    expect(store.isLoaded()).toBe(true)
    expect(store.get<{ title: string }>(COLLECTION, 'r1')?.data.title).toBe('Alt')
    expect(store.get(COLLECTION, 'r1')?.rev).toBe(3)
    expect(store.list(COLLECTION)).toHaveLength(1)
    expect(store.collections()).toEqual([COLLECTION])
  })

  it('verweigert Zugriffe vor dem Laden', () => {
    const fresh = new CloudRecordsStore(backend)
    expect(() => fresh.get(COLLECTION, 'r1')).toThrow(CloudNotLoadedError)
    expect(() => fresh.list(COLLECTION)).toThrow(CloudNotLoadedError)
  })

  it('legt an, behält die ID und übernimmt die Serverrevision', async () => {
    const row = await store.create(COLLECTION, 'r2', {
      id: 'r2',
      title: 'Neu',
      updatedAt: 2,
    })

    expect(row.id).toBe('r2')
    expect(row.rev).toBe(1)
    expect(backend.calls).toHaveLength(1)
    expect(backend.calls[0]?.upserts[0]).toMatchObject({
      collection: COLLECTION,
      id: 'r2',
      expected_rev: 0,
    })
    expect(store.get(COLLECTION, 'r2')?.data).toMatchObject({ title: 'Neu' })
  })

  it('meldet einen Konflikt beim Anlegen einer bereits vorhandenen ID', async () => {
    await expect(
      store.create(COLLECTION, 'r1', { id: 'r1', title: 'Doppelt', updatedAt: 2 }),
    ).rejects.toBeInstanceOf(RecordConflictError)

    await expect(
      store.create(COLLECTION, 'r1', { id: 'r1', title: 'Doppelt', updatedAt: 2 }),
    ).rejects.toMatchObject({ current: { rev: 3 } })
  })

  it('aktualisiert nur mit passender Revision', async () => {
    const updated = await store.update(
      COLLECTION,
      'r1',
      { id: 'r1', title: 'Neu', updatedAt: 2 },
      3,
    )
    expect(updated.rev).toBe(4)
    expect(backend.calls[0]?.upserts[0]?.expected_rev).toBe(3)

    await expect(
      store.update(COLLECTION, 'r1', { id: 'r1', title: 'Veraltet', updatedAt: 3 }, 3),
    ).rejects.toMatchObject({ current: { rev: 4 } })
  })

  it('verhindert stilles Überschreiben bei konkurrierenden Stores', async () => {
    const other = new CloudRecordsStore(backend)
    await other.load()

    await store.update(
      COLLECTION,
      'r1',
      { id: 'r1', title: 'Von A', updatedAt: 2 },
      3,
    )

    const conflict = await other
      .update(COLLECTION, 'r1', { id: 'r1', title: 'Von B', updatedAt: 3 }, 3)
      .catch((error: unknown) => error)

    expect(conflict).toBeInstanceOf(RecordConflictError)
    expect((conflict as RecordConflictError).current?.data).toMatchObject({
      title: 'Von A',
    })
    expect(backend.row(COLLECTION, 'r1')?.data).toMatchObject({ title: 'Von A' })
    // Der zweite Store hat den aktuellen Stand nachgeladen.
    expect(other.get(COLLECTION, 'r1')?.data).toMatchObject({ title: 'Von A' })
  })

  it('löscht nur mit passender Revision und ist bei fehlender Zeile idempotent', async () => {
    await store.remove(COLLECTION, 'r1', 3)
    expect(store.get(COLLECTION, 'r1')).toBeUndefined()

    await expect(store.remove(COLLECTION, 'r1', 3)).resolves.toBeUndefined()
  })

  it('meldet einen Löschkonflikt, wenn zwischenzeitlich geändert wurde', async () => {
    const other = new CloudRecordsStore(backend)
    await other.load()
    backend.writeDirect(COLLECTION, 'r1', { id: 'r1', title: 'Fremd', updatedAt: 4 })

    await expect(other.remove(COLLECTION, 'r1', 3)).rejects.toBeInstanceOf(
      RecordConflictError,
    )
    expect(backend.row(COLLECTION, 'r1')?.data).toMatchObject({ title: 'Fremd' })
  })

  it('führt mehrere Schreibvorgänge in genau einem atomaren Aufruf aus', async () => {
    const result = await store.transaction(async (tx) => {
      expect(tx.get(COLLECTION, 'r1')?.rev).toBe(3)
      tx.update(COLLECTION, 'r1', { id: 'r1', title: 'A', updatedAt: 2 }, 3)
      tx.create(COLLECTION, 'r2', { id: 'r2', title: 'B', updatedAt: 2 })
      expect(tx.get(COLLECTION, 'r2')?.rev).toBe(0)
      expect(tx.list(COLLECTION)).toHaveLength(2)
      return 'fertig'
    })

    expect(result).toBe('fertig')
    expect(backend.calls).toHaveLength(1)
    expect(backend.calls[0]?.upserts).toHaveLength(2)
    expect(backend.calls[0]?.deletes).toHaveLength(0)
    expect(store.get(COLLECTION, 'r1')?.data).toMatchObject({ title: 'A' })
    expect(store.get(COLLECTION, 'r2')?.rev).toBe(1)
  })

  it('ersetzt eine in derselben Transaktion neu angelegte Zeile ohne Revision', async () => {
    await store.transaction(async (tx) => {
      tx.create(COLLECTION, 'r2', { id: 'r2', title: 'Erst', updatedAt: 2 })
      tx.updateCreated(COLLECTION, 'r2', {
        id: 'r2',
        title: 'Dann',
        updatedAt: 3,
      })
      expect(tx.get<{ title: string }>(COLLECTION, 'r2')?.data.title).toBe('Dann')
    })

    expect(backend.calls).toHaveLength(1)
    expect(backend.calls[0]?.upserts).toHaveLength(1)
    expect(backend.calls[0]?.upserts[0]?.data).toMatchObject({ title: 'Dann' })
    expect(store.get<{ title: string }>(COLLECTION, 'r2')?.data.title).toBe('Dann')
  })

  it('ersetzt eine Collection innerhalb einer Transaktion', async () => {
    await store.transaction(async (tx) => {
      tx.clear(COLLECTION)
      tx.create(COLLECTION, 'r9', { id: 'r9', title: 'Neu', updatedAt: 5 })
    })

    expect(store.list(COLLECTION).map((row) => row.id)).toEqual(['r9'])
    expect(backend.calls[0]?.clear).toEqual([COLLECTION])
  })

  it('verwirft eine Transaktion bei Konflikt vollständig und lädt neu', async () => {
    backend.writeDirect(COLLECTION, 'r1', { id: 'r1', title: 'Fremd', updatedAt: 4 })

    await expect(
      store.transaction(async (tx) => {
        tx.update(COLLECTION, 'r1', { id: 'r1', title: 'Meins', updatedAt: 2 }, 3)
      }),
    ).rejects.toBeInstanceOf(CloudConflictError)

    expect(store.get(COLLECTION, 'r1')?.data).toMatchObject({ title: 'Fremd' })
    expect(store.get(COLLECTION, 'r1')?.rev).toBe(4)
  })

  it('lädt nach einem Fehler den Snapshot neu und behält den Fehler', async () => {
    backend.failNext = new Error('offline')
    await expect(
      store.transaction(async (tx) => {
        tx.create(COLLECTION, 'r3', { id: 'r3', title: 'X', updatedAt: 2 })
      }),
    ).rejects.toThrow('offline')

    expect(store.get(COLLECTION, 'r3')).toBeUndefined()
    expect(store.isLoaded()).toBe(true)
  })

  it('wendet neuere Realtime-Updates an, ignoriert ältere und löscht', () => {
    const versions: number[] = []
    const unsubscribe = store.subscribe(() => versions.push(store.getVersion()))

    backend.emit({
      type: 'upsert',
      row: {
        collection: COLLECTION,
        id: 'r1',
        rev: 5,
        data: { id: 'r1', title: 'Remote', updatedAt: 5 },
      },
    })
    expect(store.get(COLLECTION, 'r1')?.data).toMatchObject({ title: 'Remote' })

    backend.emit({
      type: 'upsert',
      row: {
        collection: COLLECTION,
        id: 'r1',
        rev: 4,
        data: { id: 'r1', title: 'Veraltet', updatedAt: 4 },
      },
    })
    expect(store.get(COLLECTION, 'r1')?.data).toMatchObject({ title: 'Remote' })

    backend.emit({ type: 'delete', collection: COLLECTION, id: 'r1', rev: 4 })
    expect(store.get(COLLECTION, 'r1')?.data).toMatchObject({ title: 'Remote' })

    backend.emit({ type: 'delete', collection: COLLECTION, id: 'r1', rev: 5 })
    expect(store.get(COLLECTION, 'r1')).toBeUndefined()

    expect(versions).toHaveLength(2)
    unsubscribe()
  })

  it('lehnt Daten ab, die keine JSON-Objekte sind', async () => {
    await expect(
      store.create(COLLECTION, 'r10', [1, 2, 3] as unknown as Record<string, unknown>),
    ).rejects.toThrow(/JSON-Objekte/)
  })

  it('benachrichtigt Abonnenten und lädt nach Reconnect neu', async () => {
    let notifications = 0
    const unsubscribe = store.subscribe(() => {
      notifications += 1
    })

    await store.create(COLLECTION, 'r4', { id: 'r4', title: 'X', updatedAt: 2 })
    expect(notifications).toBe(1)
    unsubscribe()

    backend.seed(COLLECTION, 'r5', { id: 'r5', title: 'Verpasst', updatedAt: 2 }, 1)
    backend.emitStatus('CHANNEL_ERROR')
    backend.emitStatus('SUBSCRIBED')
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(store.get(COLLECTION, 'r5')?.data).toMatchObject({ title: 'Verpasst' })
  })
})
