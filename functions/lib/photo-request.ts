/*
 * Küchenrunde – Anfrage-Body der Foto-Erkennung
 * Copyright (C) 2026 openCook Web contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Fotos werden als Base64 in JSON übertragen und sind deshalb deutlich größer
 * als die übrigen Import-Anfragen. Der Body wird mit einer harten Obergrenze
 * gelesen: zuerst gegen den (potenziell falschen) Content-Length-Header, dann
 * während des Streamens. Ein unangemeldeter Aufruf erreicht diese Grenze nie,
 * weil die Function vor dem Lesen authentifiziert.
 *
 * Keine Node-APIs: Web-Streams und TextDecoder aus der Workers-Runtime.
 */

import {
  PHOTO_OCR_ERROR_MESSAGES,
  PHOTO_OCR_MAX_REQUEST_BYTES,
} from '../../src/import/photo-ocr'
import { HttpError } from './http'

/** Für Tests und Dokumentation sichtbar; entspricht dem Vertrag. */
export const MAX_PHOTO_REQUEST_BYTES = PHOTO_OCR_MAX_REQUEST_BYTES

/** Content-Type muss JSON sein; Parameter wie charset sind erlaubt. */
export function isJsonContentType(request: Request): boolean {
  const value = (request.headers.get('content-type') ?? '').trim().toLowerCase()
  return value.startsWith('application/json')
}

function tooLarge(): HttpError {
  return new HttpError(413, 'too-large', PHOTO_OCR_ERROR_MESSAGES['too-large'])
}

function invalid(message = PHOTO_OCR_ERROR_MESSAGES['invalid-request']): HttpError {
  return new HttpError(400, 'invalid-request', message)
}

function concatBytes(chunks: readonly Uint8Array[], total: number): Uint8Array {
  const result = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.byteLength
  }
  return result
}

/**
 * Liest den JSON-Body mit hartem 12-MiB-Limit. Der Content-Length-Header wird
 * nur als schnelle Vorprüfung verwendet; verbindlich ist die Summe der
 * tatsächlich gelesenen Bytes.
 */
export async function readPhotoJsonBody(request: Request): Promise<Record<string, unknown>> {
  const declared = Number(request.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > MAX_PHOTO_REQUEST_BYTES) {
    throw tooLarge()
  }
  const body = request.body
  if (!body) throw invalid()

  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue
      total += value.byteLength
      if (total > MAX_PHOTO_REQUEST_BYTES) {
        try {
          await reader.cancel()
        } catch {
          // Das Größenlimit gilt auch, wenn das Abbrechen des Streams scheitert.
        }
        throw tooLarge()
      }
      chunks.push(value)
    }
  } catch (error) {
    if (error instanceof HttpError) throw error
    throw invalid('Die Anfrage konnte nicht gelesen werden.')
  }
  if (total === 0) throw invalid()

  let parsed: unknown
  try {
    parsed = JSON.parse(new TextDecoder().decode(concatBytes(chunks, total))) as unknown
  } catch {
    throw invalid()
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw invalid()
  }
  return parsed as Record<string, unknown>
}
