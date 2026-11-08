/*
 * openCook Web
 * Copyright (C) 2026 openCook Web contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Compact recipe chooser used inside the planning panel. It reuses the
 * existing recipe records, the library filter helper and the existing image
 * table; no new search, import or data layer is introduced.
 */

import { useMemo } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../db'
import { resolveOriginalServings } from '../../domain/scaling'
import { effectiveDuration, formatPortionCount } from '../../lib/format'
import { matchesRecipeFilters } from '../../recipe/editor'
import type { Recipe } from '../../types'
import { useImageUrl } from '../../lib/useImageUrl'

export interface RecipeCoverProps {
  recipe: Recipe
  className?: string
}

/** Compact cover; recipes without an image get an equal-sized initial tile. */
export function RecipeCover({ recipe, className = '' }: RecipeCoverProps) {
  const cover = useLiveQuery(
    () =>
      db.images
        .where('recipeId')
        .equals(recipe.id)
        .sortBy('position')
        .then((images) => images[0]),
    [recipe.id],
  )
  const url = useImageUrl(cover?.bytes, cover?.mimeType)
  const initial = recipe.title.trim().charAt(0).toLocaleUpperCase('de') || '?'

  return (
    <span
      className={`plan-cover${url ? ' has-image' : ''} ${className}`.trim()}
      aria-hidden="true"
    >
      {url ? (
        <img src={url} alt="" loading="lazy" decoding="async" />
      ) : (
        <span className="plan-cover-initial">{initial}</span>
      )}
    </span>
  )
}

function recipeMeta(recipe: Recipe): string {
  const parts: string[] = []
  const duration = effectiveDuration(recipe)
  if (duration) parts.push(duration)
  const original = resolveOriginalServings(recipe)
  if (original !== null) parts.push(formatPortionCount(original))
  if (parts.length === 0) parts.push(...recipe.categories.slice(0, 2))
  return parts.join(' · ')
}

export interface RecipePickerProps {
  recipes: Recipe[]
  query: string
  onQueryChange: (value: string) => void
  selectedRecipeId?: string | null
  onChoose: (recipeId: string) => void
}

export function RecipePicker({
  recipes,
  query,
  onQueryChange,
  selectedRecipeId,
  onChoose,
}: RecipePickerProps) {
  const filtered = useMemo(
    () =>
      query.trim()
        ? recipes.filter((recipe) =>
            matchesRecipeFilters(recipe, { search: query }),
          )
        : recipes,
    [recipes, query],
  )

  if (recipes.length === 0) {
    return (
      <div className="plan-picker">
        <div className="recipe-picker-empty">
          <p className="muted small">Noch keine Rezepte vorhanden.</p>
          <a className="button primary" href="#/recipe/new">
            Neues Rezept
          </a>
        </div>
      </div>
    )
  }

  return (
    <div className="plan-picker">
      <div className="plan-picker-search">
        <label className="search-field">
          <span className="visually-hidden">Rezepte durchsuchen</span>
          <input
            type="search"
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="Rezept oder Zutat suchen …"
            autoComplete="off"
            data-autofocus
            autoFocus
          />
        </label>
        <p className="plan-picker-count" aria-live="polite">
          {filtered.length} von {recipes.length}
        </p>
      </div>

      {filtered.length === 0 ? (
        <div className="plan-picker-empty">
          <p className="muted small">Keine Rezepte gefunden.</p>
          <button
            type="button"
            className="button quiet"
            onClick={() => onQueryChange('')}
          >
            Suche zurücksetzen
          </button>
        </div>
      ) : (
        <ul className="plan-picker-list">
          {filtered.map((recipe) => (
            <li key={recipe.id}>
              <button
                type="button"
                className={`plan-picker-card${
                  recipe.id === selectedRecipeId ? ' is-selected' : ''
                }`}
                aria-label={`${recipe.title} auswählen`}
                onClick={() => onChoose(recipe.id)}
              >
                <RecipeCover recipe={recipe} className="plan-picker-cover" />
                <span className="plan-picker-text">
                  <span className="plan-picker-title">{recipe.title}</span>
                  <span className="plan-picker-meta">{recipeMeta(recipe)}</span>
                </span>
                <span className="plan-picker-chevron" aria-hidden="true">
                  ›
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
