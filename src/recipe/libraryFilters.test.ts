/*
 * Küchenrunde – mobile filter state tests
 * Copyright (C) 2026 openCook Web contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, expect, it } from 'vitest'
import type { Recipe } from '../types'
import { matchesRecipeFilters } from './editor'
import {
  EMPTY_LIBRARY_FILTERS,
  LIBRARY_SORT_SHORT_LABELS,
  activeLibraryFilters,
  libraryFilterCount,
  removeLibraryFilter,
  resetLibraryFilters,
} from './libraryFilters'

function recipe(overrides: Partial<Recipe> = {}): Recipe {
  return {
    id: 'r1',
    importId: 'mela-r1',
    importSource: 'mela',
    title: 'Pasta',
    description: '',
    ingredientGroups: [],
    ingredients: [],
    instructions: [],
    servingsText: '2',
    servingsNumber: 2,
    prepTime: '',
    cookTime: '',
    totalTime: '',
    categories: ['Hauptgericht'],
    cuisine: ['Italienisch'],
    dishType: ['Pasta'],
    effort: 'einfach',
    tags: ['schnell'],
    notes: '',
    nutrition: '',
    sourceUrl: '',
    favorite: false,
    wantToCook: false,
    melaDate: null,
    raw: {},
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }
}

describe('mobile library filters', () => {
  it('combines several active filters and reports their count', () => {
    const filters = {
      ...EMPTY_LIBRARY_FILTERS,
      category: 'Hauptgericht',
      cuisine: 'Italienisch',
      tag: 'schnell',
    }

    expect(activeLibraryFilters(filters).map((filter) => filter.key)).toEqual([
      'category',
      'cuisine',
      'tag',
    ])
    expect(libraryFilterCount(filters)).toBe(3)
    expect(
      matchesRecipeFilters(recipe(), {
        search: '',
        category: filters.category,
        cuisine: filters.cuisine,
        tag: filters.tag,
      }),
    ).toBe(true)
  })

  it('removes exactly one chip and leaves the other filters active', () => {
    const filters = {
      ...EMPTY_LIBRARY_FILTERS,
      category: 'Hauptgericht',
      cuisine: 'Italienisch',
      effort: 'einfach',
    }

    const next = removeLibraryFilter(filters, 'cuisine')

    expect(next.cuisine).toBe('')
    expect(next.category).toBe('Hauptgericht')
    expect(next.effort).toBe('einfach')
    expect(activeLibraryFilters(next).map((filter) => filter.key)).toEqual([
      'category',
      'effort',
    ])
  })

  it('clears all filters for "Alle zurücksetzen" without touching other state', () => {
    const filters = {
      ...EMPTY_LIBRARY_FILTERS,
      category: 'Hauptgericht',
      cuisine: 'Italienisch',
      dishType: 'Pasta',
      effort: 'einfach',
      tag: 'schnell',
    }

    expect(resetLibraryFilters()).toEqual(EMPTY_LIBRARY_FILTERS)
    expect(activeLibraryFilters(filters)).toHaveLength(5)
  })

  it('keeps a short label for every existing sort option', () => {
    expect(LIBRARY_SORT_SHORT_LABELS).toEqual({
      az: 'A–Z',
      created: 'Neueste',
      updated: 'Geändert',
      duration: 'Dauer',
    })
  })
})
