/*
 * Küchenrunde – Familie verwalten
 * Copyright (C) 2026 openCook Web contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Nur Haushaltsadministratoren sehen hier Einladungslinks. Die eigentliche
 * Berechtigungsprüfung und die atomare Einlösung liegen in Supabase, nicht in
 * dieser Oberfläche.
 */

import { useEffect, useState } from 'react'
import {
  createHouseholdInvite,
  isHouseholdAdmin,
  listHouseholdInvites,
  revokeHouseholdInvite,
  type CreatedHouseholdInvite,
  type HouseholdInvite,
} from '../family/familyInvites'
import { buildJoinUrl } from '../family/joinLink'

export type InviteStatus = 'open' | 'redeemed' | 'revoked' | 'expired'

export interface FamilyPageApi {
  isAdmin: () => Promise<boolean>
  list: () => Promise<HouseholdInvite[]>
  create: () => Promise<CreatedHouseholdInvite>
  revoke: (id: string) => Promise<boolean>
}

const defaultApi: FamilyPageApi = {
  isAdmin: isHouseholdAdmin,
  list: listHouseholdInvites,
  create: createHouseholdInvite,
  revoke: revokeHouseholdInvite,
}

export function inviteStatus(invite: HouseholdInvite, now = Date.now()): InviteStatus {
  if (invite.redeemedAt) return 'redeemed'
  if (invite.revokedAt) return 'revoked'
  if (Date.parse(invite.expiresAt) <= now) return 'expired'
  return 'open'
}

const statusLabel: Record<InviteStatus, string> = {
  open: 'Offen',
  redeemed: 'Eingelöst',
  revoked: 'Widerrufen',
  expired: 'Abgelaufen',
}

function formatDate(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '–'
  return new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium' }).format(date)
}

function defaultBaseHref(): string {
  return typeof window === 'undefined'
    ? 'https://kuechenrunde.pages.dev/'
    : window.location.href
}

export interface FamilyPageProps {
  api?: FamilyPageApi
  baseHref?: string
}

