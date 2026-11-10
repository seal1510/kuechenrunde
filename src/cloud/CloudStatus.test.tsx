import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { CloudSessionState } from '../auth/cloudSession'
import { CloudStatus } from './CloudStatus'

const noop = () => {}

function render(state: CloudSessionState): string {
  return renderToStaticMarkup(
    <CloudStatus
      state={state}
      onSignIn={noop}
      onRetry={noop}
      onLogout={noop}
    />,
  )
}

describe('CloudStatus', () => {
  it('zeigt im abgemeldeten Zustand das Login', () => {
    const html = render({ status: 'signed-out', error: null })
    expect(html).toContain('Anmelden')
    expect(html).toContain('E-Mail-Adresse')
  })

  it('zeigt die fehlende Mitgliedschaft mit beiden Aktionen', () => {
    const html = render({
      status: 'membership-missing',
      email: 'familie@example.org',
    })
    expect(html).toContain('Kein Zugang zum Familienhaushalt')
    expect(html).toContain('familie@example.org')
    expect(html).toContain('Erneut prüfen')
    expect(html).toContain('Abmelden')
  })

  it('zeigt Ladefehler mit Meldung, Wiederholung und Abmeldung', () => {
    const html = render({
      status: 'error',
      email: 'familie@example.org',
      message: 'Netzwerk nicht erreichbar.',
    })
    expect(html).toContain('Cloud-Daten nicht erreichbar')
    expect(html).toContain('Netzwerk nicht erreichbar.')
    expect(html).toContain('Erneut versuchen')
    expect(html).toContain('Abmelden')
  })

  it('zeigt den Ladezustand mit der angemeldeten E-Mail', () => {
    const html = render({ status: 'loading', email: 'familie@example.org' })
    expect(html).toContain('Cloud-Daten werden geladen')
    expect(html).toContain('familie@example.org')
    expect(html).toContain('Abmelden')
  })

  it('zeigt nach dem Bootstrap nur den Cloud-Bereitschaftszustand', () => {
    const html = render({
      status: 'ready',
      email: 'familie@example.org',
      counts: {
        recipes: 2,
        mealPlans: 3,
        shoppingLists: 1,
        shoppingPurchases: 4,
      },
    })

    expect(html).toContain('Cloud verbunden')
    expect(html).toContain('familie@example.org')
    expect(html).toContain('Es werden')
    expect(html).toContain('Abmelden')
    expect(html).not.toContain('Lokal im Browser gespeichert')
    expect(html).not.toContain('main-nav')
    expect(html).not.toContain('href="#/plan"')
  })
})
