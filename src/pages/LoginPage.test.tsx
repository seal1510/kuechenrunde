import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { LoginPage } from './LoginPage'

describe('LoginPage', () => {
  it('zeigt E-Mail, Passwort und keine Registrierung', () => {
    const html = renderToStaticMarkup(<LoginPage onSubmit={() => {}} />)

    expect(html).toContain('E-Mail-Adresse')
    expect(html).toContain('type="email"')
    expect(html.toLowerCase()).toContain('autocomplete="email"')
    expect(html).toContain('type="password"')
    expect(html.toLowerCase()).toContain('autocomplete="current-password"')
    expect(html).toContain('Anmelden')
    expect(html).toContain('keine öffentliche Registrierung')
    expect(html).not.toContain('Konto erstellen')
    expect(html).not.toContain('Registrieren</button>')
    expect(html).not.toContain('Passwort vergessen')
  })

  it('zeigt einen Fehler als Alert und deaktiviert die Eingaben im Busy-Zustand', () => {
    const html = renderToStaticMarkup(
      <LoginPage
        onSubmit={() => {}}
        busy
        error="E-Mail oder Passwort ist falsch."
      />,
    )

    expect(html).toContain('E-Mail oder Passwort ist falsch.')
    expect(html).toContain('role="alert"')
    expect(html).toContain('Anmeldung läuft')
    expect(html).toMatch(/<input[^>]*disabled/)
    expect(html).toMatch(/<button[^>]*disabled/)
  })
})
