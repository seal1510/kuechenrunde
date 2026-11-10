import { useEffect, useMemo, useState } from 'react'
import { Markdown } from '../components/Markdown'
import { RecipeBody } from '../components/RecipeCard'
import { RecipeImageGallery } from '../components/RecipeImageGallery'
import type { CloudRecordsStore } from '../data/cloudRecords'
import { todayKey } from '../domain/dates'
import { formatDuration, effectiveDuration } from '../lib/format'
import { usePlanBackend } from '../mealplan/planBackend'
import { DishDialog } from '../pages/plan/DishDialog'
import { calendarSettingsFromRows } from '../settings/calendar'
import type { Recipe } from '../types'
import { useCloudImageUrls } from './CloudImageProvider'
import { useCloudRecipe, useCloudRecipeImages } from './useCloudRecipes'

function CloudPlanDishDialog({
  recipe,
  onDone,
  onClose,
}: {
  recipe: Recipe
  onDone: () => void
  onClose: () => void
}) {
  const backend = usePlanBackend()
  const data = backend.usePlanData()
  const weekStartDay = calendarSettingsFromRows(data?.settings ?? []).weekStartDay
  return (
    <DishDialog
      mode="create"
      initialDate={todayKey()}
      initialRecipeId={recipe.id}
      initialEntries={[]}
      recipes={[recipe]}
      weekStartDay={weekStartDay}
      cookModeEnabled={backend.cookModeEnabled}
      renderCover={backend.renderRecipeCover}
      onDone={onDone}
      onClose={onClose}
    />
  )
}

function servingsValue(recipe: Recipe): string {
  const text = recipe.servingsText.trim()
  if (/^\d+(\s*[-–]\s*\d+)?$/.test(text)) return text.replace(/\s*[-–]\s*/, '–')
  if (recipe.servingsNumber !== null && recipe.servingsNumber > 0) {
    return String(recipe.servingsNumber)
  }
  return text.replace(/\s*(portionen?|personen?|servings?)$/i, '').trim()
}

export function CloudRecipeDetailPage({
  store,
  id,
}: {
  store: CloudRecordsStore
  id: string
}) {
  const row = useCloudRecipe(store, id)
  const images = useCloudRecipeImages(store, id)
  const [planning, setPlanning] = useState(false)
  const [planSaved, setPlanSaved] = useState(false)

  useEffect(() => {
    setPlanning(false)
    setPlanSaved(false)
  }, [id])
  const imagePaths = useMemo(
    () => (images ?? []).map((image) => image.storagePath),
    [images],
  )
  const imageUrls = useCloudImageUrls(imagePaths)
  const galleryImages = useMemo(
    () =>
      (images ?? []).map((image) => ({
        id: image.id,
        url: imageUrls[image.storagePath]?.url ?? null,
        error: imageUrls[image.storagePath]?.error,
        status: imageUrls[image.storagePath]?.status ?? 'loading',
      })),
    [images, imageUrls],
  )

  if (row === undefined) {
    return (
      <div className="page">
        <p className="empty-state">Lade Rezept …</p>
      </div>
    )
  }

  if (row === null) {
    return (
      <div className="page">
        <div className="empty-state">
          <p>Rezept nicht gefunden.</p>
          <a className="button" href="#/">
            Zur Bibliothek
          </a>
        </div>
      </div>
    )
  }

  const recipe = row.data
  const totalTime = effectiveDuration(recipe)
  const prep = formatDuration(recipe.prepTime)
  const cook = formatDuration(recipe.cookTime)
  const servings = servingsValue(recipe)
  const facts = [
    totalTime ? { label: 'Gesamtzeit', value: totalTime } : null,
    prep ? { label: 'Vorbereitung', value: prep } : null,
    cook ? { label: 'Kochzeit', value: cook } : null,
    servings ? { label: 'Portionen', value: servings } : null,
  ].filter((fact): fact is { label: string; value: string } => fact !== null)
  const labels = Array.from(
    new Set([...recipe.cuisine, ...recipe.dishType, ...recipe.categories]),
  )

  return (
    <div className="page detail-page">
      <div className="detail-topbar">
        <a className="back-link" href="#/">
          <svg
            viewBox="0 0 16 16"
            width="14"
            height="14"
            aria-hidden="true"
            focusable="false"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M12.5 8h-9M7 3.5 2.5 8 7 12.5" />
          </svg>
          Zur Bibliothek
        </a>
        <div className="detail-topbar-actions">
          <a
            className="button quiet detail-edit"
            href={`#/recipe/${encodeURIComponent(recipe.id)}/edit`}
            aria-label="Rezept bearbeiten"
          >
            Bearbeiten
          </a>
        </div>
      </div>

      <header className={`recipe-header${galleryImages.length > 0 ? '' : ' no-image'}`}>
        <div className="recipe-heading">
          {labels.length > 0 ? <p className="recipe-kicker">{labels.join(' · ')}</p> : null}
          <h1>{recipe.title}</h1>
          {facts.length > 0 ? (
            <dl className="recipe-facts">
              {facts.map((fact) => (
                <div className="recipe-fact" key={fact.label}>
                  <dt className="fact-label">{fact.label}</dt>
                  <dd className="fact-value">{fact.value}</dd>
                </div>
              ))}
            </dl>
          ) : null}
          <div className="recipe-actions">
            <button
              type="button"
              className="button primary detail-plan"
              onClick={() => {
                setPlanSaved(false)
                setPlanning(true)
              }}
            >
              <svg
                viewBox="0 0 16 16"
                width="14"
                height="14"
                aria-hidden="true"
                focusable="false"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <rect x="2.2" y="3.2" width="11.6" height="10.4" rx="1.6" />
                <path d="M5 1.8v3M11 1.8v3M2.2 6.3h11.6M5.4 9.2h.1M8 9.2h.1M10.6 9.2h.1M5.4 11.5h.1M8 11.5h.1" />
              </svg>
              Einplanen
            </button>
          </div>
          {recipe.description ? (
            <div className="recipe-description">
              <Markdown text={recipe.description} />
            </div>
          ) : null}
        </div>

        {galleryImages.length > 0 ? (
          <div className="recipe-cover">
            <RecipeImageGallery images={galleryImages} />
          </div>
        ) : null}
      </header>

      <RecipeBody recipe={recipe} />

      {planSaved ? (
        <p className="notice success plan-saved-notice" role="status">
          Eingeplant. Der Wochenplan wurde aktualisiert.
        </p>
      ) : null}

      <nav className="detail-mobile-actions" aria-label="Rezeptaktionen">
        <button
          type="button"
          className="button primary"
          onClick={() => {
            setPlanSaved(false)
            setPlanning(true)
          }}
        >
          Einplanen
        </button>
      </nav>

      <p className="muted small">
        Kochmodus und Einkaufsliste sind im Cloud-Modus noch nicht verfügbar.
        Rezeptbibliothek, Bilder und Wochenplan funktionieren bereits
        geräteübergreifend.
      </p>

      {planning ? (
        <CloudPlanDishDialog
          recipe={recipe}
          onDone={() => {
            setPlanning(false)
            setPlanSaved(true)
          }}
          onClose={() => setPlanning(false)}
        />
      ) : null}
    </div>
  )
}
