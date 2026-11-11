/*
 * Küchenrunde – gemeinsame Rezeptbibliotheks-Ansicht
 * Copyright (C) 2026 openCook Web contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Die Ansicht enthält Suche, Filter, Sortierung und das Grid. Sie ist
 * datenquellenunabhängig: Der lokale Modus liefert Dexie-Rezepte, der
 * Cloud-Modus denselben Snapshot aus Supabase. Dadurch gibt es keine zweite
 * Rezeptbibliothek.
 *
 * Auf dem iPhone bleiben nur Suche, Filter- und Sortierknopf dauerhaft
 * sichtbar. Die fünf Filter liegen in einem Bottom-Sheet, aktive Filter
 * erscheinen als einzeln entfernbare Chips. Desktop behält die bisherige
 * Filterleiste.
 */

import { Fragment, useEffect, useMemo, useState, type ReactNode } from 'react'
import { BottomSheet } from '../components/BottomSheet'
import { usePhoneLayout } from '../lib/phoneLayout'
import type { Recipe } from '../types'
import { URL_IMPORT_HASH } from '../routing/routes'
import { filterValues, matchesRecipeFilters } from './editor'
import {
  EMPTY_LIBRARY_FILTERS,
  LIBRARY_FILTER_LABELS,
  LIBRARY_SORT_SHORT_LABELS,
  activeLibraryFilters,
  libraryFilterCount,
  removeLibraryFilter,
  resetLibraryFilters,
  type LibraryFilterKey,
  type LibraryFilters,
} from './libraryFilters'
import { LIBRARY_SORT_OPTIONS, sortRecipes, type LibrarySort } from './library'

function FilterSelect({
  label,
  value,
  options,
  onChange,
  showLabel = false,
}: {
  label: string
  value: string
  options: string[]
  onChange: (value: string) => void
  showLabel?: boolean
}) {
  return (
    <label className={`select-field${value ? ' is-active' : ''}`}>
      <span className={showLabel ? 'library-sheet-filter-label' : 'visually-hidden'}>
        {label}
      </span>
      <select
        className={value ? 'is-active' : ''}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-label={label}
      >
        <option value="">{showLabel ? 'Alle' : label}</option>
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  )
}

function FilterIcon() {
  return (
    <svg
      viewBox="0 0 20 20"
      width="16"
      height="16"
      aria-hidden="true"
      focusable="false"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3.5 5h13M5.5 10h9M8 15h4" />
    </svg>
  )
}

function SortIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      width="15"
      height="15"
      aria-hidden="true"
      focusable="false"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
    >
      <path d="M5 3v10M5 13l-2.2-2.2M5 13l2.2-2.2M11 13V3M11 3 8.8 5.2M11 3l2.2 2.2" />
    </svg>
  )
}

export interface LibraryFilterSheetProps {
  open: boolean
  onClose: () => void
  filters: LibraryFilters
  categories: string[]
  cuisines: string[]
  dishTypes: string[]
  efforts: string[]
  tags: string[]
  resultCount: number
  totalCount: number
  onFilterChange: (key: LibraryFilterKey, value: string) => void
  onReset: () => void
}

export function LibraryFilterSheet({
  open,
  onClose,
  filters,
  categories,
  cuisines,
  dishTypes,
  efforts,
  tags,
  resultCount,
  totalCount,
  onFilterChange,
  onReset,
}: LibraryFilterSheetProps) {
  return (
    <BottomSheet
      open={open}
      title="Filter"
      description="Mehrere Filter lassen sich kombinieren."
      onClose={onClose}
      closeLabel="Filter schließen"
      className="library-filter-sheet"
      id="library-filter-sheet"
    >
      <p className="library-sheet-result" role="status" aria-live="polite">
        {resultCount} von {totalCount} Rezepten
      </p>

      <div className="library-sheet-filters">
        <FilterSelect
          showLabel
          label={LIBRARY_FILTER_LABELS.category}
          value={filters.category}
          options={categories}
          onChange={(value) => onFilterChange('category', value)}
        />
        <FilterSelect
          showLabel
          label={LIBRARY_FILTER_LABELS.cuisine}
          value={filters.cuisine}
          options={cuisines}
          onChange={(value) => onFilterChange('cuisine', value)}
        />
        <FilterSelect
          showLabel
          label={LIBRARY_FILTER_LABELS.dishType}
          value={filters.dishType}
          options={dishTypes}
          onChange={(value) => onFilterChange('dishType', value)}
        />
        <FilterSelect
          showLabel
          label={LIBRARY_FILTER_LABELS.effort}
          value={filters.effort}
          options={efforts}
          onChange={(value) => onFilterChange('effort', value)}
        />
        <FilterSelect
          showLabel
          label={LIBRARY_FILTER_LABELS.tag}
          value={filters.tag}
          options={tags}
          onChange={(value) => onFilterChange('tag', value)}
        />
      </div>

      <div className="bottom-sheet-actions">
        <button type="button" className="button quiet" onClick={onReset}>
          Alle zurücksetzen
        </button>
        <button type="button" className="button primary" onClick={onClose}>
          Fertig
        </button>
      </div>
    </BottomSheet>
  )
}

