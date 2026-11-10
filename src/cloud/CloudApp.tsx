/*
 * Küchenrunde – Cloud-Oberfläche
 * Copyright (C) 2026 openCook Web contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Bewusst keine lokale Bibliothek und keine Navigation: Im Cloud-Modus wird
 * nach dem Bootstrap nur der Bereitschaftszustand gezeigt. Die vorhandenen
 * Seiten bleiben ausschließlich im lokalen Modus aktiv.
 */

import { AuthProvider, useAuth } from '../auth/AuthProvider'
import { cloudConfig, cloudConfigError } from '../supabase/client'
import { CloudStatus } from './CloudStatus'

function CloudGate() {
  const { state, signIn, logout, retry } = useAuth()
  return (
    <CloudStatus
      state={state}
      onSignIn={signIn}
      onRetry={retry}
      onLogout={logout}
    />
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

export function CloudApp() {
  return (
    <div className="app-shell cloud-shell">
      <header className="app-header">
        <div className="app-header-inner">
          <div className="brand">
            <span className="brand-mark" aria-hidden="true">
              kr
            </span>
            <span>
              <strong>Küchenrunde</strong>
              <small className="brand-subtitle">Familien-Cloud</small>
            </span>
          </div>
          <span className="cloud-mode-badge">Cloud-Modus</span>
        </div>
      </header>

      <main className="app-main">
        {cloudConfigError ? (
          <CloudConfigurationProblem message={cloudConfigError.message} />
        ) : !cloudConfig ? (
          <CloudConfigurationProblem message="VITE_SUPABASE_URL und VITE_SUPABASE_PUBLISHABLE_KEY fehlen." />
        ) : (
          <AuthProvider>
            <CloudGate />
          </AuthProvider>
        )}
      </main>

      <footer className="app-footer">
        <span>Familien-Cloud · Supabase</span>
        <span>Abmelden beendet die Sitzung und den Realtime-Kanal.</span>
      </footer>
    </div>
  )
}
