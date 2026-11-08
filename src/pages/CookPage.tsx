/*
 * openCook Web
 * Copyright (C) 2026 openCook Web contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Focused cook mode. Only the current step is in focus; the recipe is never
 * modified and reaching the last step never marks a cooking event as cooked.
 */

import { useEffect, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db'
import { formatPortionCount } from '../lib/format'
import {
  resolveOriginalServings,
  scaleRecipeIngredients,
  scaledIngredientLine,
} from '../domain/scaling'
import { renderRecipeInstructions } from '../recipe/references'
import {
  loadCookProgress,
  pruneOrphanedCookProgress,
  saveCookProgress,
} from '../mealplan/cookProgress'
import { Markdown } from '../components/Markdown'
import type { Recipe } from '../types'

interface CookData {
  recipe: Recipe | null
  sessionServings: number | null
  sessionId: string | null
  sessionMissing: boolean
  /** A database/loading failure must not crash the whole app. */
  loadError: string | null
}

function normalizeServings(value: string): number | null {
  const parsed = Number.parseFloat(value.replace(',', '.'))
  if (!Number.isFinite(parsed) || parsed <= 0) return null
  return Math.round(parsed * 10) / 10
}

function referenceLine(
  reference: ReturnType<typeof renderRecipeInstructions>[number]['references'][number],
): string {
  const ingredient = reference.ingredient
  if (!ingredient) return ''
  const amount = reference.amountText?.trim() ?? ''
  const unit = ingredient.unit?.trim() ?? ''
  return [amount, unit, ingredient.name].filter(Boolean).join(' ')
}

export function CookPage({
  recipeId,
  cookSessionId,
}: {
  recipeId: string
  cookSessionId: string | null
}) {
  const data = useLiveQuery<CookData>(async () => {
    try {
      const recipe = await db.recipes.get(recipeId)
      const session = cookSessionId ? await db.cookSessions.get(cookSessionId) : undefined
      // A session id must belong to this recipe; never borrow portions from an
      // unrelated dish just because a stale link contains the id.
      const validSession = session && session.recipeId === recipeId ? session : undefined
      return {
        recipe: recipe ?? null,
        sessionServings: validSession?.servings ?? null,
        sessionId: validSession?.id ?? null,
        sessionMissing: Boolean(cookSessionId) && !validSession,
        loadError: null,
      }
    } catch (cause) {
      // useLiveQuery would otherwise rethrow into the render tree. There is no
      // app-level error boundary, so cook mode shows a recoverable message
      // instead of turning the whole app blank.
      return {
        recipe: null,
        sessionServings: null,
        sessionId: null,
        sessionMissing: false,
        loadError: (cause as Error)?.message || 'Unbekannter Datenbankfehler.',
      }
    }
  }, [recipeId, cookSessionId])

  const [servings, setServings] = useState<number | null>(null)
  const [servingsInput, setServingsInput] = useState('')
  const [servingsReady, setServingsReady] = useState(false)
  const [stepIndex, setStepIndex] = useState(0)
  const [progressReady, setProgressReady] = useState(false)
  const [loadedSessionId, setLoadedSessionId] = useState<string | null>(null)
  const [showAllIngredients, setShowAllIngredients] = useState(false)

  const recipe = data?.recipe ?? null
  const steps = useMemo(
    () => (recipe ? [...recipe.instructions].sort((a, b) => a.position - b.position) : []),
    [recipe],
  )
  const originalServings = recipe ? resolveOriginalServings(recipe) : null
  const currentIndex = steps.length === 0 ? 0 : Math.min(stepIndex, steps.length - 1)
  const initialTarget = data?.sessionServings ?? originalServings ?? 1
  const targetServings = servings ?? initialTarget
  const servingsFieldValue = servingsReady ? servingsInput : String(initialTarget)
  const factor =
    originalServings !== null && targetServings > 0 ? targetServings / originalServings : null

  const rendered = useMemo(
    () =>
      recipe
        ? renderRecipeInstructions(steps, recipe.ingredients, {
            originalServings,
            targetServings,
          })
        : [],
    [recipe, steps, originalServings, targetServings],
  )
  const scaledIngredients = useMemo(
    () =>
      recipe
        ? scaleRecipeIngredients(recipe.ingredients, originalServings, targetServings)
        : null,
    [recipe, originalServings, targetServings],
  )

  const current = rendered[currentIndex]
  const relevantIngredients = (current?.references ?? []).filter(
    (reference) => reference.ingredient !== null,
  )

  useEffect(() => {
    // Entry links can be clicked from far down the plan or recipe page. Start
    // the focused mode at the top so the recipe and first step are visible.
    window.scrollTo(0, 0)
    void pruneOrphanedCookProgress()
  }, [])

  useEffect(() => {
    if (servingsReady || !data?.recipe) return
    const initial = data.sessionServings ?? resolveOriginalServings(data.recipe) ?? 1
    setServings(initial)
    setServingsInput(String(initial))
    setServingsReady(true)
  }, [data, servingsReady])

  useEffect(() => {
    let cancelled = false
    setProgressReady(false)
    setLoadedSessionId(null)
    const sessionId = data?.sessionId ?? null
    if (!sessionId) {
      setStepIndex(0)
      setProgressReady(true)
      return () => {
        cancelled = true
      }
    }
    void loadCookProgress(sessionId).then((stored) => {
      if (cancelled) return
      setStepIndex(stored ?? 0)
      setLoadedSessionId(sessionId)
      setProgressReady(true)
    })
    return () => {
      cancelled = true
    }
  }, [data?.sessionId])

  useEffect(() => {
    if (steps.length === 0) return
    setStepIndex((current) => Math.min(current, steps.length - 1))
  }, [steps.length])

  useEffect(() => {
    if (!progressReady) return
    const sessionId = data?.sessionId ?? null
    // Only persist after the stored step for exactly this session was loaded;
    // otherwise the initial step 0 could overwrite real progress.
    if (!sessionId || loadedSessionId !== sessionId) return
    void saveCookProgress(sessionId, currentIndex)
  }, [progressReady, loadedSessionId, data?.sessionId, currentIndex])

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null
      const tag = target?.tagName?.toLowerCase()
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || target?.isContentEditable) {
        return
      }
      if (steps.length === 0) return
      if (event.key === 'ArrowLeft' || event.key === 'PageUp') {
        event.preventDefault()
        setStepIndex((current) => Math.max(0, current - 1))
      } else if (event.key === 'ArrowRight' || event.key === 'PageDown') {
        event.preventDefault()
        setStepIndex((current) => Math.min(steps.length - 1, current + 1))
      } else if (event.key === 'Home') {
        event.preventDefault()
        setStepIndex(0)
      } else if (event.key === 'End') {
        event.preventDefault()
        setStepIndex(steps.length - 1)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [steps.length])

  function goToStep(index: number) {
    if (steps.length === 0) return
    setStepIndex(Math.max(0, Math.min(steps.length - 1, index)))
  }

  function changeServings(value: string) {
    setServingsInput(value)
    const parsed = normalizeServings(value)
    if (parsed !== null) setServings(parsed)
  }

  function startOver() {
    goToStep(0)
  }

  if (!data) {
    return (
      <div className="page cook-page">
        <p className="empty-state">Lade Kochmodus …</p>
      </div>
    )
  }

  if (data.loadError) {
    return (
      <div className="page cook-page">
        <div className="empty-state">
          <p>Der Kochmodus konnte nicht geladen werden.</p>
          <p className="muted small">{data.loadError}</p>
          <a className="button" href="#/">
            Zur Bibliothek
          </a>
        </div>
      </div>
    )
  }

  if (!recipe) {
    return (
      <div className="page cook-page">
        <div className="empty-state">
          <p>Rezept nicht gefunden.</p>
          <a className="button" href="#/">
            Zur Bibliothek
          </a>
        </div>
      </div>
    )
  }

  const exitHref = cookSessionId ? '#/plan' : `#/recipe/${encodeURIComponent(recipe.id)}`
  const progressPercent =
    steps.length === 0 ? 0 : Math.round(((currentIndex + 1) / steps.length) * 100)

  return (
    <div className="page cook-page">
      <div className="cook-topbar">
        <a className="back-link" href={exitHref}>
          ← {cookSessionId ? 'Zum Essensplan' : 'Zum Rezept'}
        </a>
        <a className="button quiet" href={exitHref}>
          Kochmodus verlassen
        </a>
      </div>

      <header className="cook-header">
        <div>
          <h1>{recipe.title}</h1>
          <p className="cook-meta">
            {steps.length > 0 ? (
              <strong>
                Schritt {currentIndex + 1} von {steps.length}
              </strong>
            ) : (
              <strong>Keine Schritte hinterlegt</strong>
            )}
            {originalServings !== null ? (
              <span className="muted small">
                {' '}
                · Original {formatPortionCount(originalServings)}
              </span>
            ) : (
              <span className="muted small"> · Originalportionen unklar</span>
            )}
          </p>
        </div>
        <label className="cook-servings">
          <span className="muted small">Kochportionen</span>
          <input
            type="number"
            min={0.5}
            step={0.5}
            inputMode="decimal"
            value={servingsFieldValue}
            onChange={(event) => changeServings(event.target.value)}
            aria-label="Kochportionen"
          />
        </label>
      </header>

      {data.sessionMissing ? (
        <div className="notice" role="status">
          Der geplante Kochvorgang wurde nicht gefunden. Der Kochmodus zeigt das Rezept mit den
          Originalportionen; es wird kein Fortschritt gespeichert.
        </div>
      ) : null}

      {originalServings === null ? (
        <div className="notice">
          Die Originalportionen des Rezepts sind unklar. Verknüpfte Mengen bleiben unverändert,
          statt einen Wert zu erfinden.
        </div>
      ) : null}

      {factor !== null ? (
        <p className="muted small cook-factor">
          Zutaten für {formatPortionCount(targetServings)} · Faktor{' '}
          {factor.toLocaleString('de-DE', { maximumFractionDigits: 2 })}
        </p>
      ) : null}

      <div className="cook-progress" aria-hidden="true">
        <span style={{ width: `${progressPercent}%` }} />
      </div>

      {steps.length === 0 ? (
        <section className="cook-step">
          <p className="empty-state">Für dieses Rezept sind keine Zubereitungsschritte hinterlegt.</p>
        </section>
      ) : (
        <section className="cook-step" aria-live="polite">
          <div className="cook-step-text">
            <Markdown text={current?.text ?? steps[currentIndex]?.text ?? ''} />
          </div>

          {relevantIngredients.length > 0 ? (
            <div className="cook-step-ingredients">
              <h2>In diesem Schritt</h2>
              <ul>
                {relevantIngredients.map((reference) => (
                  <li key={reference.reference.id}>
                    <span>{referenceLine(reference)}</span>
                    {reference.issue === 'unsafe-remainder' ? (
                      <span className="muted small"> Restmenge nicht sicher berechenbar</span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="cook-nav">
            <button
              type="button"
              className="button"
              onClick={() => goToStep(currentIndex - 1)}
              disabled={currentIndex === 0}
            >
              ← Zurück
            </button>
            {currentIndex < steps.length - 1 ? (
              <button
                type="button"
                className="button primary"
                onClick={() => goToStep(currentIndex + 1)}
              >
                Weiter →
              </button>
            ) : (
              <span className="cook-last-step muted small">Letzter Schritt</span>
            )}
          </div>
        </section>
      )}

      {steps.length > 1 ? (
        <nav className="cook-step-nav" aria-label="Zu einem Schritt springen">
          {steps.map((step, index) => (
            <button
              type="button"
              key={step.id}
              className={[
                'cook-step-dot',
                index === currentIndex ? 'is-current' : '',
                index < currentIndex ? 'is-done' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              onClick={() => goToStep(index)}
              aria-current={index === currentIndex ? 'step' : undefined}
              aria-label={`Schritt ${index + 1} von ${steps.length}`}
            >
              {index + 1}
            </button>
          ))}
        </nav>
      ) : null}

      <div className="cook-tools">
        <button type="button" className="button quiet" onClick={startOver}>
          Von vorne beginnen
        </button>
        <button
          type="button"
          className="button quiet"
          onClick={() => setShowAllIngredients((value) => !value)}
          aria-expanded={showAllIngredients}
        >
          {showAllIngredients ? 'Zutatenliste ausblenden' : 'Alle Zutaten anzeigen'}
        </button>
      </div>

      {showAllIngredients ? (
        <section className="cook-ingredients panel">
          <h2>Zutaten für {formatPortionCount(targetServings)}</h2>
          {scaledIngredients && scaledIngredients.items.length > 0 ? (
            <ul className="scaling-list">
              {scaledIngredients.items.map((item) => (
                <li key={item.ingredient.id} className={item.scaled ? '' : 'is-unscaled'}>
                  <span>{scaledIngredientLine(item)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted small">Keine Zutaten hinterlegt.</p>
          )}
          {scaledIngredients?.warnings.length ? (
            <p className="muted small">{scaledIngredients.warnings.join(' ')}</p>
          ) : null}
        </section>
      ) : null}
    </div>
  )
}
