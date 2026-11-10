import { describe, expect, it } from 'vitest'
import { CloudDataError } from '../data/cloudErrors'
import {
  parseApplyResult,
  parseRecordRow,
  parseSnapshotRows,
  recordChangeFromRealtime,
} from './recordsBackend'

const row = {
  collection: 'recipes',
  id: 'r1',
  rev: 2,
  data: { id: 'r1', title: 'Test' },
}

describe('parseRecordRow', () => {
  it('akzeptiert einen gültigen Datensatz', () => {
    expect(parseRecordRow(row)).toEqual(row)
  })

  it('lehnt fehlende oder ungültige Felder ab', () => {
    for (const value of [
      null,
      {},
      { ...row, collection: '' },
      { ...row, id: '' },
      { ...row, rev: 0 },
      { ...row, rev: 1.5 },
      { ...row, data: null },
      { ...row, data: [] },
    ]) {
      expect(() => parseRecordRow(value)).toThrow(CloudDataError)
    }
  })
})

describe('parseSnapshotRows', () => {
  it('akzeptiert eine Liste und lehnt Duplikate ab', () => {
    expect(parseSnapshotRows([row])).toEqual([row])
    expect(() => parseSnapshotRows([row, { ...row }])).toThrow(/Doppelter/)
  })

  it('lehnt ein falsches Format ab', () => {
    expect(() => parseSnapshotRows(null)).toThrow(CloudDataError)
    expect(() => parseSnapshotRows({})).toThrow(CloudDataError)
  })
})

describe('parseApplyResult', () => {
  it('akzeptiert das erwartete Ergebnis', () => {
    expect(
      parseApplyResult({
        applied: [{ collection: 'recipes', id: 'r1', rev: 2 }],
        deleted: [{ collection: 'recipes', id: 'r0' }],
      }),
    ).toEqual({
      applied: [{ collection: 'recipes', id: 'r1', rev: 2 }],
      deleted: [{ collection: 'recipes', id: 'r0' }],
    })
  })

  it('lehnt unvollständige Ergebnisse ab', () => {
    for (const value of [
      null,
      {},
      { applied: [], deleted: null },
      { applied: [{ collection: 'recipes', id: 'r1', rev: 0 }], deleted: [] },
      { applied: [], deleted: [{}] },
    ]) {
      expect(() => parseApplyResult(value)).toThrow(CloudDataError)
    }
  })
})

describe('recordChangeFromRealtime', () => {
  it('übersetzt INSERT/UPDATE und DELETE', () => {
    expect(recordChangeFromRealtime({ eventType: 'INSERT', new: row })).toEqual({
      type: 'upsert',
      row,
    })
    expect(recordChangeFromRealtime({ eventType: 'UPDATE', new: row })).toEqual({
      type: 'upsert',
      row,
    })
    expect(
      recordChangeFromRealtime({
        eventType: 'DELETE',
        old: { collection: 'recipes', id: 'r1', rev: 4 },
      }),
    ).toEqual({ type: 'delete', collection: 'recipes', id: 'r1', rev: 4 })
    expect(
      recordChangeFromRealtime({
        eventType: 'DELETE',
        old: { collection: 'recipes', id: 'r1' },
      }),
    ).toEqual({ type: 'delete', collection: 'recipes', id: 'r1', rev: undefined })
  })

  it('ignoriert unbekannte oder unvollständige Payloads', () => {
    expect(recordChangeFromRealtime(null)).toBeNull()
    expect(recordChangeFromRealtime({ eventType: 'DELETE', old: {} })).toBeNull()
    expect(recordChangeFromRealtime({ eventType: 'UPDATE', new: { ...row, rev: 0 } })).toBeNull()
    expect(recordChangeFromRealtime({ eventType: 'OTHER', new: row })).toBeNull()
  })
})
