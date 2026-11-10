/*
 * Küchenrunde – zentraler Supabase-Client
 * Copyright (C) 2026 openCook Web contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Der Client wird nur erzeugt, wenn eine öffentliche Konfiguration vorliegt.
 * Es wird ausschließlich der Publishable-/Anon-Key verwendet. Ein
 * service_role-Key wird bereits in config.ts abgelehnt.
 *
 * Dieser Client ist in Etappe A1 noch nicht an die App-Navigation oder an
 * src/db.ts angeschlossen.
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

export const cloudConfig: CloudConfig | null = parseCloudConfig({
  VITE_SUPABASE_URL: env.VITE_SUPABASE_URL,
  VITE_SUPABASE_PUBLISHABLE_KEY: env.VITE_SUPABASE_PUBLISHABLE_KEY,
})

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

export const supabase: SupabaseClient | null = cloudConfig
  ? createCloudClient(cloudConfig)
  : null

export function isCloudConfigured(): boolean {
  return supabase !== null
}

export function requireSupabase(): SupabaseClient {
  if (!supabase) {
    throw new CloudNotConfiguredError(
      'Supabase ist nicht konfiguriert. VITE_SUPABASE_URL und VITE_SUPABASE_PUBLISHABLE_KEY fehlen.',
    )
  }
  return supabase
}
