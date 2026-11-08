/*
 * openCook Web
 * Copyright (C) 2026 openCook Web contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Minimal ZIP reader for Mela archives. Mela (and macOS Archive Utility) writes
 * ZIP64 size fields even for small files: the classic size fields contain
 * 0xFFFFFFFF and the real sizes live in the ZIP64 extra field. fflate's
 * `unzipSync` mis-handles that layout, so this reader parses the central
 * directory (including ZIP64 extras) and decompresses only the requested entry.
 */

import { inflateSync } from 'fflate'

const EOCD = 0x06054b50
const ZIP64_EOCD = 0x06064b50
const ZIP64_LOCATOR = 0x07064b50
const CENTRAL = 0x02014b50
const LOCAL = 0x04034b50
const SENTINEL_16 = 0xffff
const SENTINEL_32 = 0xffffffff

export interface ZipEntryMeta {
  name: string
  compression: number
  compressedSize: number
  uncompressedSize: number
  localHeaderOffset: number
  dataOffset: number
  encrypted: boolean
}

export function listZipEntries(bytes: Uint8Array): ZipEntryMeta[] {
  if (bytes.byteLength < 22) throw new Error('ZIP ist zu klein.')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const eocd = findEocd(view)
  if (eocd < 0) throw new Error('ZIP-Zentralverzeichnis nicht gefunden.')

  let entriesTotal = view.getUint16(eocd + 10, true)
  let centralSize = view.getUint32(eocd + 12, true)
  let centralOffset = view.getUint32(eocd + 16, true)

  if (
    entriesTotal === SENTINEL_16 ||
    centralSize === SENTINEL_32 ||
    centralOffset === SENTINEL_32
  ) {
    const locator = eocd - 20
    if (locator < 0 || view.getUint32(locator, true) !== ZIP64_LOCATOR) {
      throw new Error('ZIP64-Verzeichnis nicht gefunden.')
    }
    const zip64Offset = readU64(view, locator + 8)
    if (zip64Offset + 56 > bytes.byteLength || view.getUint32(zip64Offset, true) !== ZIP64_EOCD) {
      throw new Error('ZIP64-Endverzeichnis ist ungültig.')
    }
    entriesTotal = readU64(view, zip64Offset + 32)
    centralSize = readU64(view, zip64Offset + 40)
    centralOffset = readU64(view, zip64Offset + 48)
  }

  if (centralOffset + centralSize > bytes.byteLength) {
    throw new Error('ZIP-Zentralverzeichnis liegt außerhalb der Datei.')
  }

  const entries: ZipEntryMeta[] = []
  let offset = centralOffset
  for (let index = 0; index < entriesTotal; index += 1) {
    if (offset + 46 > bytes.byteLength || view.getUint32(offset, true) !== CENTRAL) {
      throw new Error('ZIP-Zentralverzeichnis ist beschädigt.')
    }
    const flags = view.getUint16(offset + 8, true)
    const compression = view.getUint16(offset + 10, true)
    let compressedSize = view.getUint32(offset + 20, true)
    let uncompressedSize = view.getUint32(offset + 24, true)
    const nameLength = view.getUint16(offset + 28, true)
    const extraLength = view.getUint16(offset + 30, true)
    const commentLength = view.getUint16(offset + 32, true)
    let localHeaderOffset = view.getUint32(offset + 42, true)
    const nameStart = offset + 46
    const extraStart = nameStart + nameLength
    const next = extraStart + extraLength + commentLength
    if (next > bytes.byteLength) throw new Error('ZIP-Eintrag liegt außerhalb der Datei.')

    const nameBytes = bytes.subarray(nameStart, nameStart + nameLength)
    const name = decodeName(nameBytes, (flags & 0x800) !== 0)
    const extra = bytes.subarray(extraStart, extraStart + extraLength)

    if (
      compressedSize === SENTINEL_32 ||
      uncompressedSize === SENTINEL_32 ||
      localHeaderOffset === SENTINEL_32
    ) {
      const zip64 = readZip64Extra(
        extra,
        uncompressedSize === SENTINEL_32,
        compressedSize === SENTINEL_32,
        localHeaderOffset === SENTINEL_32,
      )
      if (uncompressedSize === SENTINEL_32) {
        if (zip64.uncompressedSize === null) throw new Error('ZIP64-Größe fehlt.')
        uncompressedSize = zip64.uncompressedSize
      }
      if (compressedSize === SENTINEL_32) {
        if (zip64.compressedSize === null) throw new Error('ZIP64-Packgröße fehlt.')
        compressedSize = zip64.compressedSize
      }
      if (localHeaderOffset === SENTINEL_32) {
        if (zip64.localHeaderOffset === null) throw new Error('ZIP64-Offset fehlt.')
        localHeaderOffset = zip64.localHeaderOffset
      }
    }

    if (localHeaderOffset + 30 > bytes.byteLength || view.getUint32(localHeaderOffset, true) !== LOCAL) {
      throw new Error('Lokaler ZIP-Header ist beschädigt.')
    }
    const localNameLength = view.getUint16(localHeaderOffset + 26, true)
    const localExtraLength = view.getUint16(localHeaderOffset + 28, true)
    const dataOffset = localHeaderOffset + 30 + localNameLength + localExtraLength
    if (dataOffset + compressedSize > bytes.byteLength) {
      throw new Error('ZIP-Daten liegen außerhalb der Datei.')
    }

    entries.push({
      name,
      compression,
      compressedSize,
      uncompressedSize,
      localHeaderOffset,
      dataOffset,
      encrypted: (flags & 0x1) !== 0,
    })
    offset = next
  }
  return entries
}

