/*
 * Küchenrunde – Einladung annehmen und Passwort setzen
 * Copyright (C) 2026 openCook Web contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Supabase-Einladungen werden über den offiziellen Auth-Link zugestellt.
 * Diese Seite übernimmt die dort ankommenden Tokens, setzt die Sitzung und
 * lässt das neue Mitglied sein eigenes Passwort vergeben. Eine öffentliche
 * Registrierung gibt es weiterhin nicht.
 */

import { useEffect, useRef, useState, type FormEvent } from 'react'
import { requireSupabase } from '../supabase/client'
import type { AuthRedirect } from './authRedirect'

type Phase = 'preparing' | 'ready' | 'saving' | 'done' | 'error'

export interface InviteSetupPageProps {
  redirect: AuthRedirect
}

function setupError(): string {
  return 'Die Einladung konnte nicht geöffnet werden. Der Link ist möglicherweise abgelaufen. Bitte den Betreiber um eine neue Einladung.'
}

export function InviteSetupPage({ redirect }: InviteSetupPageProps) {
  const [phase, setPhase] = useState<Phase>('preparing')
  const [email, setEmail] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(
    redirect.type === 'error' ? redirect.message : null,
  )
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const preparation = useRef<Promise<string | null> | null>(null)

  useEffect(() => {
    let active = true

    const prepare = async (): Promise<string | null> => {
      if (redirect.type === 'error') throw new Error(redirect.message)
      const client = requireSupabase()

      if (redirect.type === 'session') {
        const { data, error: sessionError } = await client.auth.setSession({
          access_token: redirect.accessToken,
          refresh_token: redirect.refreshToken,
        })
        if (sessionError || !data.session) throw sessionError ?? new Error(setupError())
        return data.session.user.email ?? null
      }

      const { data, error: verifyError } = await client.auth.verifyOtp({
        type: redirect.purpose,
        token_hash: redirect.tokenHash,
      })
      if (verifyError || !data.session) throw verifyError ?? new Error(setupError())
      return data.session.user.email ?? null
    }

    if (!preparation.current) preparation.current = prepare()

    preparation.current
      .then((preparedEmail) => {
        if (!active) return
        setEmail(preparedEmail)
        setPhase('ready')
      })
      .catch(() => {
        if (!active) return
        setError(setupError())
        setPhase('error')
      })

    return () => {
      active = false
    }
  }, [redirect])

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (password.length < 8) {
      setFormError('Das Passwort muss mindestens 8 Zeichen lang sein.')
      return
    }
    if (password !== confirmation) {
      setFormError('Die beiden Passwörter stimmen nicht überein.')
      return
    }

    setFormError(null)
    setPhase('saving')
    try {
      const { error: updateError } = await requireSupabase().auth.updateUser({ password })
      if (updateError) throw updateError
      setPhase('done')
      window.setTimeout(() => {
        window.history.replaceState(null, '', `${window.location.pathname}#/`)
        window.location.replace('/#/')
      }, 800)
    } catch {
      setPhase('ready')
      setFormError(
        'Das Passwort konnte nicht gespeichert werden. Bitte ein anderes Passwort versuchen oder den Betreiber kontaktieren.',
      )
    }
  }

  const goToLogin = () => {
    window.history.replaceState(null, '', `${window.location.pathname}#/`)
    window.location.replace('/#/')
  }

  if (phase === 'error' || (redirect.type === 'error' && phase === 'preparing')) {
    return (
      <div className="page cloud-page">
        <section className="panel cloud-card login-card" aria-labelledby="invite-error-title">
          <p className="cloud-eyebrow">Familien-Cloud</p>
          <h1 id="invite-error-title">Einladung nicht verwendbar</h1>
          <p>{error ?? (redirect.type === 'error' ? redirect.message : setupError())}</p>
          <div className="cloud-actions">
            <button type="button" className="button primary" onClick={goToLogin}>
              Zum Login
            </button>
          </div>
        </section>
      </div>
    )
  }

  if (phase === 'preparing') {
    return (
      <div className="page cloud-page">
        <section className="panel cloud-card login-card">
          <p className="cloud-eyebrow">Familien-Cloud</p>
          <h1>Einladung wird geprüft …</h1>
          <p className="muted" role="status">
            Einen Moment bitte.
          </p>
        </section>
      </div>
    )
  }

  if (phase === 'done') {
    return (
      <div className="page cloud-page">
        <section className="panel cloud-card login-card">
          <p className="cloud-eyebrow">Familien-Cloud</p>
          <h1>Passwort gespeichert</h1>
          <p role="status">Du wirst zu Küchenrunde weitergeleitet …</p>
        </section>
      </div>
    )
  }

  const isInvite = redirect.type !== 'error' && redirect.purpose === 'invite'
  const busy = phase === 'saving'

  return (
    <div className="page cloud-page">
      <section className="panel cloud-card login-card" aria-labelledby="invite-title">
        <p className="cloud-eyebrow">Familien-Cloud</p>
        <h1 id="invite-title">{isInvite ? 'Konto einrichten' : 'Passwort zurücksetzen'}</h1>
        <p className="muted">
          {email ? (
            <>
              Willkommen, <strong>{email}</strong>. Lege jetzt dein eigenes Passwort fest.
            </>
          ) : (
            'Lege jetzt dein eigenes Passwort fest.'
          )}
        </p>

        <form className="login-form" onSubmit={handleSubmit} noValidate>
          <label className="field">
            <span className="field-label">Neues Passwort</span>
            <input
              id="invite-password"
              name="password"
              type="password"
              autoComplete="new-password"
              minLength={8}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              disabled={busy}
              aria-invalid={formError ? true : undefined}
              required
            />
          </label>

          <label className="field">
            <span className="field-label">Passwort wiederholen</span>
            <input
              id="invite-password-confirmation"
              name="password-confirmation"
              type="password"
              autoComplete="new-password"
              minLength={8}
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              disabled={busy}
              aria-invalid={formError ? true : undefined}
              required
            />
          </label>

          {formError ? (
            <p className="login-error" role="alert">
              {formError}
            </p>
          ) : null}

          <button type="submit" className="button primary login-submit" disabled={busy}>
            {busy ? 'Passwort wird gespeichert …' : 'Passwort speichern'}
          </button>
        </form>

        <p className="login-note">
          Mindestens 8 Zeichen. Die Einladung ist nur für dieses Konto bestimmt.
        </p>
      </section>
    </div>
  )
}
