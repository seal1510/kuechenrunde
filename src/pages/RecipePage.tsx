import { useEffect, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db'
import type { RecipeImage } from '../types'
import { RecipeBody } from '../components/RecipeCard'
import { Markdown, useImageUrl } from '../components/Markdown'
import { effectiveDuration, formatDuration } from '../lib/format'
import { cookHash } from '../routing/routes'

function ImageThumb({
  image,
  active,
  onSelect,
}: {
  image: RecipeImage
  active: boolean
  onSelect: () => void
}) {
  const url = useImageUrl(image.bytes, image.mimeType)
  return (
    <button
      type="button"
      className={`thumb${active ? ' active' : ''}`}
      onClick={onSelect}
      aria-label={`Bild ${image.position + 1} anzeigen`}
      aria-pressed={active}
    >
      {url ? <img src={url} alt="" /> : null}
    </button>
  )
}

function MainImage({ image }: { image: RecipeImage | undefined }) {
  const url = useImageUrl(image?.bytes, image?.mimeType)
  if (!url) return null
  return <img className="detail-image" src={url} alt="" />
}

function servingsValue(recipe: { servingsText: string; servingsNumber: number | null }): string {
  const text = recipe.servingsText.trim()
  if (/^\d+(\s*[-–]\s*\d+)?$/.test(text)) return text.replace(/\s*[-–]\s*/, '–')
  if (recipe.servingsNumber !== null && recipe.servingsNumber > 0) return String(recipe.servingsNumber)
  return text.replace(/\s*(portionen?|personen?|servings?)$/i, '').trim()
}

function sourceLabel(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

export function RecipePage({ id }: { id: string }) {
  const data = useLiveQuery(async () => ({ recipe: await db.recipes.get(id) }), [id])
  const images = useLiveQuery(
    () => db.images.where('recipeId').equals(id).sortBy('position'),
    [id],
  )
  const [activeImage, setActiveImage] = useState(0)

  useEffect(() => {
    setActiveImage(0)
  }, [id])

  const recipe = data?.recipe
  const sortedImages = useMemo(
    () => [...(images ?? [])].sort((a, b) => a.position - b.position),
    [images],
  )

  if (!data) {
    return (
      <div className="page">
        <p className="empty-state">Lade Rezept …</p>
      </div>
    )
  }

  if (!recipe) {
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
  const hasImage = sortedImages.length > 0
  const hasMeta = Boolean(recipe.effort || recipe.sourceUrl)

  return (
    <div className="page detail-page">
      <div className="detail-topbar">
        <a className="back-link" href="#/">
          ← Zur Bibliothek
        </a>
        <div className="detail-topbar-actions">
          <a
            className="button primary detail-cook"
            href={cookHash(recipe.id)}
          >
            Kochen
          </a>
          <a className="button detail-edit" href={`#/recipe/${encodeURIComponent(recipe.id)}/edit`}>
            Bearbeiten
          </a>
        </div>
      </div>

      <header className={`recipe-header${hasImage ? '' : ' no-image'}`}>
        <div className="recipe-heading">
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
          {recipe.description ? (
            <div className="recipe-description">
              <Markdown text={recipe.description} />
            </div>
          ) : null}
          {labels.length > 0 ? <p className="recipe-labels">{labels.join(' · ')}</p> : null}
          {recipe.favorite || recipe.wantToCook || recipe.tags.length > 0 ? (
            <div className="badges recipe-badges">
              {recipe.favorite ? <span className="badge">★ Favorit</span> : null}
              {recipe.wantToCook ? <span className="badge subtle">Möchte ich kochen</span> : null}
              {recipe.tags.map((entry) => (
                <span key={`tag-${entry}`} className="badge subtle">
                  #{entry}
                </span>
              ))}
            </div>
          ) : null}
          {hasMeta ? (
            <div className="recipe-meta">
              {recipe.effort ? <span>Aufwand: {recipe.effort}</span> : null}
              {recipe.sourceUrl ? (
                <span className="source-link">
                  Quelle:{' '}
                  {/^https?:\/\//i.test(recipe.sourceUrl) ? (
                    <a href={recipe.sourceUrl} target="_blank" rel="noreferrer noopener">
                      {sourceLabel(recipe.sourceUrl)}
                    </a>
                  ) : (
                    recipe.sourceUrl
                  )}
                </span>
              ) : null}
            </div>
          ) : null}
        </div>

        {hasImage ? (
          <div className="recipe-cover">
            <div className="gallery">
              <MainImage image={sortedImages[activeImage]} />
              {sortedImages.length > 1 ? (
                <div className="thumbs">
                  {sortedImages.map((image, index) => (
                    <ImageThumb
                      key={image.id}
                      image={image}
                      active={index === activeImage}
                      onSelect={() => setActiveImage(index)}
                    />
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        ) : null}
      </header>

      <RecipeBody recipe={recipe} />
    </div>
  )
}
