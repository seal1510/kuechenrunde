/*
 * Küchenrunde – Einladungslink
 * Copyright (C) 2026 openCook Web contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Der Link wird aus der aktuellen Browser-URL gebaut. Dadurch funktioniert er
 * sowohl mit der pages.dev-Adresse als auch mit einer späteren eigenen Domain.
 */

export function buildJoinUrl(baseHref: string, token: string): string {
  const url = new URL(baseHref)
  url.hash = ''
  url.search = ''
  url.searchParams.set('join', token)
  return url.toString()
}

export function readJoinToken(search: string): string | null {
  const clean = String(search ?? '').trim().replace(/^\?/, '')
  if (!clean) return null
  const token = new URLSearchParams(clean).get('join')?.trim() ?? ''
  return token || null
}
