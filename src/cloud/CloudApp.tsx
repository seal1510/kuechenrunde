/*
 * Küchenrunde – Cloud-Oberfläche
 * Copyright (C) 2026 openCook Web contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Im Cloud-Modus sind nach dem Bootstrap Rezeptbibliothek, Wochenplan,
 * Einkaufsliste und Kochmodus freigeschaltet. Timer, Wake Lock und der
 * Kochfortschritt bleiben gerätelokal. Lokale Dexie-Daten werden hier nie als
 * Cloud-Bestand gerendert.
 */

import { useState, type ReactNode } from 'react'
import { AuthProvider, useAuth } from '../auth/AuthProvider'
import { InviteSetupPage } from '../auth/InviteSetupPage'
import { parseAuthRedirect } from '../auth/authRedirect'
import { readJoinToken } from '../family/joinLink'
import { JoinPage } from './JoinPage'
import { cloudConfig, cloudConfigError } from '../supabase/client'
import { AppHeader } from '../components/AppHeader'
import { MobileMoreMenuProvider } from '../navigation/MobileMoreMenu'
import { CloudRecipesApp } from './CloudRecipesApp'
import { CloudStatus } from './CloudStatus'

function CloudFrame({
  children,
  contained = true,
}: {
  children: ReactNode
  /** The ready cloud app renders its own main and keeps the phone nav outside it. */
  contained?: boolean
}) {
  return (
    <div className="app-shell cloud-shell">
      <AppHeader
        subtitle="Familien-Cloud"
        badge={<span className="cloud-mode-badge">Cloud-Modus</span>}
        brandHref={null}
        showMobileSubtitle
      />
      {contained ? <main className="app-main">{children}</main> : children}
      <footer className="app-footer">
        <span>Familien-Cloud · Supabase</span>
        <span>
          <a href="/legal/OFF-DATA-NOTICE.txt">Lizenzen</a> ·{' '}
          <a href="/legal/ingredient-catalog.json">Zutatenkatalog</a>
        </span>
      </footer>
    </div>
  )
}

function CloudConfigurationProblem({ message }: { message: string }) {
  return (
    <div className="page cloud-page">
      <section className="panel cloud-card">
        <p className="cloud-eyebrow">Familien-Cloud</p>
        <h1>Cloud-Modus nicht konfiguriert</h1>
        <p>
          <code>VITE_DATA_MODE=cloud</code> ist gesetzt, aber die
          Supabase-Konfiguration fehlt oder ist ungültig.
        </p>
        <p className="muted">{message}</p>
        <p className="muted">
          Bitte <code>VITE_SUPABASE_URL</code> und{' '}
          <code>VITE_SUPABASE_PUBLISHABLE_KEY</code> prüfen. Es wird kein
          service_role-Key benötigt.
        </p>
      </section>
    </div>
  )
}

/**
 * Authenticated cloud shell. The header can carry the same three-dot secondary
 * menu as the local app because the account data is available here.
 */
function CloudAuthenticatedApp() {
  const { state, store, signIn, logout, retry } = useAuth()
  const ready = state.status === 'ready'

  let content: ReactNode
  if (ready) {
    content = store ? (
      <CloudRecipesApp store={store} email={state.email} onLogout={logout} />
    ) : (
      <CloudStatus
        state={{
          status: 'error',
          email: state.email,
          message: 'Der Cloud-Speicher ist nicht verfügbar.',
        }}
        onSignIn={signIn}
        onRetry={retry}
        onLogout={logout}
      />
    )
  } else {
    content = (
      <CloudStatus
        state={state}
        onSignIn={signIn}
        onRetry={retry}
        onLogout={logout}
      />
    )
  }

  return (
    <MobileMoreMenuProvider
      enabled={ready}
      includeFamily
      email={ready ? state.email : undefined}
      onLogout={ready ? logout : undefined}
    >
      <CloudFrame contained={!ready || !store}>{content}</CloudFrame>
    </MobileMoreMenuProvider>
  )
}

export function CloudApp() {
  const [joinToken] = useState(() =>
    typeof window === 'undefined' ? null : readJoinToken(window.location.search),
  )
  const [authRedirect] = useState(() =>
    typeof window === 'undefined'
      ? null
      : parseAuthRedirect(window.location.hash) ??
        parseAuthRedirect(window.location.search),
  )

  if (joinToken && cloudConfig && !cloudConfigError) {
    return <JoinPage token={joinToken} authRedirect={authRedirect} />
  }

  if (
    authRedirect &&
    authRedirect.purpose !== 'signup' &&
    cloudConfig &&
    !cloudConfigError
  ) {
    return <InviteSetupPage redirect={authRedirect} />
  }

  if (cloudConfigError) {
    return (
      <CloudFrame>
        <CloudConfigurationProblem message={cloudConfigError.message} />
      </CloudFrame>
    )
  }

  if (!cloudConfig) {
    return (
      <CloudFrame>
        <CloudConfigurationProblem message="VITE_SUPABASE_URL und VITE_SUPABASE_PUBLISHABLE_KEY fehlen." />
      </CloudFrame>
    )
  }

  return (
    <AuthProvider>
      <CloudAuthenticatedApp />
    </AuthProvider>
  )
}
