/*
 * Küchenrunde – Test-Double für den CloudRecordsStore
 * Copyright (C) 2026 openCook Web contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Nur für Tests: bildet snapshot, CAS-Updates und atomare apply_ops in einer
 * Map nach. Kein Simulator und kein Produktionscode.
 */

import {
  CloudRecordsStore,
  type ApplyOpsPayload,
  type ApplyOpsResult,
  type RecordChange,
  type RecordRow,
  type RecordsBackend,
  type RecordsSubscriptionHandlers,
} from '../data/cloudRecords'
import { CloudConflictError } from '../data/cloudErrors'

function key(collection: string, id: string): string {
  return `${collection}\u0000${id}`
}

export class TestRecordsBackend implements RecordsBackend {
  readonly rows = new Map<string, RecordRow>()
  readonly calls: ApplyOpsPayload[] = []
  failNext: Error | null = null
  private handlers: RecordsSubscriptionHandlers | null = null

  async snapshot(): Promise<RecordRow[]> {
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
      if (this.handlers === handlers) this.handlers = null
    }
  }

  emit(change: RecordChange): void {
    this.handlers?.onChange(change)
  }

  seed(collection: string, id: string, data: unknown, rev = 1): void {
    this.rows.set(key(collection, id), {
      collection,
      id,
      rev,
      data: structuredClone(data),
    })
  }

  row<T = unknown>(collection: string, id: string): RecordRow<T> | undefined {
    return this.rows.get(key(collection, id)) as RecordRow<T> | undefined
  }
}

export async function createTestStore(
  backend: TestRecordsBackend,
  seed: Array<[string, string, unknown]> = [],
): Promise<CloudRecordsStore> {
  for (const [collection, id, data] of seed) backend.seed(collection, id, data)
  const store = new CloudRecordsStore(backend)
  await store.load()
  return store
}
