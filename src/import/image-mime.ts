/*
 * openCook Web
 * Copyright (C) 2026 openCook Web contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Pure image signature detection shared by the Mela importer, the URL importer
 * and the local fetch service. No DOM, React, Dexie or network access.
 */

export function sniffImageMime(bytes: Uint8Array): string | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg'
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return 'image/png'
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return 'image/webp'
  }
  if (
    bytes.length >= 6 &&
    bytes[0] === 0x47 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x38
  ) {
    return 'image/gif'
  }
  // Mela exports can carry HEIC/HEIF images. The bytes are preserved as-is; the
  // MIME type matters for the object URL and later backup/export.
  if (
    bytes.length >= 12 &&
    bytes[4] === 0x66 &&
    bytes[5] === 0x74 &&
    bytes[6] === 0x79 &&
    bytes[7] === 0x70
  ) {
    const brand = String.fromCharCode(bytes[8] ?? 0, bytes[9] ?? 0, bytes[10] ?? 0, bytes[11] ?? 0)
    if (['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'mif1', 'msf1'].includes(brand)) {
      return brand === 'mif1' || brand === 'msf1' ? 'image/heif' : 'image/heic'
    }
    if (['avif', 'avis'].includes(brand)) return 'image/avif'
  }
  return null
}

/** MIME types the URL image importer may store locally. SVG is deliberately excluded. */
export const SAFE_REMOTE_IMAGE_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/avif',
])

/**
 * Bucket limit for `recipe-images` (10 MiB). The bucket enforces the same
 * value; the editor checks it before reading the whole file into memory.
 */
export const MAX_RECIPE_IMAGE_BYTES = 10 * 1024 * 1024

/**
 * MIME types accepted by the private `recipe-images` bucket. Must stay in sync
 * with `allowed_mime_types` in the Supabase migration.
 */
export const CLOUD_RECIPE_IMAGE_MIME_TYPES = [...SAFE_REMOTE_IMAGE_MIME_TYPES]
