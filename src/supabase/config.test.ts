import { describe, expect, it } from 'vitest'
import { CloudConfigError, parseCloudConfig } from './config'

function jwt(payload: Record<string, unknown>): string {
  const encode = (value: unknown): string =>
    Buffer.from(JSON.stringify(value), 'utf8').toString('base64url')
  return `${encode({ alg: 'none', typ: 'JWT' })}.${encode(payload)}.signature`
}

const URL_OK = 'https://abcdefghijklm.supabase.co'
const KEY_OK = 'sb_publishable_abcdefghijklmnopqrstuvwxyz'

describe('parseCloudConfig', () => {
  it('liefert null, wenn keine Cloud-Konfiguration gesetzt ist', () => {
    expect(parseCloudConfig({})).toBeNull()
  })

  it('akzeptiert eine reine HTTPS-Projekt-URL und normalisiert den Schrägstrich', () => {
    expect(
      parseCloudConfig({
        VITE_SUPABASE_URL: `${URL_OK}/`,
        VITE_SUPABASE_ANON_KEY: KEY_OK,
      }),
    ).toEqual({ url: URL_OK, anonKey: KEY_OK })
  })

  it('erlaubt HTTP nur für localhost', () => {
    expect(
      parseCloudConfig({
        VITE_SUPABASE_URL: 'http://localhost:54321',
        VITE_SUPABASE_ANON_KEY: KEY_OK,
      })?.url,
    ).toBe('http://localhost:54321')

    expect(() =>
      parseCloudConfig({
        VITE_SUPABASE_URL: 'http://example.com',
        VITE_SUPABASE_ANON_KEY: KEY_OK,
      }),
    ).toThrow(CloudConfigError)
  })

  it('verlangt URL und Key gemeinsam', () => {
    expect(() =>
      parseCloudConfig({ VITE_SUPABASE_URL: URL_OK }),
    ).toThrow(/unvollständig/)
    expect(() =>
      parseCloudConfig({ VITE_SUPABASE_ANON_KEY: KEY_OK }),
    ).toThrow(/unvollständig/)
  })

  it('lehnt Pfade, Query und Zugangsdaten in der URL ab', () => {
    for (const url of [
      'https://abcdefgh.supabase.co/rest/v1',
      'https://abcdefgh.supabase.co/?x=1',
      'https://user:pass@abcdefgh.supabase.co',
    ]) {
      expect(() =>
        parseCloudConfig({ VITE_SUPABASE_URL: url, VITE_SUPABASE_ANON_KEY: KEY_OK }),
      ).toThrow(CloudConfigError)
    }
  })

  it('lehnt Platzhalter aus .env.example ab', () => {
    expect(() =>
      parseCloudConfig({
        VITE_SUPABASE_URL: 'https://your-project-ref.supabase.co',
        VITE_SUPABASE_ANON_KEY: KEY_OK,
      }),
    ).toThrow(/Platzhalter/)
  })

  it('lehnt neue Secret-Keys ab', () => {
    expect(() =>
      parseCloudConfig({
        VITE_SUPABASE_URL: URL_OK,
        VITE_SUPABASE_ANON_KEY: 'sb_secret_abcdefghijklmnopqrstuvwxyz',
      }),
    ).toThrow(/service_role/)
  })

  it('lehnt einen service_role-JWT ab, ohne den Schlüssel zu wiederholen', () => {
    const key = jwt({ role: 'service_role', iss: 'supabase' })
    let message = ''
    try {
      parseCloudConfig({ VITE_SUPABASE_URL: URL_OK, VITE_SUPABASE_ANON_KEY: key })
    } catch (error) {
      message = (error as Error).message
    }
    expect(message).toMatch(/service_role/)
    expect(message).not.toContain(key)
  })

  it('akzeptiert einen klassischen anon-JWT', () => {
    const key = jwt({ role: 'anon', iss: 'supabase' })
    expect(
      parseCloudConfig({ VITE_SUPABASE_URL: URL_OK, VITE_SUPABASE_ANON_KEY: key })?.anonKey,
    ).toBe(key)
  })

  it('lehnt zu kurze Schlüssel ab', () => {
    expect(() =>
      parseCloudConfig({ VITE_SUPABASE_URL: URL_OK, VITE_SUPABASE_ANON_KEY: 'kurz' }),
    ).toThrow(/zu kurz/)
  })
})