export interface LibrarySortSheetProps {
  open: boolean
  sort: LibrarySort
  onClose: () => void
  onChange: (sort: LibrarySort) => void
}

export function LibrarySortSheet({
  open,
  sort,
  onClose,
  onChange,
}: LibrarySortSheetProps) {
  return (
    <BottomSheet
      open={open}
      title="Sortierung"
      onClose={onClose}
      closeLabel="Sortierung schließen"
      className="library-sort-sheet"
      id="library-sort-sheet"
    >
      <div
        className="library-sort-options"
        role="radiogroup"
        aria-label="Sortierung wählen"
      >
        {LIBRARY_SORT_OPTIONS.map((option) => {
          const selected = option.value === sort
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={selected}
              className={`library-sort-option${selected ? ' is-selected' : ''}`}
              onClick={() => onChange(option.value)}
            >
              <span>{option.label}</span>
              {selected ? (
                <span className="library-sort-check" aria-hidden="true">
                  ✓
                </span>
              ) : null}
            </button>
          )
        })}
      </div>
    </BottomSheet>
  )
}

export interface LibraryFilterChipsProps {
  filters: LibraryFilters
  onRemove: (key: LibraryFilterKey) => void
  onReset: () => void
}

export function LibraryFilterChips({
  filters,
  onRemove,
  onReset,
}: LibraryFilterChipsProps) {
  const activeFilters = activeLibraryFilters(filters)
  if (activeFilters.length === 0) return null

  return (
    <div className="library-filter-chips" aria-label="Aktive Filter">
      {activeFilters.map((filter) => (
        <button
          key={filter.key}
          type="button"
          className="library-filter-chip"
          aria-label={`${filter.label}: ${filter.value} entfernen`}
          onClick={() => onRemove(filter.key)}
        >
          <span className="library-filter-chip-text">
            {filter.label}: {filter.value}
          </span>
          <span className="library-filter-chip-x" aria-hidden="true">
            ×
          </span>
        </button>
      ))}
      <button type="button" className="library-filter-clear" onClick={onReset}>
        Alle zurücksetzen
      </button>
    </div>
  )
}

export interface RecipeLibraryViewProps {
  recipes: Recipe[] | undefined
  renderRecipeCard: (recipe: Recipe) => ReactNode
  cloudMode?: boolean
}

