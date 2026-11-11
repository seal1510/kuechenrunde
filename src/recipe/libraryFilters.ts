/*
 * Küchenrunde – recipe library filter state
 * Copyright (C) 2026 openCook Web contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Pure helpers for the filter chips and the mobile filter sheet. Filtering
 * itself stays in `matchesRecipeFilters`; this module only names and removes
 * the values that are already active. That keeps the mobile presentation from
 * becoming a second filter implementation.
 */

import type { LibrarySort } from './library'

export type LibraryFilterKey =
  | 'category'
  | 'cuisine'
  | 'dishType'
  | 'effort'
  | 'tag'

export interface LibraryFilters {
  category: string
  cuisine: string
  dishType: string
  effort: string
  tag: string
}

export const EMPTY_LIBRARY_FILTERS: LibraryFilters = {
  category: '',
  cuisine: '',
  dishType: '',
  effort: '',
  tag: '',
}

export const LIBRARY_FILTER_LABELS: Record<LibraryFilterKey, string> = {
  category: 'Kategorie',
  cuisine: 'Küche',
  dishType: 'Gerichtstyp',
  effort: 'Aufwand',
  tag: 'Tag',
}

export interface ActiveLibraryFilter {
  key: LibraryFilterKey
  label: string
  value: string
}

export function activeLibraryFilters(filters: LibraryFilters): ActiveLibraryFilter[] {
  return (Object.keys(LIBRARY_FILTER_LABELS) as LibraryFilterKey[])
    .filter((key) => filters[key] !== '')
    .map((key) => ({
      key,
      label: LIBRARY_FILTER_LABELS[key],
      value: filters[key],
    }))
}

export function libraryFilterCount(filters: LibraryFilters): number {
  return activeLibraryFilters(filters).length
}

export function removeLibraryFilter(
  filters: LibraryFilters,
  key: LibraryFilterKey,
): LibraryFilters {
  return { ...filters, [key]: '' }
}

export function resetLibraryFilters(): LibraryFilters {
  return { ...EMPTY_LIBRARY_FILTERS }
}

/** Short labels so the current sort stays readable next to the search field. */
export const LIBRARY_SORT_SHORT_LABELS: Record<LibrarySort, string> = {
  az: 'A–Z',
  created: 'Neueste',
  updated: 'Geändert',
  duration: 'Dauer',
}
