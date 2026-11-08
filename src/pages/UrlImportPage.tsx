import { useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { RecipeForm } from '../components/RecipeForm'
import { extractRecipeCandidates, type UrlRecipeCandidate } from '../import/jsonld'
import { normalizeHttpUrl } from '../import/url'
import {
  buildUrlRecipe,
  downloadCandidateImages,
  draftFromUrlCandidate,
  duplicateSummary,
  findUrlImportDuplicates,
  type UrlDuplicateInfo,
  type UrlImportContext,
} from '../import/url-import'
import {
  defaultRecipeFetcher,
  RecipeFetchError,
} from '../import/url-fetcher'
import { saveRecipeWithImages, type EditorImage } from '../recipe/repository'
import type { RecipeDraft } from '../recipe/editor'

type Status = 'idle' | 'fetching' | 'ready' | 'saving' | 'saved'

interface UrlInspection {
  originalUrl: string
  finalUrl: string
  fetchedAt: number
  candidates: UrlRecipeCandidate[]
  warnings: string[]
  jsonLdBlockCount: number
  recipeObjectCount: number
}

function uniqueWarnings(...groups: string[][]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const group of groups) {
    for (const warning of group) {
      if (seen.has(warning)) continue
      seen.add(warning)
      result.push(warning)
    }
  }
  return result
}

