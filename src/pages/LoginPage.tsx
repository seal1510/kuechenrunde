/*
 * Küchenrunde – Login-Seite
 * Copyright (C) 2026 openCook Web contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Schlichte E-Mail-/Passwort-Anmeldung. Es gibt bewusst keine Registrierung,
 * keinen Magic-Link und keinen Passwort-Reset im Frontend. Zugänge legt der
 * Betreiber im Supabase-Dashboard an.
 */

import { useState, type FormEvent } from 'react'

export interface LoginPageProps {
  onSubmit: (email: string, password: string) => void | Promise<void>
  busy?: boolean
  error?: string | null
}

export function LoginPage({
  onSubmit,
  busy = false,
  error = null,
}: LoginPageProps) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [validationError, setValidationError] = useState<string | null>(null)
  const message = validationError ?? error

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!email.trim() || !password) {
      setValidationError('Bitte E-Mail-Adresse und Passwort eingeben.')
      return
    }
    setValidationError(null)
    try {
      await onSubmit(email.trim(), password)
    } catch (cause) {
      setValidationError(
        cause instanceof Error ? cause.message : 'Die Anmeldung ist fehlgeschlagen.',
      )
    }
  }

  return (
    <div className="page cloud-page">
      <section className="panel cloud-card login-card" aria-labelledby="login-title">
        <p className="cloud-eyebrow">Familien-Cloud</p>
        <h1 id="login-title">Anmelden</h1>
        <p className="muted">
          Melde dich mit dem Zugang an, den der Betreiber für dich angelegt hat.
        </p>

        <form className="login-form" onSubmit={handleSubmit} noValidate>
          <label className="field">
            <span className="field-label">E-Mail-Adresse</span>
            <input
              id="login-email"
              name="email"
              type="email"
              autoComplete="email"
              autoCapitalize="none"
              spellCheck={false}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              disabled={busy}
              aria-invalid={message ? true : undefined}
              required
            />
          </label>

          <label className="field">
            <span className="field-label">Passwort</span>
            <input
              id="login-password"
              name="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              disabled={busy}
              aria-invalid={message ? true : undefined}
              required
            />
          </label>

          {message ? (
            <p className="login-error" role="alert">
              {message}
            </p>
          ) : null}

          <button
            type="submit"
            className="button primary login-submit"
            disabled={busy}
          >
            {busy ? 'Anmeldung läuft …' : 'Anmelden'}
          </button>
        </form>

        <p className="login-note">
          Es gibt keine öffentliche Registrierung. Zugänge werden vom Betreiber
          angelegt; bei Problemen mit dem Passwort hilft der Betreiber.
        </p>
      </section>
    </div>
  )
}
