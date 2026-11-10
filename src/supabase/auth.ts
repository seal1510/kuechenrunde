/*
 * Küchenrunde – Authentifizierung
 * Copyright (C) 2026 openCook Web contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Nur Anmeldung, Abmeldung und Session-Verwaltung. Es gibt bewusst keine
 * Registrierung: Familienmitglieder werden vom Betreiber im Supabase-Dashboard
 * angelegt und anschließend in public.household_members eingetragen.
 */

import type { AuthChangeEvent, AuthError, Session } from '@supabase/supabase-js'
import { requireSupabase } from './client'

export class AuthFailure extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AuthFailure'
  }
}

function normalizeEmail(email: string): string {
  return String(email ?? '').trim().toLowerCase()
}

function authErrorMessage(error: AuthError): string {
  const message = String(error.message ?? '').toLowerCase()
  if (message.includes('invalid login credentials')) {
    return 'E-Mail oder Passwort ist falsch.'
  }
  if (message.includes('email not confirmed')) {
    return 'Die E-Mail-Adresse ist noch nicht bestätigt. Bitte den Betreiber kontaktieren.'
  }
  if (error.status === 429 || message.includes('rate limit')) {
    return 'Zu viele Anmeldeversuche. Bitte kurz warten.'
  }
  if (message.includes('failed to fetch') || message.includes('network')) {
    return 'Supabase ist nicht erreichbar. Bitte die Verbindung prüfen.'
  }
  return error.message || 'Die Anmeldung ist fehlgeschlagen.'
}

/**
 * Meldet ein bereits angelegtes Familienmitglied an. Es wird kein Konto
 * erzeugt und keine Selbstregistrierung angeboten.
 */
export async function signInWithEmail(email: string, password: string): Promise<Session> {
  const cleanEmail = normalizeEmail(email)
  if (!cleanEmail || !password) {
    throw new AuthFailure('Bitte E-Mail-Adresse und Passwort eingeben.')
  }

  try {
    const { data, error } = await requireSupabase().auth.signInWithPassword({
      email: cleanEmail,
      password,
    })
    if (error) throw new AuthFailure(authErrorMessage(error))
    if (!data.session) {
      throw new AuthFailure(
        'Die Anmeldung wurde nicht abgeschlossen. Bitte den Betreiber kontaktieren.',
      )
    }
    return data.session
  } catch (cause) {
    if (cause instanceof AuthFailure) throw cause
    throw new AuthFailure('Supabase ist nicht erreichbar. Bitte die Verbindung prüfen.')
  }
}

export async function signOut(): Promise<void> {
  const { error } = await requireSupabase().auth.signOut()
  if (error) throw new AuthFailure(authErrorMessage(error))
}

export async function getSession(): Promise<Session | null> {
  const { data, error } = await requireSupabase().auth.getSession()
  if (error) throw new AuthFailure(authErrorMessage(error))
  return data.session
}

/** Kurzlebiger Access-Token für geschützte Same-Origin-Endpunkte (URL-Import). */
export async function getAccessToken(): Promise<string | null> {
  const session = await getSession()
  return session?.access_token ?? null
}

export function onAuthStateChange(
  callback: (event: AuthChangeEvent, session: Session | null) => void,
): () => void {
  const { data } = requireSupabase().auth.onAuthStateChange((event, session) => {
    callback(event, session)
  })
  return () => data.subscription.unsubscribe()
}
