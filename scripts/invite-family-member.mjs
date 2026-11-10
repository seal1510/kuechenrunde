#!/usr/bin/env node
/*
 * Küchenrunde – Familienmitglied über Supabase Auth einladen
 * Copyright (C) 2026 openCook Web contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Nutzt ausschließlich die offizielle Supabase-Admin-Funktion
 * `POST /auth/v1/invite` und trägt das neue Konto anschließend ausdrücklich in
 * public.household_members ein. Es gibt keine eigene Token- oder
 * Einladungsarchitektur.
 *
 * Der privilegierte Admin-Key wird nur zur Laufzeit über die Supabase
 * Management API geladen, nie ausgegeben und nie gespeichert. Dieses Skript gehört nicht in
 * den Browser-Build und wird nicht von Cloudflare Pages ausgeliefert.
 *
 * Verwendung:
 *   pnpm invite-member "Name des Mitglieds" mitglied@example.org --yes
 */

import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)
const help = argv.includes('--help') || argv.includes('-h')
const yes = argv.includes('--yes')
const dryRun = argv.includes('--dry-run')
const positional = argv.filter((arg) => !arg.startsWith('-'))

function usage() {
  console.log(`Verwendung:
  pnpm invite-member "Name des Mitglieds" mitglied@example.org --yes
  pnpm invite-member "Name des Mitglieds" mitglied@example.org --dry-run

Optionen:
  --yes       Einladung tatsächlich senden und Haushalt freischalten
  --dry-run   Nur prüfen, keine E-Mail und keine Datenbankänderung
  --help      Diese Hilfe anzeigen

Voraussetzung: Die Supabase CLI ist einmalig angemeldet (pnpm supabase login)
oder SUPABASE_ACCESS_TOKEN ist gesetzt.`)
}

if (help) {
  usage()
  process.exit(0)
}
if (positional.length !== 2) {
  usage()
  process.exit(1)
}

const [displayNameRaw, emailRaw] = positional
const displayName = String(displayNameRaw ?? '').trim()
const email = String(emailRaw ?? '').trim().toLowerCase()

if (!displayName) {
  console.error('Fehler: Der Name des Familienmitglieds fehlt.')
  process.exit(1)
}
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  console.error('Fehler: Die E-Mail-Adresse ist ungültig.')
  process.exit(1)
}

function readDotEnv() {
  const file = join(root, '.env')
  if (!existsSync(file)) return {}
  const values = {}
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue
    const index = trimmed.indexOf('=')
    values[trimmed.slice(0, index).trim()] = trimmed
      .slice(index + 1)
      .trim()
      .replace(/^['"]|['"]$/g, '')
  }
  return values
}

function readAccessToken() {
  const direct = process.env.SUPABASE_ACCESS_TOKEN?.trim()
  if (direct) return direct
  const home = resolve(process.env.SUPABASE_HOME?.trim() || homedir())
  const file = join(home, '.supabase', 'access-token')
  if (existsSync(file)) {
    const token = readFileSync(file, 'utf8').trim()
    if (token) return token
  }
  throw new Error(
    'Supabase CLI ist nicht angemeldet. Einmalig `pnpm supabase login` ausführen oder SUPABASE_ACCESS_TOKEN setzen.',
  )
}

function readProjectRef() {
  const direct = process.env.SUPABASE_PROJECT_REF?.trim()
  if (direct) return direct
  const file = join(root, 'supabase', '.temp', 'project-ref')
  if (existsSync(file)) {
    const ref = readFileSync(file, 'utf8').trim()
    if (ref) return ref
  }
  throw new Error('Supabase-Projektref fehlt. Einmalig `pnpm supabase link --project-ref <ref>` ausführen.')
}

function readProjectUrl() {
  const direct = process.env.SUPABASE_URL?.trim() || process.env.VITE_SUPABASE_URL?.trim()
  const fromEnv = readDotEnv().VITE_SUPABASE_URL
  const url = direct || fromEnv
  if (!url) throw new Error('Supabase-URL fehlt. VITE_SUPABASE_URL in .env setzen.')
  return url.replace(/\/$/, '')
}

async function request(label, url, init) {
  const response = await fetch(url, init)
  const text = await response.text()
  let body = null
  if (text) {
    try {
      body = JSON.parse(text)
    } catch {
      body = text
    }
  }
  if (!response.ok) {
    const detail =
      body?.msg ||
      body?.message ||
      body?.error_description ||
      body?.error ||
      response.statusText
    throw new Error(`${label} fehlgeschlagen (HTTP ${response.status}): ${detail}`)
  }
  return body
}

const projectRef = readProjectRef()
const projectUrl = readProjectUrl()
const redirectTo =
  process.env.SUPABASE_INVITE_REDIRECT?.trim() || 'https://kuechenrunde.pages.dev/'
const apiUrl = (process.env.SUPABASE_API_URL?.trim() || 'https://api.supabase.com').replace(/\/$/, '')

if (dryRun) {
  console.log('Dry-Run – es wird keine E-Mail gesendet und nichts geschrieben.')
  console.log(`Projekt: ${projectRef}`)
  console.log(`Einladung an: ${email}`)
  console.log(`Anzeigename: ${displayName}`)
  console.log(`Redirect: ${redirectTo}`)
  process.exit(0)
}

if (!yes) {
  console.error('Es wurde nichts gesendet. Zum tatsächlichen Einladen `--yes` ergänzen.')
  process.exit(1)
}

const accessToken = readAccessToken()

try {
  const keys = await request(
    'Service-Key laden',
    `${apiUrl}/v1/projects/${projectRef}/api-keys?reveal=true`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  )
  // Legacy service_role keys are disabled on current projects. The current
  // admin credential is the project's secret key (sb_secret_…). It is used only
  // here, in memory, and never reaches the browser build.
  const adminKey = Array.isArray(keys)
    ? (keys.find((entry) => entry?.type === 'secret')?.api_key ??
      keys.find((entry) => entry?.name === 'service_role')?.api_key)
    : null
  if (!adminKey) {
    throw new Error('Supabase-Admin-Key wurde von der Management API nicht geliefert.')
  }

  const invited = await request('Einladung senden', `${projectUrl}/auth/v1/invite`, {
    method: 'POST',
    headers: {
      apikey: adminKey,
      Authorization: `Bearer ${adminKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      email,
      data: { display_name: displayName },
      redirect_to: redirectTo,
    }),
  })

  const userId = invited?.id ?? invited?.user?.id
  if (!userId) throw new Error('Supabase hat keine Benutzer-ID für die Einladung geliefert.')

  await request(
    'Haushaltsfreigabe eintragen',
    `${projectUrl}/rest/v1/household_members?on_conflict=user_id`,
    {
      method: 'POST',
      headers: {
        apikey: adminKey,
        Authorization: `Bearer ${adminKey}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify({ user_id: userId, display_name: displayName }),
    },
  )

  console.log(`Einladung an ${email} gesendet.`)
  console.log(`${displayName} ist als Haushaltsmitglied eingetragen.`)
  console.log('Das Mitglied muss den Einladungslink öffnen und dort ein Passwort setzen.')
} catch (cause) {
  console.error(cause instanceof Error ? cause.message : 'Die Einladung ist fehlgeschlagen.')
  process.exit(1)
}
