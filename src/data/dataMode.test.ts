import { describe, expect, it } from 'vitest'
import { parseDataMode, resolveDataMode } from './dataMode'

describe('parseDataMode', () => {
  it('ist ohne Wert lokal – auch wenn Supabase-Konfiguration vorhanden wäre', () => {
    expect(parseDataMode(undefined)).toBe('local')
    expect(parseDataMode('')).toBe('local')
    expect(parseDataMode('   ')).toBe('local')
  })

  it('akzeptiert local und cloud unabhängig von Groß-/Kleinschreibung', () => {
    expect(parseDataMode('local')).toBe('local')
    expect(parseDataMode(' CLOUD ')).toBe('cloud')
    expect(parseDataMode('Cloud')).toBe('cloud')
  })

  it('lehnt unbekannte Modi ab, statt still lokal zu starten', () => {
    expect(() => parseDataMode('auto')).toThrow(/VITE_DATA_MODE/)
    expect(() => parseDataMode('true')).toThrow(/VITE_DATA_MODE/)
  })
})

describe('resolveDataMode', () => {
  it('liefert den Modus ohne Fehler', () => {
    expect(resolveDataMode('cloud')).toEqual({ mode: 'cloud', error: null })
  })

  it('liefert bei ungültigem Wert einen Konfigurationsfehler', () => {
    const result = resolveDataMode('remote')
    expect(result.mode).toBe('local')
    expect(result.error).toMatch(/VITE_DATA_MODE/)
  })
})
