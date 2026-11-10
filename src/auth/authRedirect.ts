/*
 * Küchenrunde – Auth-Redirect für Einladungen
 * Copyright (C) 2026 openCook Web contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Supabase schickt Einladungs- und Recovery-Links mit Auth-Parametern zurück
 * an die Site URL. Der Client parst sie bewusst selbst, weil die App
 * Hash-Routing verwendet und `detectSessionInUrl` deshalb deaktiviert bleibt.
 *
 * Es werden weder Tokens geloggt noch in Fehlermeldungen ausgegeben.
 */

export type AuthRedirectPurpose = 'invite' | 'recovery'

export type AuthRedirect =
  | {
      type: 'session'
      purpose: AuthRedirectPurpose
      accessToken: string
      refreshToken: string
    }
  | {
      type: 'token_hash'
      purpose: AuthRedirectPurpose
      tokenHash: string
    }
  | {
      type: 'error'
      message: string
    }

function friendlyError(raw: string | null): string {
  const value = (raw ?? '').toLowerCase()
  if (value.includes('expired') || value.includes('otp_expired')) {
    return 'Der Einladungslink ist abgelaufen. Bitte den Betreiber um eine neue Einladung.'
  }
  if (value.includes('access_denied')) {
    return 'Der Einladungslink wurde abgelehnt oder ist nicht mehr gültig. Bitte den Betreiber um eine neue Einladung.'
  }
  return 'Der Einladungslink ist ungültig. Bitte den Betreiber um eine neue Einladung.'
}

/**
 * Parst `#…` oder `?…` Auth-Parameter. Normale App-Hashes wie `#/plan` und
 * fremde Query-Parameter ergeben `null`.
 */
export function parseAuthRedirect(raw: string): AuthRedirect | null {
  const clean = String(raw ?? '').trim().replace(/^[#?]/, '')
  if (!clean) return null

  const params = new URLSearchParams(clean)
  const purpose = params.get('type')
  if (purpose !== 'invite' && purpose !== 'recovery') return null

  const error =
    params.get('error_description') ??
    params.get('error') ??
    params.get('error_code')
  if (error) {
    return { type: 'error', message: friendlyError(error) }
  }

  const accessToken = params.get('access_token')
  const refreshToken = params.get('refresh_token')
  if (accessToken && refreshToken) {
    return { type: 'session', purpose, accessToken, refreshToken }
  }

  const tokenHash = params.get('token_hash')
  if (tokenHash) {
    return { type: 'token_hash', purpose, tokenHash }
  }

  return { type: 'error', message: friendlyError(null) }
}
