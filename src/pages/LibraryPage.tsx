import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db'
import type { Recipe } from '../types'
import { RecipeCard } from '../components/RecipeCard'
import { useImageUrl } from '../components/Markdown'
import { filterValues, matchesRecipeFilters } from '../recipe/editor'
import { LIBRARY_SORT_OPTIONS, sortRecipes, type LibrarySort } from '../recipe/library'

function RecipeCardWithCover({ recipe }: { recipe: Recipe }) {
  const cover = useLiveQuery(
    () => db.images.where('recipeId').equals(recipe.id).sortBy('position').then((images) => images[0]),
    [recipe.id],
  )
  const url = useImageUrl(cover?.bytes, cover?.mimeType)
  return <RecipeCard recipe={recipe} coverUrl={url} />
}

function FilterSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: string
  options: string[]
  onChange: (value: string) => void
}) {
  return (
    <label className={`select-field${value ? ' is-active' : ''}`}>
      <span className="visually-hidden">{label}</span>
      <select
        className={value ? 'is-active' : ''}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-label={label}
      >
        <option value="">{label}</option>
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  )
}

export function LibraryPage() {
  const recipes = useLiveQuery(() => db.recipes.orderBy('updatedAt').reverse().toArray(), [])
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('')
  const [cuisine, setCuisine] = useState('')
  const [dishType, setDishType] = useState('')
  const [effort, setEffort] = useState('')
  const [tag, setTag] = useState('')
  const [sort, setSort] = useState<LibrarySort>('az')

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
        matchesRecipeFilters(recipe, { search: query, category, cuisine, dishType, effort, tag }),
      ),
    [recipes, query, category, cuisine, dishType, effort, tag],
  )

  const visible = useMemo(() => sortRecipes(filtered, sort), [filtered, sort])

  const hasFilters = Boolean(query || category || cuisine || dishType || effort || tag)
  const activeFilterCount = [category, cuisine, dishType, effort, tag].filter(Boolean).length

  function clearFilters() {
    setQuery('')
    setCategory('')
    setCuisine('')
    setDishType('')
    setEffort('')
    setTag('')
  }

  return (
    <div className="page">
      <header className="page-head library-head">
        <div>
          <h1>Rezeptbibliothek</h1>
          <p className="library-count">
            {recipes === undefined
              ? 'Lade Rezepte …'
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
          <a className="button quiet" href="#/import">
            Import
          </a>
          <a className="button quiet" href="#/backup">
            Backup
          </a>
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
          <label className="sort-field">
            <span className="visually-hidden">Sortierung</span>
            <span className="sort-icon" aria-hidden="true">
              <svg
                viewBox="0 0 16 16"
                width="15"
                height="15"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              >
                <path d="M5 3v10M5 13l-2.2-2.2M5 13l2.2-2.2M11 13V3M11 3 8.8 5.2M11 3l2.2 2.2" />
              </svg>
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
            <button type="button" className="filter-reset" onClick={clearFilters}>
              Zurücksetzen
            </button>
          ) : null}
        </div>

        <div className="filter-bar">
          <FilterSelect label="Kategorie" value={category} options={categories} onChange={setCategory} />
          <FilterSelect label="Küche" value={cuisine} options={cuisines} onChange={setCuisine} />
          <FilterSelect label="Gerichtstyp" value={dishType} options={dishTypes} onChange={setDishType} />
          <FilterSelect label="Aufwand" value={effort} options={efforts} onChange={setEffort} />
          <FilterSelect label="Tag" value={tag} options={tags} onChange={setTag} />
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
        <p className="empty-state">Lade …</p>
      ) : recipes.length === 0 ? (
        <div className="empty-state">
          <p>Noch keine Rezepte gespeichert.</p>
          <p className="muted">
            Importiere eine Mela-Datei (<code>.melarecipe</code> oder <code>.melarecipes</code>) oder
            lege ein Rezept manuell an. Alles bleibt lokal im Browser.
          </p>
          <div className="notice-actions">
            <a className="button primary" href="#/import">
              Zum Import
            </a>
            <a className="button" href="#/recipe/new">
              Neues Rezept
            </a>
          </div>
        </div>
      ) : filtered.length === 0 ? (
        <div className="empty-state">
          <p>Keine Treffer.</p>
          <button type="button" className="button" onClick={clearFilters}>
            Filter zurücksetzen
          </button>
        </div>
      ) : (
        <div className="recipe-grid">
          {visible.map((recipe) => (
            <RecipeCardWithCover key={recipe.id} recipe={recipe} />
          ))}
        </div>
      )}
    </div>
  )
}
