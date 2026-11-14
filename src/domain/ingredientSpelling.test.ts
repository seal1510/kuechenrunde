/*
 * Küchenrunde – Integrationstest Katalog-Schreibweisen → Sprachkorrektur
 * Copyright (C) 2026 openCook Web contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, expect, it } from 'vitest'
import { applyOcrLanguageCorrections, validateOcrRecipe } from '../import/photo-ocr'
import { catalogSpellingLabels } from './ingredientSpelling'

describe('catalogSpellingLabels', () => {
  it('liefert die etablierten Namen des Zutatenkatalogs und cached sie', () => {
    const labels = catalogSpellingLabels()
    expect(labels).toBe(catalogSpellingLabels())
    expect(labels).toContain('Pfefferminze')
    expect(labels).toContain('Ingwer')
    expect(labels).toContain('Minze')
  })
})

describe('Sprachkorrektur mit echtem Zutatenkatalog', () => {
  const labels = catalogSpellingLabels()

  function correct(name: string): string {
    const recipe = validateOcrRecipe({
      recognized: true,
      title: 'Testrezept',
      ingredients: [{ name }],
      steps: [{ text: `Mit ${name} bestreuen.` }],
    })
    return applyOcrLanguageCorrections(recipe, '', labels).recipe.ingredients[0]!.name
  }

  it('korrigiert die im echten Handschrift-Test beobachteten Fehlschreibweisen', () => {
    // Aus echten Gemma-4-Erkennungen des Tandoori-Fotos.
    expect(correct('Pfefferminz')).toBe('Pfefferminze')
    expect(correct('Pfefferminte')).toBe('Pfefferminze')
  })

  it('ersetzt keine unbekannten Marken- oder Produktnamen', () => {
    expect(correct('tandoori Sherwood-Mischung')).toBe('tandoori Sherwood-Mischung')
    expect(correct('Pomito Tomatenfruchtfleisch')).toBe('Pomito Tomatenfruchtfleisch')
    expect(correct('Basmatireis')).toBe('Basmatireis')
  })

  it('lässt exakt bekannte Schreibweisen unangetastet', () => {
    expect(correct('Pfefferminzblätter')).toBe('Pfefferminzblätter')
    expect(correct('Zwiebel')).toBe('Zwiebel')
  })

  it('korrigiert dieselbe Fehlschreibweise auch im Schritttext', () => {
    const recipe = validateOcrRecipe({
      recognized: true,
      title: 'Testrezept',
      ingredients: [{ name: 'Pfefferminz' }],
      steps: [{ text: 'Die Pfefferminte darüberstreuen.' }],
    })
    const result = applyOcrLanguageCorrections(recipe, '', labels)
    expect(result.recipe.ingredients[0]!.name).toBe('Pfefferminze')
    expect(result.recipe.steps[0]!.text).toBe('Die Pfefferminze darüberstreuen.')
  })
})
