/*
 * Küchenrunde – Einladung annehmen
 * Copyright (C) 2026 openCook Web contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Diese Seite liegt außerhalb des normalen Cloud-Bootstraps. Sie übernimmt
 * den Einladungslink, die Registrierung bzw. Anmeldung und ruft erst danach
 * die serverseitige, atomare Einlösung auf.
 */

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import type { AuthRedirect } from '../auth/authRedirect'
import { redeemHouseholdInvite } from '../family/familyInvites'
import { buildJoinUrl } from '../family/joinLink'
import { requireSupabase } from '../supabase/client'

type Phase =
  | 'checking'
  | 'idle'
  | 'submitting'
  | 'redeeming'
  | 'confirm-sent'
  | 'joined'
  | 'already'
  | 'error'

type Mode = 'register' | 'login'

export interface JoinPageProps {
  token: string
  authRedirect: AuthRedirect | null
}

function authErrorMessage(error: { message?: string; status?: number } | null): string {
  const message = String(error?.message ?? '').toLowerCase()
  if (message.includes('invalid login credentials')) {
    return 'E-Mail oder Passwort ist falsch.'
  }
  if (message.includes('email not confirmed')) {
    return 'Bitte bestätige zuerst deine E-Mail-Adresse über den Link in der E-Mail.'
  }
  if (message.includes('already registered') || message.includes('already been registered')) {
    return 'Für diese E-Mail-Adresse gibt es bereits ein Konto. Melde dich bitte an.'
  }
  if (error?.status === 429 || message.includes('rate limit')) {
    return 'Zu viele Versuche. Bitte kurz warten.'
  }
  if (message.includes('failed to fetch') || message.includes('network')) {
    return 'Die Verbindung ist gerade nicht möglich. Bitte später erneut versuchen.'
  }
  return 'Das hat nicht geklappt. Bitte prüfe deine Eingaben und versuche es erneut.'
}

function preparationError(cause: unknown): string {
  if (cause instanceof Error && cause.message.trim()) return cause.message
  return 'Die Einladung konnte nicht geöffnet werden. Bitte den Administrator um einen neuen Link.'
}