export function readZipEntry(bytes: Uint8Array, entry: ZipEntryMeta): Uint8Array {
  if (entry.encrypted) throw new Error('Verschlüsselte ZIP-Einträge werden nicht unterstützt.')
  const compressed = bytes.subarray(entry.dataOffset, entry.dataOffset + entry.compressedSize)
  let data: Uint8Array
  if (entry.compression === 0) {
    data = compressed
  } else if (entry.compression === 8) {
    data = inflateSync(compressed)
  } else {
    throw new Error(`Nicht unterstützte ZIP-Kompression: ${entry.compression}.`)
  }
  if (data.byteLength !== entry.uncompressedSize) {
    throw new Error('ZIP-Eintrag hat eine unerwartete Größe.')
  }
  return data
}

function findEocd(view: DataView): number {
  const min = Math.max(0, view.byteLength - 65_557)
  for (let offset = view.byteLength - 22; offset >= min; offset -= 1) {
    if (view.getUint32(offset, true) === EOCD) return offset
  }
  return -1
}

function readZip64Extra(
  extra: Uint8Array,
  needUncompressed: boolean,
  needCompressed: boolean,
  needOffset: boolean,
): {
  uncompressedSize: number | null
  compressedSize: number | null
  localHeaderOffset: number | null
} {
  let offset = 0
  while (offset + 4 <= extra.byteLength) {
    const id = extra[offset]! | (extra[offset + 1]! << 8)
    const length = extra[offset + 2]! | (extra[offset + 3]! << 8)
    const dataStart = offset + 4
    if (dataStart + length > extra.byteLength) break
    if (id === 0x0001) {
      let cursor = dataStart
      const end = dataStart + length
      let uncompressedSize: number | null = null
      let compressedSize: number | null = null
      let localHeaderOffset: number | null = null
      // The extra field stores only the values whose classic field was 0xFFFFFFFF,
      // in the fixed order: uncompressed size, compressed size, local offset.
      if (needUncompressed) {
        if (cursor + 8 > end) break
        uncompressedSize = readU64FromBytes(extra, cursor)
        cursor += 8
      }
      if (needCompressed) {
        if (cursor + 8 > end) break
        compressedSize = readU64FromBytes(extra, cursor)
        cursor += 8
      }
      if (needOffset) {
        if (cursor + 8 > end) break
        localHeaderOffset = readU64FromBytes(extra, cursor)
      }
      return { uncompressedSize, compressedSize, localHeaderOffset }
    }
    offset = dataStart + length
  }
  return { uncompressedSize: null, compressedSize: null, localHeaderOffset: null }
}

function readU64(view: DataView, offset: number): number {
  return Number(view.getBigUint64(offset, true))
}

function readU64FromBytes(bytes: Uint8Array, offset: number): number {
  let value = 0n
  for (let index = 7; index >= 0; index -= 1) {
    value = (value << 8n) | BigInt(bytes[offset + index] ?? 0)
  }
  return Number(value)
}

function decodeName(bytes: Uint8Array, utf8: boolean): string {
  if (utf8) return new TextDecoder('utf-8').decode(bytes)
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return Array.from(bytes, (byte) => String.fromCharCode(byte)).join('')
  }
}