export function RecipeLibraryView({
  recipes,
  renderRecipeCard,
  cloudMode = false,
}: RecipeLibraryViewProps) {
  const [query, setQuery] = useState('')
  const [filters, setFilters] = useState<LibraryFilters>(() => ({
    ...EMPTY_LIBRARY_FILTERS,
  }))
  const [sort, setSort] = useState<LibrarySort>('az')
  const [filterOpen, setFilterOpen] = useState(false)
  const [sortOpen, setSortOpen] = useState(false)
  const phoneLayout = usePhoneLayout()

  useEffect(() => {
    if (phoneLayout) return
    setFilterOpen(false)
    setSortOpen(false)
  }, [phoneLayout])

  const categories = useMemo(() => {
    const all = new Set<string>()
    for (const recipe of recipes ?? []) {
      for (const entry of recipe.categories) all.add(entry)
    }
    return Array.from(all).sort((a, b) => a.localeCompare(b, 'de'))
  }, [recipes])

  const cuisines = useMemo(() => filterValues(recipes ?? [], 'cuisine'), [recipes])
  const dishTypes = useMemo(() => filterValues(recipes ?? [], 'dishType'), [recipes])
  const efforts = useMemo(() => filterValues(recipes ?? [], 'effort'), [recipes])
  const tags = useMemo(() => filterValues(recipes ?? [], 'tag'), [recipes])

  const filtered = useMemo(
    () =>
      (recipes ?? []).filter((recipe) =>
        matchesRecipeFilters(recipe, { search: query, ...filters }),
      ),
    [recipes, query, filters],
  )

  const visible = useMemo(() => sortRecipes(filtered, sort), [filtered, sort])

  const activeFilterCount = libraryFilterCount(filters)
  const hasFilters = Boolean(query || activeFilterCount)
  const sortLabel =
    LIBRARY_SORT_OPTIONS.find((option) => option.value === sort)?.label ?? 'A–Z'

  function changeFilter(key: LibraryFilterKey, value: string) {
    setFilters((current) => ({ ...current, [key]: value }))
  }

  function resetFilters() {
    setFilters(resetLibraryFilters())
  }

  function removeFilter(key: LibraryFilterKey) {
    setFilters((current) => removeLibraryFilter(current, key))
  }

  function resetAll() {
    setQuery('')
    resetFilters()
  }

  return (
    <div className="page library-page">
      <header className="page-head library-head">
        <div>
          <h1>Rezeptbibliothek</h1>
          <p className="library-count">
            {recipes === undefined
              ? cloudMode
                ? 'Lade Cloud-Rezepte …'
                : 'Lade Rezepte …'
              : `${recipes.length} ${recipes.length === 1 ? 'Rezept' : 'Rezepte'} in deiner Sammlung`}
          </p>
        </div>
        <div className="page-head-actions">
          <a className="button primary" href="#/recipe/new">
            <svg
              viewBox="0 0 16 16"
              aria-hidden="true"
              focusable="false"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
            >
              <path d="M8 3.2v9.6M3.2 8h9.6" />
            </svg>
            Neues Rezept
          </a>
          {cloudMode ? (
            <>
              <a className="button quiet library-action-secondary" href={URL_IMPORT_HASH}>
                URL-Import
              </a>
              <a className="button quiet library-action-secondary" href="#/import">
                Mela-Import
              </a>
              <a className="button quiet library-action-secondary" href="#/backup">
                Backup
              </a>
            </>
          ) : (
            <>
              <a className="button quiet library-action-secondary" href="#/import">
                Import
              </a>
              <a className="button quiet library-action-secondary" href="#/backup">
                Backup
              </a>
            </>
          )}
          {/*
           * The desktop keeps all direct actions above. On phones the two
           * import routes are folded into one "Import" menu and Backup moves
           * to the "Mehr" sheet.
           */}
          <details className="library-import-menu">
            <summary className="button quiet">Import</summary>
            <div className="library-import-options">
              <a className="library-import-option" href={URL_IMPORT_HASH}>
                <strong>URL-Rezeptimport</strong>
                <span>Rezept von einer Webseite übernehmen</span>
              </a>
              <a className="library-import-option" href="#/import">
                <strong>Mela-Import</strong>
                <span>Mela-Datei auswählen und prüfen</span>
              </a>
            </div>
          </details>
        </div>
      </header>

      <section className="library-controls" aria-label="Rezepte durchsuchen, filtern und sortieren">
        <div className="library-search-row">
          <label className="search-field library-search">
            <span className="visually-hidden">Rezepte durchsuchen</span>
            <span className="search-icon" aria-hidden="true">
              <svg viewBox="0 0 20 20" width="16" height="16" focusable="false">
                <circle cx="9" cy="9" r="5.25" fill="none" stroke="currentColor" strokeWidth="1.6" />
                <path
                  d="M13 13l3.4 3.4"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                />
              </svg>
            </span>
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Rezepte durchsuchen"
            />
          </label>

          <div className="library-mobile-actions" role="group" aria-label="Filter und Sortierung">
            <button
              type="button"
              className={`library-control-button${activeFilterCount > 0 ? ' is-active' : ''}`}
              aria-haspopup="dialog"
              aria-expanded={filterOpen}
              aria-controls={filterOpen ? 'library-filter-sheet' : undefined}
              aria-label={
                activeFilterCount > 0
                  ? `Filter, ${activeFilterCount} aktiv`
                  : 'Filter'
              }
              onClick={() => setFilterOpen(true)}
            >
              <FilterIcon />
              <span className="library-control-label">Filter</span>
              {activeFilterCount > 0 ? (
                <span className="library-filter-badge" aria-hidden="true">
                  {activeFilterCount}
                </span>
              ) : null}
            </button>
            <button
              type="button"
              className="library-control-button library-sort-button"
              aria-haspopup="dialog"
              aria-expanded={sortOpen}
              aria-controls={sortOpen ? 'library-sort-sheet' : undefined}
              aria-label={`Sortierung ändern, aktuell ${sortLabel}`}
              onClick={() => setSortOpen(true)}
            >
              <SortIcon />
              <span className="library-control-label">
                {LIBRARY_SORT_SHORT_LABELS[sort]}
              </span>
            </button>
          </div>

          <label className="sort-field">
            <span className="visually-hidden">Sortierung</span>
            <span className="sort-icon" aria-hidden="true">
              <SortIcon />
            </span>
            <select
              value={sort}
              onChange={(event) => setSort(event.target.value as LibrarySort)}
              aria-label="Sortierung"
            >
              {LIBRARY_SORT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          {hasFilters ? (
            <button type="button" className="filter-reset" onClick={resetAll}>
              Zurücksetzen
            </button>
          ) : null}
        </div>

        <LibraryFilterChips
          filters={filters}
          onRemove={removeFilter}
          onReset={resetFilters}
        />

        <div className="filter-bar">
          <FilterSelect
            label="Kategorie"
            value={filters.category}
            options={categories}
            onChange={(value) => changeFilter('category', value)}
          />
          <FilterSelect
            label="Küche"
            value={filters.cuisine}
            options={cuisines}
            onChange={(value) => changeFilter('cuisine', value)}
          />
          <FilterSelect
            label="Gerichtstyp"
            value={filters.dishType}
            options={dishTypes}
            onChange={(value) => changeFilter('dishType', value)}
          />
          <FilterSelect
            label="Aufwand"
            value={filters.effort}
            options={efforts}
            onChange={(value) => changeFilter('effort', value)}
          />
          <FilterSelect
            label="Tag"
            value={filters.tag}
            options={tags}
            onChange={(value) => changeFilter('tag', value)}
          />
        </div>

        <div className="filter-summary" role="status" aria-live="polite">
          <span>
            {filtered.length} von {recipes?.length ?? 0} Rezepten
          </span>
          {activeFilterCount > 0 ? (
            <span className="filter-active-count">{activeFilterCount} Filter aktiv</span>
          ) : null}
        </div>
      </section>

      {recipes === undefined ? (
        <p className="empty-state">{cloudMode ? 'Lade Cloud-Rezepte …' : 'Lade …'}</p>
      ) : recipes.length === 0 ? (
        <div className="empty-state">
          <p>{cloudMode ? 'Noch keine Cloud-Rezepte gespeichert.' : 'Noch keine Rezepte gespeichert.'}</p>
          <p className="muted">
            {cloudMode
              ? 'Lege dein erstes Rezept an. Die gemeinsame Bibliothek steht allen Familienmitgliedern zur Verfügung.'
              : 'Importiere eine Mela-Datei (.melarecipe oder .melarecipes) oder lege ein Rezept manuell an. Alles bleibt lokal im Browser.'}
          </p>
          <div className="notice-actions">
            {cloudMode ? (
              <>
                <a className="button library-empty-import" href={URL_IMPORT_HASH}>
                  Rezept per URL importieren
                </a>
                <a className="button library-empty-import" href="#/import">
                  Mela-Datei importieren
                </a>
              </>
            ) : (
              <a className="button library-empty-import" href="#/import">
                Zum Import
              </a>
            )}
            <a className="button primary" href="#/recipe/new">
              Neues Rezept
            </a>
          </div>
        </div>
      ) : filtered.length === 0 ? (
        <div className="empty-state">
          <p>Keine Treffer.</p>
          <button type="button" className="button" onClick={resetAll}>
            Filter zurücksetzen
          </button>
        </div>
      ) : (
        <div className="recipe-grid">
          {visible.map((recipe) => (
            <Fragment key={recipe.id}>{renderRecipeCard(recipe)}</Fragment>
          ))}
        </div>
      )}

      <LibraryFilterSheet
        open={filterOpen}
        onClose={() => setFilterOpen(false)}
        filters={filters}
        categories={categories}
        cuisines={cuisines}
        dishTypes={dishTypes}
        efforts={efforts}
        tags={tags}
        resultCount={filtered.length}
        totalCount={recipes?.length ?? 0}
        onFilterChange={changeFilter}
        onReset={resetFilters}
      />

      <LibrarySortSheet
        open={sortOpen}
        sort={sort}
        onClose={() => setSortOpen(false)}
        onChange={(next) => {
          setSort(next)
          setSortOpen(false)
        }}
      />
    </div>
  )
}