export function FamilyPage({ api = defaultApi, baseHref }: FamilyPageProps) {
  const [phase, setPhase] = useState<'loading' | 'forbidden' | 'ready' | 'error'>(
    'loading',
  )
  const [invites, setInvites] = useState<HouseholdInvite[]>([])
  const [created, setCreated] = useState<{ url: string; expiresAt: string } | null>(
    null,
  )
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const resolvedBase = baseHref ?? defaultBaseHref()

  useEffect(() => {
    let active = true
    const load = async () => {
      try {
        const admin = await api.isAdmin()
        if (!active) return
        if (!admin) {
          setPhase('forbidden')
          return
        }
        const rows = await api.list()
        if (!active) return
        setInvites(rows)
        setPhase('ready')
      } catch {
        if (!active) return
        setError('Die Einladungen konnten nicht geladen werden.')
        setPhase('error')
      }
    }
    void load()
    return () => {
      active = false
    }
  }, [api])

  async function reload() {
    const rows = await api.list()
    setInvites(rows)
  }

  async function handleCreate() {
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      const createdInvite = await api.create()
      setCreated({
        url: buildJoinUrl(resolvedBase, createdInvite.token),
        expiresAt: createdInvite.expiresAt,
      })
      await reload()
      setMessage('Einladungslink erstellt. Er ist sieben Tage gültig und einmalig.')
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Die Einladung konnte nicht erstellt werden.',
      )
    } finally {
      setBusy(false)
    }
  }

  async function copyLink() {
    if (!created) return
    try {
      await navigator.clipboard.writeText(created.url)
      setMessage('Link kopiert.')
      setError(null)
    } catch {
      setError('Der Link konnte nicht automatisch kopiert werden. Bitte markiere ihn und kopiere ihn manuell.')
    }
  }

  async function shareLink() {
    if (!created) return
    if (typeof navigator.share !== 'function') {
      await copyLink()
      return
    }
    try {
      await navigator.share({
        title: 'Küchenrunde',
        text: 'Tritt unserem Familienhaushalt bei:',
        url: created.url,
      })
      setMessage('Teilen geöffnet.')
      setError(null)
    } catch (cause) {
      if ((cause as { name?: string })?.name === 'AbortError') return
      setError('Der Link konnte nicht geteilt werden. Bitte kopiere ihn stattdessen.')
    }
  }

  async function handleRevoke(id: string) {
    if (
      typeof window !== 'undefined' &&
      !window.confirm('Diesen Einladungslink widerrufen?')
    ) {
      return
    }
    setBusy(true)
    setError(null)
    try {
      const revoked = await api.revoke(id)
      if (!revoked) {
        setError('Der Link ist bereits eingelöst oder wurde schon widerrufen.')
      } else {
        setMessage('Einladungslink widerrufen.')
      }
      await reload()
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Die Einladung konnte nicht widerrufen werden.',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="page family-page">
      <header className="page-head">
        <div>
          <h1>Familie verwalten</h1>
          <p className="muted">Einladungen für den gemeinsamen Haushalt</p>
        </div>
        <a className="button" href="#/">
          Zur Bibliothek
        </a>
      </header>

      {phase === 'loading' ? (
        <section className="panel">
          <p className="muted" role="status">
            Einladungen werden geladen …
          </p>
        </section>
      ) : null}

      {phase === 'forbidden' ? (
        <section className="panel">
          <h2>Nur für Administratoren</h2>
          <p>
            Einladungslinks können nur vom Haushaltsadministrator erstellt werden.
            Bitte den Administrator, dich freizuschalten.
          </p>
        </section>
      ) : null}

      {phase === 'error' ? (
        <section className="panel">
          <h2>Einladungen nicht erreichbar</h2>
          <p>{error}</p>
          <div className="cloud-actions">
            <button
              type="button"
              className="button primary"
              onClick={() => window.location.reload()}
            >
              Erneut versuchen
            </button>
          </div>
        </section>
      ) : null}

      {phase === 'ready' ? (
        <>
          <section className="panel">
            <h2>Einladungslink erstellen</h2>
            <p>
              Erstelle einen Link und schicke ihn zum Beispiel per WhatsApp. Der Link
              gilt sieben Tage und kann genau einmal verwendet werden.
            </p>
            <div className="cloud-actions">
              <button
                type="button"
                className="button primary"
                onClick={() => void handleCreate()}
                disabled={busy}
              >
                {busy ? 'Wird erstellt …' : 'Einladungslink erstellen'}
              </button>
            </div>

            {created ? (
              <div className="notice success family-created">
                <h3>Link bereit</h3>
                <p>Gültig bis {formatDate(created.expiresAt)}.</p>
                <div className="family-link-row">
                  <input
                    className="family-link-input"
                    readOnly
                    value={created.url}
                    aria-label="Einladungslink"
                    onFocus={(event) => event.currentTarget.select()}
                  />
                  <button type="button" className="button quiet" onClick={() => void copyLink()}>
                    Kopieren
                  </button>
                  <button type="button" className="button quiet" onClick={() => void shareLink()}>
                    Teilen
                  </button>
                </div>
                <p className="muted small">
                  Der Link wird nur jetzt angezeigt. Danach kannst du einen neuen
                  erstellen.
                </p>
              </div>
            ) : null}

            {message ? (
              <p className="notice success" role="status">
                {message}
              </p>
            ) : null}
            {error ? (
              <p className="login-error" role="alert">
                {error}
              </p>
            ) : null}
          </section>

          <section className="panel">
            <h2>Einladungen</h2>
            {invites.length === 0 ? (
              <p className="muted">Noch keine Einladungen erstellt.</p>
            ) : (
              <ul className="family-invites">
                {invites.map((invite) => {
                  const status = inviteStatus(invite)
                  return (
                    <li key={invite.id} className="family-invite">
                      <div className="family-invite-main">
                        <strong>{statusLabel[status]}</strong>
                        <span className="muted small">
                          Erstellt {formatDate(invite.createdAt)}
                          {status === 'open'
                            ? ` · gültig bis ${formatDate(invite.expiresAt)}`
                            : null}
                          {status === 'redeemed' && invite.redeemedAt
                            ? ` · eingelöst ${formatDate(invite.redeemedAt)}`
                            : null}
                          {status === 'revoked' && invite.revokedAt
                            ? ` · widerrufen ${formatDate(invite.revokedAt)}`
                            : null}
                        </span>
                      </div>
                      {status === 'open' ? (
                        <button
                          type="button"
                          className="button quiet"
                          onClick={() => void handleRevoke(invite.id)}
                          disabled={busy}
                        >
                          Widerrufen
                        </button>
                      ) : null}
                    </li>
                  )
                })}
              </ul>
            )}
          </section>
        </>
      ) : null}
    </div>
  )
}
