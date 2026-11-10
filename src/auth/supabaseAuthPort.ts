/*
 * Küchenrunde – Supabase-Port für die Cloud-Sitzung
 * Copyright (C) 2026 openCook Web contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Übersetzt die vorhandenen Auth-Helfer in den schmalen, React-freien
 * CloudAuthPort des Session-Controllers. Keine Registrierung, kein Secret.
 */

import type { CloudAuthPort, CloudSession } from './cloudSession'
import {
  getSession,
  onAuthStateChange,
  signInWithEmail,
  signOut,
} from '../supabase/auth'

interface SupabaseSessionLike {
  user: {
    id: string
    email?: string | null
  }
}

function toCloudSession(session: SupabaseSessionLike | null): CloudSession | null {
  if (!session) return null
  return {
    user: {
      id: session.user.id,
      email: session.user.email ?? null,
    },
  }
}

export function createSupabaseAuthPort(): CloudAuthPort {
  return {
    getSession: async () => toCloudSession(await getSession()),
    onAuthStateChange: (callback) =>
      onAuthStateChange((event, session) => {
        callback(event, toCloudSession(session))
      }),
    signIn: async (email, password) => {
      const session = toCloudSession(await signInWithEmail(email, password))
      if (!session) {
        throw new Error('Die Anmeldung wurde nicht abgeschlossen.')
      }
      return session
    },
    signOut: () => signOut(),
  }
}