export function JoinPage({ token, authRedirect }: JoinPageProps) {
  const [phase, setPhase] = useState<Phase>('checking')
  const [mode, setMode] = useState<Mode>('register')
  const [email, setEmail] = useState<string | null>(null)
  const [formEmail, setFormEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [error, setError] = useState<string | null>(null)
  const preparation = useRef<Promise<{ email: string | null; autoRedeem: boolean }> | null>(null)

  async function redeemNow() {
    setPhase('redeeming')
    setError(null)
    try {
      const result = await redeemHouseholdInvite(token)
      if (result === 'joined') {
        setPhase('joined')
        window.setTimeout(() => {
          window.location.replace('/#/')
        }, 1200)
        return
      }
      setPhase('already')
    } catch (cause) {
      setError(preparationError(cause))
      setPhase('error')
    }
  }

  useEffect(() => {
    let active = true

    const prepare = async (): Promise<{ email: string | null; autoRedeem: boolean }> => {
      const client = requireSupabase()
      if (authRedirect?.type === 'error') throw new Error(authRedirect.message)

      if (authRedirect?.type === 'session') {
        const { data, error: sessionError } = await client.auth.setSession({
          access_token: authRedirect.accessToken,
          refresh_token: authRedirect.refreshToken,
        })
        if (sessionError || !data.session) {
          throw new Error('Die Bestätigung konnte nicht abgeschlossen werden. Bitte den Einladungslink erneut öffnen.')
        }
        return { email: data.session.user.email ?? null, autoRedeem: true }
      }

      if (authRedirect?.type === 'token_hash') {
        const { data, error: verifyError } = await client.auth.verifyOtp({
          type: authRedirect.purpose,
          token_hash: authRedirect.tokenHash,
        })
        if (verifyError || !data.session) {
          throw new Error('Die Bestätigung konnte nicht abgeschlossen werden. Bitte den Einladungslink erneut öffnen.')
        }
        return { email: data.session.user.email ?? null, autoRedeem: true }
      }

      const { data, error: sessionError } = await client.auth.getSession()
      if (sessionError) {
        throw new Error('Die Anmeldung konnte nicht geprüft werden. Bitte später erneut versuchen.')
      }
      return { email: data.session?.user.email ?? null, autoRedeem: false }
    }

    if (!preparation.current) preparation.current = prepare()

    preparation.current
      .then((prepared) => {
        if (!active) return
        setEmail(prepared.email)
        if (prepared.email && prepared.autoRedeem) {
          void redeemNow()
        } else {
          setPhase('idle')
        }
      })
      .catch((cause) => {
        if (!active) return
        setError(preparationError(cause))
        setPhase('error')
      })

    return () => {
      active = false
    }
  }, [authRedirect, token])

  async function handleRegister(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const cleanEmail = formEmail.trim().toLowerCase()
    if (!cleanEmail || !password) {
      setError('Bitte E-Mail-Adresse und Passwort eingeben.')
      return
    }
    if (password.length < 8) {
      setError('Das Passwort muss mindestens 8 Zeichen lang sein.')
      return
    }
    if (password !== confirmation) {
      setError('Die beiden Passwörter stimmen nicht überein.')
      return
    }

    setError(null)
    setPhase('submitting')
    try {
      const { data, error: signUpError } = await requireSupabase().auth.signUp({
        email: cleanEmail,
        password,
        options: {
          emailRedirectTo: buildJoinUrl(window.location.href, token),
        },
      })
      if (signUpError) throw new Error(authErrorMessage(signUpError))
      if (data.session) {
        setEmail(data.session.user.email ?? cleanEmail)
        await redeemNow()
        return
      }
      setPhase('confirm-sent')
    } catch (cause) {
      setError(preparationError(cause))
      setPhase('idle')
    }
  }

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const cleanEmail = formEmail.trim().toLowerCase()
    if (!cleanEmail || !password) {
      setError('Bitte E-Mail-Adresse und Passwort eingeben.')
      return
    }

    setError(null)
    setPhase('submitting')
    try {
      const { data, error: signInError } = await requireSupabase().auth.signInWithPassword({
        email: cleanEmail,
        password,
      })
      if (signInError) throw new Error(authErrorMessage(signInError))
      if (!data.session) throw new Error('Die Anmeldung wurde nicht abgeschlossen.')
      setEmail(data.session.user.email ?? cleanEmail)
      await redeemNow()
    } catch (cause) {
      setError(preparationError(cause))
      setPhase('idle')
    }
  }

  async function switchAccount() {
    try {
      await requireSupabase().auth.signOut({ scope: 'local' })
    } catch {
      // Das lokale Abmelden ist auch ohne Serververbindung möglich.
    }
    setEmail(null)
    setMode('login')
    setPassword('')
    setConfirmation('')
    setError(null)
    setPhase('idle')
  }

  function goHome() {
    window.location.replace('/#/')
  }

  if (phase === 'checking') {
    return (
      <JoinShell title="Einladung wird geprüft …">
        <p className="muted" role="status">
          Einen Moment bitte.
        </p>
      </JoinShell>
    )
  }

  if (phase === 'redeeming') {
    return (
      <JoinShell title="Beitritt wird abgeschlossen …">
        <p className="muted" role="status">
          Einen Moment bitte.
        </p>
      </JoinShell>
    )
  }

  if (phase === 'joined') {
    return (
      <JoinShell title="Willkommen in der Familie!">
        <p role="status">
          Dein Konto ist jetzt Teil des gemeinsamen Haushalts. Du wirst zu Küchenrunde
          weitergeleitet …
        </p>
      </JoinShell>
    )
  }

  if (phase === 'already') {
    return (
      <JoinShell title="Du bist bereits dabei">
        <p>Dein Konto gehört bereits zu diesem Familienhaushalt.</p>
        <div className="cloud-actions">
          <button type="button" className="button primary" onClick={goHome}>
            Zu Küchenrunde
          </button>
        </div>
      </JoinShell>
    )
  }

  if (phase === 'error') {
    return (
      <JoinShell title="Einladung nicht möglich">
        <p>{error}</p>
        <div className="cloud-actions">
          <button type="button" className="button primary" onClick={goHome}>
            Zur Startseite
          </button>
        </div>
      </JoinShell>
    )
  }

  if (phase === 'confirm-sent') {
    return (
      <JoinShell title="Fast geschafft">
        <p>
          Wir haben dir eine E-Mail geschickt. Öffne den Link in der E-Mail und
          bestätige damit dein Konto. Danach bist du automatisch dabei.
        </p>
        <div className="cloud-actions">
          <button
            type="button"
            className="button quiet"
            onClick={() => {
              setMode('login')
              setPhase('idle')
              setError(null)
            }}
          >
            Ich habe schon ein Konto
          </button>
          <button type="button" className="button quiet" onClick={goHome}>
            Zur Startseite
          </button>
        </div>
      </JoinShell>
    )
  }

  if (email) {
    return (
      <JoinShell title="Familie beitreten">
        <p>
          Du bist als <strong>{email}</strong> angemeldet.
        </p>
        <p className="muted">
          Mit diesem Konto kannst du dem Familienhaushalt beitreten.
        </p>
        <div className="cloud-actions">
          <button type="button" className="button primary" onClick={() => void redeemNow()}>
            Haushalt beitreten
          </button>
          <button type="button" className="button quiet" onClick={() => void switchAccount()}>
            Mit anderem Konto anmelden
          </button>
        </div>
      </JoinShell>
    )
  }

  const busy = phase === 'submitting'

  return (
    <JoinShell title="Familie beitreten">
      <p className="muted">
        Du wurdest zu Küchenrunde eingeladen. Erstelle ein Konto oder melde dich an,
        um dem gemeinsamen Haushalt beizutreten.
      </p>

      <div className="join-tabs" role="tablist" aria-label="Konto">
        <button
          type="button"
          className={`button quiet${mode === 'register' ? ' is-active' : ''}`}
          onClick={() => {
            setMode('register')
            setError(null)
          }}
          aria-pressed={mode === 'register'}
        >
          Neu registrieren
        </button>
        <button
          type="button"
          className={`button quiet${mode === 'login' ? ' is-active' : ''}`}
          onClick={() => {
            setMode('login')
            setError(null)
          }}
          aria-pressed={mode === 'login'}
        >
          Ich habe ein Konto
        </button>
      </div>

      <form
        className="login-form"
        onSubmit={mode === 'register' ? handleRegister : handleLogin}
        noValidate
      >
        <label className="field">
          <span className="field-label">E-Mail-Adresse</span>
          <input
            name="email"
            type="email"
            autoComplete="email"
            autoCapitalize="none"
            spellCheck={false}
            value={formEmail}
            onChange={(event) => setFormEmail(event.target.value)}
            disabled={busy}
            required
          />
        </label>

        <label className="field">
          <span className="field-label">Passwort</span>
          <input
            name="password"
            type="password"
            autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
            minLength={mode === 'register' ? 8 : undefined}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            disabled={busy}
            required
          />
        </label>

        {mode === 'register' ? (
          <label className="field">
            <span className="field-label">Passwort wiederholen</span>
            <input
              name="password-confirmation"
              type="password"
              autoComplete="new-password"
              minLength={8}
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              disabled={busy}
              required
            />
          </label>
        ) : null}

        {error ? (
          <p className="login-error" role="alert">
            {error}
          </p>
        ) : null}

        <button type="submit" className="button primary login-submit" disabled={busy}>
          {busy
            ? 'Einen Moment …'
            : mode === 'register'
              ? 'Konto erstellen'
              : 'Anmelden'}
        </button>
      </form>

      <p className="login-note">
        Der Einladungslink ist einmalig gültig. Dein Konto erhält erst durch diesen
        Link Zugang zum Familienhaushalt.
      </p>
    </JoinShell>
  )
}

function JoinShell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="page cloud-page">
      <section className="panel cloud-card login-card" aria-labelledby="join-title">
        <p className="cloud-eyebrow">Familien-Cloud</p>
        <h1 id="join-title">{title}</h1>
        {children}
      </section>
    </div>
  )
}
