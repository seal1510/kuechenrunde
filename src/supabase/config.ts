/*
 * Küchenrunde – Cloud-Konfiguration
 * Copyright (C) 2026 openCook Web contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Liest und validiert die öffentliche Supabase-Konfiguration. Bewusst frei von
 * Supabase- und DOM-Abhängigkeiten, damit die Regeln ohne Netzwerk testbar
 * bleiben.
 *
 * Es gibt hier absichtlich keinen Pfad, der einen service_role-Key akzeptiert.
 */

export interface CloudConfig {
  /** Projekt-Origin ohne abschließenden Schrägstrich. */
  url: string
  /** Öffentlicher Publishable-/Anon-Key. */
  publishableKey: string
}

export interface CloudEnv {
  VITE_SUPABASE_URL?: string
  VITE_SUPABASE_PUBLISHABLE_KEY?: string
}

export class CloudConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CloudConfigError'
  }
}

const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])
const PLACEHOLDER_MARKERS = ['your-project-ref', 'replace-me', 'example.supabase.co']

/**
 * Liefert `null`, wenn keine Cloud-Konfiguration gesetzt ist (lokaler Modus).
 * Wirft bei einer unvollständigen oder unsicheren Konfiguration, damit die App
 * nicht versehentlich mit falschen Schlüsseln startet.
 */
export function parseCloudConfig(env: CloudEnv): CloudConfig | null {
  const rawUrl = String(env.VITE_SUPABASE_URL ?? '').trim()
  const rawKey = String(env.VITE_SUPABASE_PUBLISHABLE_KEY ?? '').trim()
  if (!rawUrl && !rawKey) return null
  if (!rawUrl || !rawKey) {
    throw new CloudConfigError(
      'Supabase ist unvollständig konfiguriert: VITE_SUPABASE_URL und VITE_SUPABASE_PUBLISHABLE_KEY müssen gemeinsam gesetzt sein.',
    )
  }
  if (PLACEHOLDER_MARKERS.some((marker) => rawUrl.includes(marker) || rawKey.includes(marker))) {
    throw new CloudConfigError(
      'Die Supabase-Konfiguration enthält noch Platzhalter. Bitte die echten Werte in .env eintragen.',
    )
  }

  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    throw new CloudConfigError('VITE_SUPABASE_URL ist keine gültige URL.')
  }

  const isLocal =
    url.protocol === 'http:' && LOCAL_HOSTNAMES.has(url.hostname.toLowerCase())
  if (url.protocol !== 'https:' && !isLocal) {
    throw new CloudConfigError(
      'VITE_SUPABASE_URL muss HTTPS verwenden (HTTP ist nur für localhost erlaubt).',
    )
  }
  if (url.username || url.password) {
    throw new CloudConfigError('VITE_SUPABASE_URL darf keine Zugangsdaten enthalten.')
  }
  if (url.pathname !== '/' || url.search || url.hash) {
    throw new CloudConfigError(
      'VITE_SUPABASE_URL muss die reine Projekt-URL ohne Pfad, Query oder Fragment sein.',
    )
  }

  assertPublicKey(rawKey)
  return { url: url.origin, publishableKey: rawKey }
}

/**
 * Erkennt Service-Role-Schlüssel, bevor sie in den Browser gelangen. Neue
 * Supabase-Secret-Keys beginnen mit `sb_secret_`; ältere sind JWTs mit
 * `"role":"service_role"`.
 */
export function assertPublicKey(key: string): void {
  if (key.length < 20) {
    throw new CloudConfigError('VITE_SUPABASE_PUBLISHABLE_KEY ist zu kurz.')
  }
  if (/^sb_secret_/i.test(key) || key.toLowerCase().includes('service_role')) {
    throw new CloudConfigError(
      'Ein service_role-Key darf niemals im Frontend verwendet werden. Bitte den Publishable-/Anon-Key eintragen.',
    )
  }
  const payload = decodeJwtPayload(key)
  if (payload?.role === 'service_role') {
    throw new CloudConfigError(
      'Ein service_role-Key darf niemals im Frontend verwendet werden. Bitte den Publishable-/Anon-Key eintragen.',
    )
  }
}

function decodeJwtPayload(key: string): Record<string, unknown> | null {
  const parts = key.split('.')
  if (parts.length !== 3) return null
  try {
    const base64 = (parts[1] ?? '').replace(/-/g, '+').replace(/_/g, '/')
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4)
    const binary = atob(padded)
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0))
    const value: unknown = JSON.parse(new TextDecoder().decode(bytes))
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}
