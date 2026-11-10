import { describe, expect, it } from 'vitest'
import { isDefaultExcludedIngredient } from './defaultExclusions'

describe('default ingredient exclusions', () => {
  it('matches complete staple names and their obvious equivalents', () => {
    for (const name of [
      'Wasser',
      'Leitungswasser',
      'Salz',
      'Speisesalz',
      'Meersalz',
      'Pfeffer',
      'schwarzer Pfeffer',
      'frisch gemahlener Pfeffer',
      'Salz und Pfeffer',
      'Salz und schwarzer Pfeffer',
      'Olivenöl',
      'natives Olivenöl extra',
      'Öl',
      'Pflanzenöl',
      'Rapsöl',
      'Sonnenblumenöl',
      'Zucker',
      'weißer Zucker',
      'Haushaltszucker',
      'Salz/Pfeffer',
      'etwas Salz',
      'ein wenig Pfeffer',
      'Olivenöl (nach Bedarf)',
      'Olivenöl zum Anbraten',
      'Olivenöl, kaltgepresst',
      'Öl (neutral)',
      'etwas Olivenöl',
    ]) {
      expect(isDefaultExcludedIngredient(name), name).toBe(true)
    }
  })

  it('never excludes similar but different products', () => {
    for (const name of [
      'Cayennepfeffer',
      'Chiliöl',
      'Sesamöl',
      'Kreuzkümmel',
      'Kurkuma',
      'Koriander',
      'Korianderpulver',
      'Kräuter',
      'Salzstangen',
      'Mineralwasser',
      'brauner Zucker',
      'Puderzucker',
      'Vanillezucker',
      'Salz und Pfeffer Gewürzmischung',
      'Tomaten',
      'etwas Cayennepfeffer',
      'Olivenöl mit Chili',
      'Aromatisiertes Olivenöl',
      'Knoblauchöl',
      'Öl, Ghee oder Butterschmalz',
    ]) {
      expect(isDefaultExcludedIngredient(name), name).toBe(false)
    }
  })

  it('uses the full product identity including a variant', () => {
    expect(isDefaultExcludedIngredient('Pfeffer', 'schwarz')).toBe(true)
    expect(isDefaultExcludedIngredient('Salz', 'fein')).toBe(true)
    expect(isDefaultExcludedIngredient('Zucker', 'braun')).toBe(false)
    expect(isDefaultExcludedIngredient('Öl', 'Sesam')).toBe(false)
  })
})
