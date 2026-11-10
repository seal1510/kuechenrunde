/*
 * Küchenrunde – Supabase-Backend für den Records-Store
 * Copyright (C) 2026 openCook Web contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Dünne Übersetzung zwischen dem CloudRecordsStore und Supabase:
 *  * snapshot()  -> RPC public.snapshot()
 *  * applyOps()  -> RPC public.apply_ops(p_ops)
 *  * fetch()     -> PostgREST SELECT auf public.records
 *  * subscribe() -> Realtime postgres_changes auf public.records
 *
 * Enthält bewusst keine Fachlogik und keine Service-Role-Nutzung.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import {
  CloudConflictError,
  CloudDataError,
  CloudPermissionError,
} from '../data/cloudErrors'
import type {
  ApplyOpsPayload,
  ApplyOpsResult,
  RecordChange,
  RecordRow,
  RecordsBackend,
  RecordsSubscriptionHandlers,
} from '../data/cloudRecords'

const RECORDS_TABLE = 'records'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function mapError(error: { message?: string; code?: string }): Error {
  if (error.code === 'PT409') {
    return new CloudConflictError()
  }
  if (error.code === '42501') {
    return new CloudPermissionError()
  }
  return new CloudDataError(
    error.message || 'Die Cloud-Anfrage ist fehlgeschlagen.',
    error.code,
  )
}

export function parseRecordRow(value: unknown): RecordRow {
  if (!isRecord(value)) {
    throw new CloudDataError('Supabase hat einen ungültigen Datensatz geliefert.')
  }
  const collection = value.collection
  const id = value.id
  const rev = value.rev
  const data = value.data
  if (typeof collection !== 'string' || !collection.trim()) {
    throw new CloudDataError('Supabase-Datensatz ohne gültige Collection.')
  }
  if (typeof id !== 'string' || !id.trim()) {
    throw new CloudDataError('Supabase-Datensatz ohne gültige ID.')
  }
  if (typeof rev !== 'number' || !Number.isInteger(rev) || rev <= 0) {
    throw new CloudDataError('Supabase-Datensatz ohne gültige Revision.')
  }
  if (!isRecord(data)) {
    throw new CloudDataError('Supabase-Datensatz ohne gültiges Datenobjekt.')
  }
  return { collection, id, rev, data }
}

export function parseSnapshotRows(value: unknown): RecordRow[] {
  if (!Array.isArray(value)) {
    throw new CloudDataError('Der Cloud-Snapshot hat ein ungültiges Format.')
  }
  const rows = value.map(parseRecordRow)
  const seen = new Set<string>()
  for (const row of rows) {
    const key = `${row.collection}\u0000${row.id}`
    if (seen.has(key)) {
      throw new CloudDataError(
        `Doppelter Datensatz im Cloud-Snapshot: ${row.collection}/${row.id}.`,
      )
    }
    seen.add(key)
  }
  return rows
}

export function parseApplyResult(value: unknown): ApplyOpsResult {
  if (!isRecord(value)) {
    throw new CloudDataError('Supabase hat kein gültiges Schreibergebnis geliefert.')
  }
  if (!Array.isArray(value.applied) || !Array.isArray(value.deleted)) {
    throw new CloudDataError('Supabase hat kein gültiges Schreibergebnis geliefert.')
  }

  const applied = value.applied.map((entry): ApplyOpsResult['applied'][number] => {
    if (
      !isRecord(entry) ||
      typeof entry.collection !== 'string' ||
      typeof entry.id !== 'string' ||
      typeof entry.rev !== 'number' ||
      !Number.isInteger(entry.rev) ||
      entry.rev <= 0
    ) {
      throw new CloudDataError('Ungültiger Eintrag im Schreibeprotokoll von Supabase.')
    }
    return { collection: entry.collection, id: entry.id, rev: entry.rev }
  })

  const deleted = value.deleted.map((entry): ApplyOpsResult['deleted'][number] => {
    if (
      !isRecord(entry) ||
      typeof entry.collection !== 'string' ||
      typeof entry.id !== 'string'
    ) {
      throw new CloudDataError('Ungültiger Lösch-Eintrag im Schreibeprotokoll von Supabase.')
    }
    return { collection: entry.collection, id: entry.id }
  })

  return { applied, deleted }
}

/**
 * Übersetzt ein Realtime-postgres_changes-Payload in eine Store-Änderung.
 * DELETE benötigt `replica identity full`, damit `old` Collection und ID
 * enthält. Unbekannte oder unvollständige Payloads werden ignoriert.
 */
