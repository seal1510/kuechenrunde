/*
 * openCook Web
 * Copyright (C) 2026 openCook Web contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Cook mode with two views that share one recipe, one temporary portion count
 * and one current step:
 *   - step view: one preparation step in focus
 *   - overview: all preparation steps plus the complete ingredient list
 *
 * Recipe and planning data stay read-only. Only the local progress of a
 * planned cooking event is stored, and reaching the last step never marks a
 * cooking event as cooked.
 */

import { useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db'
import { formatPortionCount } from '../lib/format'
import {
  resolveOriginalServings,
  scaleRecipeIngredients,
  scaledIngredientAmount,
} from '../domain/scaling'
import { renderRecipeInstructions, type RenderedInstruction } from '../recipe/references'
import {
  loadCookProgress,
  pruneOrphanedCookProgress,
  saveCookProgress,
} from '../mealplan/cookProgress'
import { Markdown } from '../components/Markdown'
import { IngredientList } from '../components/RecipeCard'
import type { Ingredient, Instruction, Recipe } from '../types'

interface CookData {
  recipe: Recipe | null
  sessionServings: number | null
  sessionId: string | null
  sessionMissing: boolean
  /** A database/loading failure must not crash the whole app. */
  loadError: string | null
}

export type CookView = 'step' | 'overview'

export interface CookUiState {
  view: CookView
  stepIndex: number
  servings: number | null
}

export type CookUiAction =
  | { type: 'changeView'; view: CookView }
  | { type: 'goToStep'; index: number; stepCount: number }
  | { type: 'openStep'; index: number; stepCount: number }
  | { type: 'clampStep'; stepCount: number }
  | { type: 'setServings'; value: number }

export const COOK_SERVINGS_STEP = 0.5
export const MIN_COOK_SERVINGS = 0.5

export const initialCookUiState: CookUiState = {
  view: 'step',
  stepIndex: 0,
  servings: null,
}

export function clampCookStepIndex(index: number, stepCount: number): number {
  if (!Number.isFinite(index) || stepCount < 1) return 0
  return Math.max(0, Math.min(Math.trunc(index), Math.trunc(stepCount) - 1))
}

function normalizeCookServings(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return MIN_COOK_SERVINGS
  return Math.max(MIN_COOK_SERVINGS, Math.round(value * 100) / 100)
}

/** One plus/minus action; the temporary value never leaves cook mode. */
export function cookServingsAfterDelta(current: number, delta: number): number {
  const base = Number.isFinite(current) && current > 0 ? current : MIN_COOK_SERVINGS
  return normalizeCookServings(base + delta)
}

export function cookUiReducer(state: CookUiState, action: CookUiAction): CookUiState {
  switch (action.type) {
    case 'changeView':
      return state.view === action.view ? state : { ...state, view: action.view }
    case 'goToStep': {
      const stepIndex = clampCookStepIndex(action.index, action.stepCount)
      return stepIndex === state.stepIndex ? state : { ...state, stepIndex }
    }
    case 'openStep': {
      const stepIndex = clampCookStepIndex(action.index, action.stepCount)
      return stepIndex === state.stepIndex && state.view === 'step'
        ? state
        : { ...state, stepIndex, view: 'step' }
    }
    case 'clampStep': {
      const stepIndex = clampCookStepIndex(state.stepIndex, action.stepCount)
      return stepIndex === state.stepIndex ? state : { ...state, stepIndex }
    }
    case 'setServings': {
      const servings = normalizeCookServings(action.value)
      return servings === state.servings ? state : { ...state, servings }
    }
  }
}

function referenceLine(reference: RenderedInstruction['references'][number]): string {
  const ingredient = reference.ingredient
  if (!ingredient) return ''
  const amount = reference.amountText?.trim() ?? ''
  const unit = ingredient.unit?.trim() ?? ''
  return [amount, unit, ingredient.name].filter(Boolean).join(' ')
}

interface CookIngredientsPanelProps {
  id: string
  recipe: Recipe
  originalServings: number | null
  targetServings: number
  amountFor: (ingredient: Ingredient) => string
}

function CookIngredientsPanel({
  id,
  recipe,
  originalServings,
  targetServings,
  amountFor,
}: CookIngredientsPanelProps) {
  return (
    <section id={id} className="panel cook-ingredients" aria-labelledby={`${id}-title`}>
      <div className="cook-section-head">
        <h2 id={`${id}-title`}>
          {originalServings !== null
            ? `Zutaten für ${formatPortionCount(targetServings)}`
            : 'Zutaten'}
        </h2>
      </div>
      <IngredientList recipe={recipe} amountFor={amountFor} />
    </section>
  )
}

interface CookStepViewProps {
  steps: readonly Instruction[]
  rendered: readonly RenderedInstruction[]
  currentIndex: number
  onPrevious: () => void
  onNext: () => void
  onSelectStep: (index: number) => void
}

export function CookStepView({
  steps,
  rendered,
  currentIndex: rawCurrentIndex,
  onPrevious,
  onNext,
  onSelectStep,
}: CookStepViewProps) {
  if (steps.length === 0) {
    return (
      <div className="empty-state">
        <p>Für dieses Rezept sind keine Zubereitungsschritte hinterlegt.</p>
      </div>
    )
  }

  const currentIndex = clampCookStepIndex(rawCurrentIndex, steps.length)
  const current = rendered[currentIndex]
  const stepText = current?.text ?? steps[currentIndex]?.text ?? ''
  const relevantIngredients = (current?.references ?? []).filter(
    (reference) => reference.ingredient !== null,
  )
  const isFirst = currentIndex === 0
  const isLast = currentIndex === steps.length - 1

  return (
    <>
      <section
        id="cook-current-step"
        className="cook-step"
        tabIndex={-1}
        aria-label={`Schritt ${currentIndex + 1} von ${steps.length}`}
      >
        <div className="cook-step-head">
          <h2 className="cook-step-kicker">Schritt {currentIndex + 1}</h2>
          {isLast ? <span className="badge subtle">Letzter Schritt</span> : null}
        </div>

        <div className="cook-step-text" aria-live="polite" aria-atomic="true">
          <Markdown text={stepText} />
        </div>

        {relevantIngredients.length > 0 ? (
          <div className="cook-step-ingredients">
            <h3>In diesem Schritt</h3>
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
          <button type="button" className="button" onClick={onPrevious} disabled={isFirst}>
            ← Zurück
          </button>
          <button
            type="button"
            className="button primary"
            onClick={onNext}
            disabled={isLast}
          >
            Weiter →
          </button>
        </div>
      </section>

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
              onClick={() => onSelectStep(index)}
              aria-current={index === currentIndex ? 'step' : undefined}
              aria-label={`Schritt ${index + 1} von ${steps.length}`}
            >
              {index + 1}
            </button>
          ))}
        </nav>
      ) : null}
    </>
  )
}

