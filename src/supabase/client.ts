/*
 * Küchenrunde – zentraler Supabase-Client
 * Copyright (C) 2026 openCook Web contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Der Client wird nur erzeugt, wenn eine öffentliche Konfiguration vorliegt.
 * Es wird ausschließlich der Publishable-/Anon-Key verwendet. Ein
 * service_role-Key wird bereits in config.ts abgelehnt.
 *
 * Der Client wird ausschließlich im expliziten Cloud-Modus
 * (VITE_DATA_MODE=cloud) geladen. Ohne diesen Schalter bleibt die App lokal.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { CloudConfigError, parseCloudConfig, type CloudConfig } from './config'

export class CloudNotConfiguredError extends Error {
  constructor(message = 'Supabase ist nicht konfiguriert.') {
    super(message)
    this.name = 'CloudNotConfiguredError'
  }
}

const env = import.meta.env as unknown as Record<string, string | undefined>

let parsedConfig: CloudConfig | null = null
let parsedConfigError: Error | null = null
try {
  parsedConfig = parseCloudConfig({
    VITE_SUPABASE_URL: env.VITE_SUPABASE_URL,
    VITE_SUPABASE_PUBLISHABLE_KEY: env.VITE_SUPABASE_PUBLISHABLE_KEY,
  })
} catch (cause) {
  // Nicht beim Modulimport abstürzen: Die Cloud-Oberfläche zeigt eine
  // verständliche Konfigurationsfehlerseite, ohne Schlüssel zu wiederholen.
  parsedConfigError =
    cause instanceof Error
      ? cause
      : new CloudConfigError('Die Supabase-Konfiguration ist ungültig.')
}

function createCloudClient(config: CloudConfig): SupabaseClient {
  try {
    return createClient(config.url, config.publishableKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        // Hash-Routing: Supabase darf die URL nicht nach Auth-Parametern
        // durchsuchen. Der Login läuft ausschließlich über das Formular.
        detectSessionInUrl: false,
        storageKey: 'kuechenrunde.auth.v1',
      },
      db: { schema: 'public' },
    })
  } catch (cause) {
    // Niemals den Schlüssel in die Fehlermeldung aufnehmen.
    throw new CloudConfigError(
      `Der Supabase-Client konnte nicht initialisiert werden: ${(cause as Error).message}`,
    )
  }
}

let client: SupabaseClient | null = null
if (parsedConfig) {
  try {
    client = createCloudClient(parsedConfig)
  } catch (cause) {
    parsedConfigError =
      cause instanceof Error
        ? cause
        : new CloudConfigError('Der Supabase-Client konnte nicht initialisiert werden.')
  }
}

export const cloudConfig: CloudConfig | null = parsedConfig
export const cloudConfigError: Error | null = parsedConfigError
export const supabase: SupabaseClient | null = client

export function isCloudConfigured(): boolean {
  return supabase !== null && cloudConfigError === null
}

export function requireSupabase(): SupabaseClient {
  if (!supabase) {
    throw new CloudNotConfiguredError(
      'Supabase ist nicht konfiguriert. VITE_SUPABASE_URL und VITE_SUPABASE_PUBLISHABLE_KEY fehlen.',
    )
  }
  return supabase
}
