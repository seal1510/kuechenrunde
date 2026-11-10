/*
 * Küchenrunde – Cloud-Statusanzeige
 * Copyright (C) 2026 openCook Web contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Rein darstellend: bekommt den Session-Zustand und drei Aktionen. Dadurch
 * lassen sich alle Zustände ohne Provider und ohne DOM statisch testen.
 */

import type { ReactNode } from 'react'
import type { CloudSessionState } from '../auth/cloudSession'
import { LoginPage } from '../pages/LoginPage'

export interface CloudStatusProps {
  state: CloudSessionState
  onSignIn: (email: string, password: string) => void | Promise<void>
  onRetry: () => void | Promise<void>
  onLogout: () => void | Promise<void>
}

function StatusCard({ children }: { children: ReactNode }) {
  return (
    <div className="page cloud-page">
      <section className="panel cloud-card">{children}</section>
    </div>
  )
}

export function CloudStatus({
  state,
  onSignIn,
  onRetry,
  onLogout,
}: CloudStatusProps) {
  if (state.status === 'signed-out') {
    return <LoginPage onSubmit={onSignIn} error={state.error} />
  }
  if (state.status === 'signing-in') {
    return <LoginPage onSubmit={onSignIn} busy />
  }
  if (state.status === 'checking') {
    return (
      <StatusCard>
        <p className="cloud-eyebrow">Familien-Cloud</p>
        <h1>Verbindung wird geprüft …</h1>
        <p className="muted" role="status">
          Die vorhandene Sitzung wird geladen.
        </p>
      </StatusCard>
    )
  }
  if (state.status === 'loading') {
    return (
      <StatusCard>
        <p className="cloud-eyebrow">Familien-Cloud</p>
        <h1>Cloud-Daten werden geladen …</h1>
        <p className="muted" role="status">
          Angemeldet als {state.email}. Der gemeinsame Snapshot wird geladen.
        </p>
        <div className="cloud-actions">
          <button type="button" className="button quiet" onClick={() => void onLogout()}>
            Abmelden
          </button>
        </div>
      </StatusCard>
    )
  }
  if (state.status === 'membership-missing') {
    return (
      <StatusCard>
        <p className="cloud-eyebrow">Familien-Cloud</p>
        <h1>Kein Zugang zum Familienhaushalt</h1>
        <p>
          Das Konto <strong>{state.email}</strong> ist noch keinem
          Familienhaushalt zugeordnet. Bitte den Betreiber, dich freizuschalten.
        </p>
        <div className="cloud-actions">
          <button type="button" className="button primary" onClick={() => void onRetry()}>
            Erneut prüfen
          </button>
          <button type="button" className="button quiet" onClick={() => void onLogout()}>
            Abmelden
          </button>
        </div>
      </StatusCard>
    )
  }
  if (state.status === 'error') {
    return (
      <StatusCard>
        <p className="cloud-eyebrow">Familien-Cloud</p>
        <h1>Cloud-Daten nicht erreichbar</h1>
        <p>{state.message}</p>
        {state.email ? (
          <p className="muted">Angemeldet als {state.email}.</p>
        ) : null}
        <div className="cloud-actions">
          <button type="button" className="button primary" onClick={() => void onRetry()}>
            Erneut versuchen
          </button>
          <button type="button" className="button quiet" onClick={() => void onLogout()}>
            Abmelden
          </button>
        </div>
      </StatusCard>
    )
  }

  return (
    <StatusCard>
      <p className="cloud-eyebrow">Familien-Cloud</p>
      <h1>Cloud verbunden</h1>
      <p className="muted">Angemeldet als {state.email}.</p>
      <dl className="cloud-counts">
        <div>
          <dt>Rezepte</dt>
          <dd>{state.counts.recipes}</dd>
        </div>
        <div>
          <dt>Essenstermine</dt>
          <dd>{state.counts.mealPlans}</dd>
        </div>
        <div>
          <dt>Einkaufslisten</dt>
          <dd>{state.counts.shoppingLists}</dd>
        </div>
        <div>
          <dt>Käufe</dt>
          <dd>{state.counts.shoppingPurchases}</dd>
        </div>
      </dl>
      <p>
        Der gemeinsame Snapshot ist geladen. Die Rezeptbibliothek, Wochenplanung
        und Einkaufsliste werden in der nächsten Etappe angebunden. Es werden
        noch keine lokalen Dexie-Daten als Cloud-Bestand angezeigt.
      </p>
      <div className="cloud-actions">
        <button type="button" className="button quiet" onClick={() => void onLogout()}>
          Abmelden
        </button>
      </div>
    </StatusCard>
  )
}
