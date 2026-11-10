/*
 * Küchenrunde – expliziter Datenmodus
 * Copyright (C) 2026 openCook Web contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Die bloße Existenz von VITE_SUPABASE_* darf die App niemals in den
 * Cloud-Modus schalten. Das passiert ausschließlich über VITE_DATA_MODE=cloud.
 * Ohne gesetzten Wert bleibt Küchenrunde lokal.
 */

export type DataMode = 'local' | 'cloud'

export class DataModeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DataModeError'
  }
}

export function parseDataMode(value: unknown): DataMode {
  const clean = String(value ?? '').trim().toLowerCase()
  if (!clean || clean === 'local') return 'local'
  if (clean === 'cloud') return 'cloud'
  throw new DataModeError(
    'Ungültiger VITE_DATA_MODE. Erlaubt sind "local" oder "cloud".',
  )
}

export interface DataModeConfig {
  mode: DataMode
  error: string | null
}

/** Liefert bei einem ungültigen Wert einen Fehler statt still lokal zu starten. */
export function resolveDataMode(value: unknown): DataModeConfig {
  try {
    return { mode: parseDataMode(value), error: null }
  } catch (cause) {
    return {
      mode: 'local',
      error: cause instanceof Error ? cause.message : 'Ungültiger VITE_DATA_MODE.',
    }
  }
}

export const dataModeConfig: DataModeConfig = resolveDataMode(
  (import.meta.env as Record<string, string | undefined>).VITE_DATA_MODE,
)

export const dataMode: DataMode = dataModeConfig.mode