interface CookOverviewProps {
  recipe: Recipe
  steps: readonly Instruction[]
  rendered: readonly RenderedInstruction[]
  currentIndex: number
  originalServings: number | null
  targetServings: number
  amountFor: (ingredient: Ingredient) => string
  onSelectStep: (index: number) => void
}

export function CookOverview({
  recipe,
  steps,
  rendered,
  currentIndex: rawCurrentIndex,
  originalServings,
  targetServings,
  amountFor,
  onSelectStep,
}: CookOverviewProps) {
  const currentIndex = clampCookStepIndex(rawCurrentIndex, steps.length)

  return (
    <div className="cook-overview">
      <section className="cook-overview-steps" aria-labelledby="cook-overview-steps-title">
        <div className="cook-section-head">
          <h2 id="cook-overview-steps-title">Zubereitung</h2>
        </div>

        {steps.length === 0 ? (
          <div className="empty-state">
            <p>Für dieses Rezept sind keine Zubereitungsschritte hinterlegt.</p>
          </div>
        ) : (
          <ol className="cook-overview-list">
            {steps.map((step, index) => {
              const isCurrent = index === currentIndex
              return (
                <li
                  key={step.id}
                  className={`cook-overview-step${isCurrent ? ' is-current' : ''}`}
                  aria-current={isCurrent ? 'step' : undefined}
                >
                  <span className="cook-overview-step-marker" aria-hidden="true">
                    {index + 1}
                  </span>
                  <div className="cook-overview-step-body">
                    <div className="cook-overview-step-head">
                      <span className="cook-overview-step-kicker">Schritt {index + 1}</span>
                      {isCurrent ? <span className="cook-current-badge">Aktuell</span> : null}
                    </div>
                    <div className="cook-overview-step-text">
                      <Markdown text={rendered[index]?.text ?? step.text} />
                    </div>
                    <div className="cook-overview-step-action">
                      <button
                        type="button"
                        className="button quiet"
                        onClick={() => onSelectStep(index)}
                        aria-label={`Schritt ${index + 1} in der Schrittansicht öffnen`}
                      >
                        Schritt anzeigen →
                      </button>
                    </div>
                  </div>
                </li>
              )
            })}
          </ol>
        )}
      </section>

      <aside className="cook-overview-ingredients">
        <CookIngredientsPanel
          id="cook-overview-ingredients"
          recipe={recipe}
          originalServings={originalServings}
          targetServings={targetServings}
          amountFor={amountFor}
        />
      </aside>
    </div>
  )
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

  const [ui, dispatch] = useReducer(cookUiReducer, initialCookUiState)
  const [progressReady, setProgressReady] = useState(false)
  const [loadedSessionId, setLoadedSessionId] = useState<string | null>(null)
  const [ingredientsOpen, setIngredientsOpen] = useState(false)
  // Selecting a step in the overview removes that button from the DOM. Move
  // focus to the step it opened so keyboard users do not fall back to <body>.
  const shouldFocusStep = useRef(false)
  const lastView = useRef<CookView | null>(null)

  const recipe = data?.recipe ?? null
  const steps = useMemo(
    () => (recipe ? [...recipe.instructions].sort((a, b) => a.position - b.position) : []),
    [recipe],
  )
  const originalServings = recipe ? resolveOriginalServings(recipe) : null
  const currentIndex = clampCookStepIndex(ui.stepIndex, steps.length)
  const sessionServings =
    typeof data?.sessionServings === 'number' && data.sessionServings > 0
      ? data.sessionServings
      : null
  const initialTarget = sessionServings ?? originalServings ?? 1
  const targetServings = ui.servings ?? initialTarget

  const rendered = useMemo(
    () =>
      recipe
        ? renderRecipeInstructions(steps, recipe.ingredients, {
            originalServings,
            targetServings,
            autoScale: true,
          })
        : [],
    [recipe, steps, originalServings, targetServings],
  )
  const scaledIngredients = useMemo(
    () =>
      scaleRecipeIngredients(recipe?.ingredients ?? [], originalServings, targetServings),
    [recipe, originalServings, targetServings],
  )
  const scaledAmountById = useMemo(() => {
    const amounts = new Map<string, string>()
    for (const item of scaledIngredients.items) {
      amounts.set(item.ingredient.id, scaledIngredientAmount(item))
    }
    return amounts
  }, [scaledIngredients])
  const amountFor = (ingredient: Ingredient) =>
    scaledAmountById.get(ingredient.id) ?? ''

  useEffect(() => {
    // Entry links can be clicked from far down the plan or recipe page. Start
    // the focused mode at the top so the recipe and first step are visible.
    window.scrollTo(0, 0)
    void pruneOrphanedCookProgress()
  }, [])

  useEffect(() => {
    if (!data?.recipe || ui.servings !== null) return
    const initial =
      data.sessionServings && data.sessionServings > 0
        ? data.sessionServings
        : resolveOriginalServings(data.recipe) ?? 1
    dispatch({ type: 'setServings', value: initial })
  }, [data, ui.servings])

  useEffect(() => {
    let cancelled = false
    setProgressReady(false)
    setLoadedSessionId(null)
    const sessionId = data?.sessionId ?? null
    if (!sessionId) {
      dispatch({ type: 'goToStep', index: 0, stepCount: steps.length })
      setProgressReady(true)
      return () => {
        cancelled = true
      }
    }
    void loadCookProgress(sessionId).then((stored) => {
      if (cancelled) return
      dispatch({ type: 'goToStep', index: stored ?? 0, stepCount: steps.length })
      setLoadedSessionId(sessionId)
      setProgressReady(true)
    })
    return () => {
      cancelled = true
    }
  // `steps.length` is intentionally not a dependency: this effect restores the
  // saved step once per session and must not reset it when recipe data updates.
  }, [data?.sessionId])

  useEffect(() => {
    dispatch({ type: 'clampStep', stepCount: steps.length })
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
    if (lastView.current === null) {
      lastView.current = ui.view
      return
    }
    if (lastView.current === ui.view) return
    lastView.current = ui.view
    if (ui.view !== 'step') return

    const step = document.getElementById('cook-current-step')
    const focusStep = shouldFocusStep.current
    shouldFocusStep.current = false
    if (focusStep) step?.focus({ preventScroll: true })
    step?.scrollIntoView({ block: 'start' })
  }, [ui.view])

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (ui.view !== 'step') return
      if (event.metaKey || event.ctrlKey || event.altKey) return
      const target = event.target as HTMLElement | null
      const tag = target?.tagName?.toLowerCase()
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || target?.isContentEditable) {
        return
      }
      if (steps.length === 0) return

      let nextIndex: number | null = null
      if (event.key === 'ArrowLeft' || event.key === 'PageUp') {
        nextIndex = currentIndex - 1
      } else if (event.key === 'ArrowRight' || event.key === 'PageDown') {
        nextIndex = currentIndex + 1
      } else if (event.key === 'Home') {
        nextIndex = 0
      } else if (event.key === 'End') {
        nextIndex = steps.length - 1
      }
      if (nextIndex === null) return

      event.preventDefault()
      dispatch({ type: 'goToStep', index: nextIndex, stepCount: steps.length })
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [ui.view, currentIndex, steps.length])

  function goToStep(index: number) {
    dispatch({ type: 'goToStep', index, stepCount: steps.length })
  }

  function openStep(index: number) {
    shouldFocusStep.current = true
    dispatch({ type: 'openStep', index, stepCount: steps.length })
  }

  function changeServings(delta: number) {
    dispatch({
      type: 'setServings',
      value: cookServingsAfterDelta(targetServings, delta),
    })
  }

  function jumpToOverviewIngredients() {
    if (typeof document === 'undefined') return
    document.getElementById('cook-overview-ingredients')?.scrollIntoView({ block: 'start' })
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
  const isOverview = ui.view === 'overview'
  const progressPercent =
    steps.length === 0 ? 0 : Math.round(((currentIndex + 1) / steps.length) * 100)
  const stepLabel =
    steps.length > 0 ? `Schritt ${currentIndex + 1} von ${steps.length}` : 'Keine Schritte hinterlegt'
  const atMinimumServings = targetServings <= MIN_COOK_SERVINGS + 1e-9
  const originalLabel =
    originalServings !== null
      ? `Original ${formatPortionCount(originalServings)}`
      : 'Original unbekannt'

  return (
    <div className={`page cook-page ${isOverview ? 'is-overview' : 'is-step'}`}>
      <div className="cook-topbar">
        <a className="button quiet cook-exit" href={exitHref}>
          ← {cookSessionId ? 'Zum Essensplan' : 'Zum Rezept'}
        </a>
      </div>

      <header className="cook-header">
        <div className="cook-heading">
          <h1>{recipe.title}</h1>
          <p className="cook-meta">
            <strong>{stepLabel}</strong>
          </p>
        </div>

        <div className="cook-servings" role="group" aria-labelledby="cook-servings-label">
          <span className="cook-servings-label" id="cook-servings-label">
            Kochportionen
          </span>
          <div className="cook-servings-control">
            <button
              type="button"
              className="cook-servings-button"
              onClick={() => changeServings(-COOK_SERVINGS_STEP)}
              disabled={atMinimumServings}
              aria-label="Eine halbe Portion weniger"
            >
              −
            </button>
            <output className="cook-servings-value" aria-live="polite" aria-atomic="true">
              {formatPortionCount(targetServings)}
            </output>
            <button
              type="button"
              className="cook-servings-button"
              onClick={() => changeServings(COOK_SERVINGS_STEP)}
              aria-label="Eine halbe Portion mehr"
            >
              +
            </button>
          </div>
          <span className="cook-servings-original muted small">{originalLabel}</span>
        </div>
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

      {steps.length > 0 ? (
        <div
          className="cook-progress"
          role="progressbar"
          aria-label="Zubereitungsfortschritt"
          aria-valuemin={0}
          aria-valuemax={steps.length}
          aria-valuenow={currentIndex + 1}
          aria-valuetext={stepLabel}
        >
          <span style={{ width: `${progressPercent}%` }} />
        </div>
      ) : null}

      <div className="cook-toolbar">
        <div className="cook-view-switch" role="group" aria-label="Kochmodus-Ansicht">
          <button
            type="button"
            aria-pressed={ui.view === 'step'}
            onClick={() => dispatch({ type: 'changeView', view: 'step' })}
          >
            Schritt
          </button>
          <button
            type="button"
            aria-pressed={ui.view === 'overview'}
            onClick={() => dispatch({ type: 'changeView', view: 'overview' })}
          >
            Übersicht
          </button>
        </div>

        {!isOverview ? (
          <button
            type="button"
            className="button quiet cook-ingredients-toggle"
            onClick={() => setIngredientsOpen((value) => !value)}
            aria-expanded={ingredientsOpen}
            aria-controls={ingredientsOpen ? 'cook-ingredients' : undefined}
          >
            {ingredientsOpen ? 'Zutaten ausblenden' : 'Zutaten anzeigen'}
          </button>
        ) : (
          <button
            type="button"
            className="button quiet cook-ingredients-toggle cook-overview-ingredients-jump"
            onClick={jumpToOverviewIngredients}
            aria-controls="cook-overview-ingredients"
          >
            Zu den Zutaten
          </button>
        )}
      </div>

      {isOverview ? (
        <CookOverview
          recipe={recipe}
          steps={steps}
          rendered={rendered}
          currentIndex={currentIndex}
          originalServings={originalServings}
          targetServings={targetServings}
          amountFor={amountFor}
          onSelectStep={openStep}
        />
      ) : (
        <CookStepView
          steps={steps}
          rendered={rendered}
          currentIndex={currentIndex}
          onPrevious={() => goToStep(currentIndex - 1)}
          onNext={() => goToStep(currentIndex + 1)}
          onSelectStep={goToStep}
        />
      )}

      {!isOverview && ingredientsOpen ? (
        <CookIngredientsPanel
          id="cook-ingredients"
          recipe={recipe}
          originalServings={originalServings}
          targetServings={targetServings}
          amountFor={amountFor}
        />
      ) : null}
    </div>
  )
}