export function UrlImportPage() {
  const [urlInput, setUrlInput] = useState('')
  const [status, setStatus] = useState<Status>('idle')
  const [error, setError] = useState('')
  const [serviceGap, setServiceGap] = useState(false)
  const [manualFallback, setManualFallback] = useState(false)
  const [inspection, setInspection] = useState<UrlInspection | null>(null)
  const [selected, setSelected] = useState(0)
  const [draft, setDraft] = useState<RecipeDraft | null>(null)
  const [images, setImages] = useState<EditorImage[]>([])
  const [imageWarnings, setImageWarnings] = useState<string[]>([])
  const [imageStatus, setImageStatus] = useState<'idle' | 'loading' | 'done'>('idle')
  const [duplicate, setDuplicate] = useState<UrlDuplicateInfo | null>(null)
  const [allowDuplicate, setAllowDuplicate] = useState(false)
  const [saved, setSaved] = useState<{ id: string; title: string } | null>(null)
  const selectionToken = useRef(0)

  const candidate = inspection?.candidates[selected] ?? null
  const candidateWarnings = candidate ? candidate.warnings : []
  const allWarnings = uniqueWarnings(inspection?.warnings ?? [], candidateWarnings, imageWarnings)
  const isExactDuplicate = Boolean(duplicate?.exact)
  const saveBlocked = isExactDuplicate && !allowDuplicate

  function resetResult() {
    setInspection(null)
    setDraft(null)
    setImages([])
    setImageWarnings([])
    setImageStatus('idle')
    setDuplicate(null)
    setAllowDuplicate(false)
    setSaved(null)
    setSelected(0)
    selectionToken.current += 1
  }

  async function presentCandidate(
    result: UrlInspection,
    index: number,
    token: number,
  ) {
    const nextCandidate = result.candidates[index]
    if (!nextCandidate) return
    const context: UrlImportContext = {
      originalUrl: result.originalUrl,
      finalUrl: result.finalUrl,
      fetchedAt: result.fetchedAt,
      candidate: nextCandidate,
    }
    setDraft(draftFromUrlCandidate(context))
    setImages([])
    setImageWarnings([])
    setDuplicate(null)
    setAllowDuplicate(false)
    setImageStatus(nextCandidate.images.length > 0 ? 'loading' : 'done')

    const duplicates = await findUrlImportDuplicates(result.finalUrl, nextCandidate.key)
    if (selectionToken.current !== token) return
    setDuplicate(duplicates)

    if (nextCandidate.images.length === 0) return
    const downloaded = await downloadCandidateImages(nextCandidate.images, defaultRecipeFetcher)
    if (selectionToken.current !== token) return
    setImages(downloaded.images)
    setImageWarnings(downloaded.warnings)
    setImageStatus('done')
  }

  async function selectCandidate(index: number) {
    if (!inspection) return
    setSelected(index)
    const token = selectionToken.current + 1
    selectionToken.current = token
    await presentCandidate(inspection, index, token)
  }

  async function handleFetch(event: FormEvent) {
    event.preventDefault()
    const normalized = normalizeHttpUrl(urlInput)
    if (!normalized) {
      setError('Bitte eine gültige öffentliche HTTP(S)-URL eingeben.')
      setManualFallback(false)
      setServiceGap(false)
      return
    }
    setStatus('fetching')
    setError('')
    setServiceGap(false)
    setManualFallback(false)
    resetResult()

    try {
      const page = await defaultRecipeFetcher.fetchPage(normalized)
      const extraction = extractRecipeCandidates(page.html, page.finalUrl)
      const result: UrlInspection = {
        originalUrl: normalized,
        finalUrl: page.finalUrl,
        fetchedAt: Date.now(),
        candidates: extraction.candidates,
        warnings: extraction.warnings,
        jsonLdBlockCount: extraction.jsonLdBlockCount,
        recipeObjectCount: extraction.recipeObjectCount,
      }
      setInspection(result)
      setUrlInput(page.finalUrl)

      if (result.candidates.length === 0) {
        setDraft(null)
        setStatus('ready')
        setManualFallback(true)
        setError(
          extraction.jsonLdBlockCount === 0
            ? 'Auf dieser Seite wurden keine strukturierten Rezeptdaten (schema.org/Recipe in JSON-LD) gefunden. Es wird bewusst kein Seitentext als Rezept geraten.'
            : 'Die JSON-LD-Daten dieser Seite enthalten kein Rezept. Es wird bewusst kein Seitentext als Rezept geraten.',
        )
        return
      }

      setStatus('ready')
      const token = selectionToken.current + 1
      selectionToken.current = token
      setSelected(0)
      await presentCandidate(result, 0, token)
    } catch (cause) {
      setStatus('idle')
      setManualFallback(true)
      if (cause instanceof RecipeFetchError) {
        setError(cause.message)
        setServiceGap(cause.code === 'unavailable')
      } else {
        setError((cause as Error).message || 'Die Seite konnte nicht abgerufen werden.')
      }
    }
  }

  async function handleSave(event: FormEvent) {
    event.preventDefault()
    if (!draft || !inspection || !candidate) return
    if (!draft.title.trim()) {
      setError('Bitte einen Titel eingeben, bevor das Rezept importiert wird.')
      return
    }
    if (saveBlocked) return
    if (imageStatus === 'loading') {
      setError('Bitte warten, bis die Bilder geprüft wurden.')
      return
    }
    setStatus('saving')
    setError('')
    try {
      const recipe = buildUrlRecipe({
        draft,
        context: {
          originalUrl: inspection.originalUrl,
          finalUrl: inspection.finalUrl,
          fetchedAt: inspection.fetchedAt,
          candidate,
        },
        imageWarnings,
      })
      await saveRecipeWithImages(recipe, images)
      setSaved({ id: recipe.id, title: recipe.title })
      setStatus('saved')
    } catch (cause) {
      setStatus('ready')
      setError((cause as Error).message || 'Das Rezept konnte nicht gespeichert werden.')
    }
  }

  function cancelImport() {
    resetResult()
    setStatus('idle')
    setError('')
    setManualFallback(false)
    setServiceGap(false)
  }

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Rezept per URL importieren</h1>
          <p className="muted">
            Webseite abrufen, erkanntes Rezept prüfen, korrigieren und erst dann lokal speichern.
          </p>
        </div>
        <div className="page-head-actions">
          <a className="button" href="#/import">
            Mela-Import
          </a>
          <a className="button quiet" href="#/">
            Zur Bibliothek
          </a>
        </div>
      </header>

      <section className="panel">
        <h2>Webseite abrufen</h2>
        <p className="muted small">
          Der Abruf läuft über den lokalen, abgesicherten Importdienst. Es werden keine Cookies oder
          Zugangsdaten an fremde Seiten gesendet. Fremde Seitenskripte werden nicht ausgeführt.
        </p>
        <form className="url-input-row" onSubmit={handleFetch}>
          <input
            type="url"
            value={urlInput}
            onChange={(event) => setUrlInput(event.target.value)}
            placeholder="https://beispiel.de/rezept"
            aria-label="Rezept-URL"
            disabled={status === 'fetching' || status === 'saving'}
          />
          <button
            type="submit"
            className="button primary"
            disabled={status === 'fetching' || status === 'saving'}
          >
            {status === 'fetching' ? 'Rufe ab …' : 'Abrufen & prüfen'}
          </button>
        </form>
        <p className="muted small">
          Primär werden schema.org/Recipe-Daten aus JSON-LD gelesen. Seiten ohne solche Daten werden
          nicht automatisch als Rezept interpretiert.
        </p>
      </section>

      {error ? (
        <div className="notice danger" role="alert">
          <p>{error}</p>
          {serviceGap ? (
            <p className="muted small">
              In der Entwicklung wird der Dienst vom Vite-Server bereitgestellt. Für einen
              Produktivbetrieb ist ein separat abgesichertes Backend nötig; die Anwendung führt
              bewusst keinen direkten Browser-Fetch aus.
            </p>
          ) : null}
          {manualFallback ? (
            <div className="notice-actions">
              <a className="button" href="#/recipe/new">
                Rezept manuell anlegen
              </a>
            </div>
          ) : null}
        </div>
      ) : null}

      {inspection && inspection.candidates.length > 0 ? (
        <section className="panel">
          <h2>Gefundene Rezepte</h2>
          <p className="muted">
            {inspection.candidates.length} Rezept{inspection.candidates.length === 1 ? '' : 'e'} in
            den strukturierten Daten erkannt. Die Vorschau ist bearbeitbar; gespeichert wird erst
            nach Bestätigung.
          </p>
          {inspection.candidates.length > 1 ? (
            <ul className="candidate-list">
              {inspection.candidates.map((entry, index) => (
                <li key={`${entry.key}-${index}`}>
                  <label className={index === selected ? 'candidate is-selected' : 'candidate'}>
                    <input
                      type="radio"
                      name="recipe-candidate"
                      checked={index === selected}
                      onChange={() => void selectCandidate(index)}
                    />
                    <span>
                      <strong>{entry.title || 'Unbenanntes Rezept'}</strong>
                      <span className="muted small">
                        {' '}
                        · {entry.ingredients.length} Zutaten · {entry.instructions.length} Schritte
                        {entry.images.length > 0 ? ` · ${entry.images.length} Bild(er)` : ''}
                      </span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}

      {duplicate && (duplicate.exact || duplicate.sameSource.length > 0) ? (
        <section className="panel">
          <h2>Hinweis zur Quelle</h2>
          <div className={duplicate.exact ? 'notice danger' : 'notice'}>
            <p>{duplicateSummary(duplicate)}</p>
            {duplicate.exact ? (
              <p>
                Bestehendes Rezept:{' '}
                <a href={`#/recipe/${encodeURIComponent(duplicate.exact.id)}`}>{duplicate.exact.title}</a>
                . Es wird nicht automatisch überschrieben.
              </p>
            ) : null}
            {duplicate.sameSource.length > 0 ? (
              <ul>
                {duplicate.sameSource.map((recipe) => (
                  <li key={recipe.id}>
                    <a href={`#/recipe/${encodeURIComponent(recipe.id)}`}>{recipe.title}</a>
                  </li>
                ))}
              </ul>
            ) : null}
            {duplicate.exact ? (
              <label className="check-field">
                <input
                  type="checkbox"
                  checked={allowDuplicate}
                  onChange={(event) => setAllowDuplicate(event.target.checked)}
                />
                Trotzdem als neues, separates Rezept importieren
              </label>
            ) : null}
          </div>
        </section>
      ) : null}

      {imageStatus === 'loading' ? (
        <div className="notice" aria-live="polite">
          Bilder werden über den lokalen Dienst geprüft und geladen …
        </div>
      ) : null}

      {inspection && allWarnings.length > 0 ? (
        <details className="notice">
          <summary>{allWarnings.length} Hinweis(e) zum Import</summary>
          <ul>
            {allWarnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </details>
      ) : null}

      {saved ? (
        <section className="panel" aria-live="polite">
          <h2>Import abgeschlossen</h2>
          <p>
            <strong>{saved.title}</strong> wurde lokal gespeichert.
          </p>
          <div className="notice-actions">
            <a className="button primary" href={`#/recipe/${encodeURIComponent(saved.id)}`}>
              Rezept öffnen
            </a>
            <button type="button" className="button" onClick={cancelImport}>
              Weiteres Rezept importieren
            </button>
          </div>
        </section>
      ) : null}

      {draft && !saved ? (
        <>
          <section className="panel import-actions">
            <div>
              <h2>Importvorschau</h2>
              <p className="muted small">
                Quelle: {inspection?.finalUrl} · Alle Felder können vor dem Speichern korrigiert
                werden.
              </p>
            </div>
            <div className="notice-actions">
              <button type="button" className="button" onClick={cancelImport} disabled={status === 'saving'}>
                Abbrechen
              </button>
              <button
                type="submit"
                form="url-import-form"
                className="button primary"
                disabled={status === 'saving' || saveBlocked || imageStatus === 'loading'}
              >
                {status === 'saving' ? 'Speichere …' : 'Rezept importieren'}
              </button>
            </div>
          </section>

          {saveBlocked ? (
            <div className="notice danger">
              Dieses Rezept ist bereits von dieser URL vorhanden. Setze oben die Bestätigung, um
              bewusst eine zweite Kopie anzulegen.
            </div>
          ) : null}

          <RecipeForm
            formId="url-import-form"
            draft={draft}
            onChange={setDraft}
            images={images}
            onImagesChange={setImages}
            onSubmit={handleSave}
            categoriesNote="aus schema.org recipeCategory (als Gerichtstyp übernommen)"
          />
        </>
      ) : null}
    </div>
  )
}