export function recordChangeFromRealtime(payload: unknown): RecordChange | null {
  if (!isRecord(payload)) return null
  const eventType = payload.eventType
  if (eventType === 'DELETE') {
    const old = payload.old
    if (!isRecord(old)) return null
    const collection = old.collection
    const id = old.id
    if (typeof collection !== 'string' || !collection.trim()) return null
    if (typeof id !== 'string' || !id.trim()) return null
    const rev =
      typeof old.rev === 'number' && Number.isInteger(old.rev) && old.rev > 0
        ? old.rev
        : undefined
    return { type: 'delete', collection, id, rev }
  }
  if (eventType === 'INSERT' || eventType === 'UPDATE') {
    try {
      return { type: 'upsert', row: parseRecordRow(payload.new) }
    } catch {
      return null
    }
  }
  return null
}

async function snapshotRequest(client: SupabaseClient): Promise<RecordRow[]> {
  try {
    const { data, error } = await client.rpc('snapshot')
    if (error) throw mapError(error)
    return parseSnapshotRows(data)
  } catch (cause) {
    if (cause instanceof CloudDataError) throw cause
    throw new CloudDataError('Der Cloud-Snapshot konnte nicht geladen werden.')
  }
}

async function applyOpsRequest(
  client: SupabaseClient,
  payload: ApplyOpsPayload,
): Promise<ApplyOpsResult> {
  try {
    const { data, error } = await client.rpc('apply_ops', { p_ops: payload })
    if (error) throw mapError(error)
    return parseApplyResult(data)
  } catch (cause) {
    if (cause instanceof CloudDataError) throw cause
    throw new CloudDataError('Die Cloud-Änderung konnte nicht gespeichert werden.')
  }
}

async function fetchRequest(
  client: SupabaseClient,
  collection: string,
  id: string,
): Promise<RecordRow | null> {
  try {
    const { data, error } = await client
      .from(RECORDS_TABLE)
      .select('collection,id,rev,data')
      .eq('collection', collection)
      .eq('id', id)
      .maybeSingle()
    if (error) throw mapError(error)
    if (data == null) return null
    return parseRecordRow(data)
  } catch (cause) {
    if (cause instanceof CloudDataError) throw cause
    throw new CloudDataError('Der Datensatz konnte nicht geladen werden.')
  }
}

function channelName(): string {
  const uuid = globalThis.crypto?.randomUUID?.()
  return `kuechenrunde-records-${uuid ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`}`
}

function subscribeRequest(
  client: SupabaseClient,
  handlers: RecordsSubscriptionHandlers,
): () => void {
  try {
    const channel = client
      .channel(channelName())
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: RECORDS_TABLE },
        (payload) => {
          const change = recordChangeFromRealtime(payload)
          if (change) handlers.onChange(change)
        },
      )
      .subscribe((status) => handlers.onStatus?.(status))

    return () => {
      void client.removeChannel(channel)
    }
  } catch {
    // Ohne Realtime bleibt der Snapshot nutzbar; der Store lädt bei der
    // nächsten Gelegenheit vollständig nach.
    handlers.onStatus?.('CHANNEL_ERROR')
    return () => {}
  }
}

export function createSupabaseRecordsBackend(client: SupabaseClient): RecordsBackend {
  return {
    snapshot: () => snapshotRequest(client),
    applyOps: (payload) => applyOpsRequest(client, payload),
    fetch: (collection, id) => fetchRequest(client, collection, id),
    subscribe: (handlers) => subscribeRequest(client, handlers),
  }
}
