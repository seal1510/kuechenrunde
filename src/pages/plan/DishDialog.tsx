/*
 * openCook Web
 * Copyright (C) 2026 openCook Web contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Planning surface for a library recipe. The recipe picker and the actual
 * planning form live in one responsive panel and share the existing day
 * selection, scaling and persistence logic.
 */

import { useMemo, useState, type MouseEvent } from 'react'
import { formatDayLabel } from '../../domain/dates'
import {
  cookedRedefinition,
  scalePlan,
} from '../../domain/dishplan'
import { resolveOriginalServings, scaledIngredientLine } from '../../domain/scaling'
import {
  effectiveDuration,
  formatFactor,
  formatPortionCount,
} from '../../lib/format'
import {
  CookedPlanConflictError,
  deleteDishPlan,
  saveDishPlan,
} from '../../mealplan/dishService'
import { removeMealEntry } from '../../mealplan/service'
import { cookHash } from '../../routing/routes'
import type { CookSession, MealPlanEntry, Recipe } from '../../types'
import {
  adjustDayServings,
  createDaySelection,
  isSelectionValid,
  selectionTotal,
  toPlanDays,
  toggleDay,
  type DaySelection,
} from '../../domain/daySelection'
import { DaySelectionEditor } from './DaySelectionEditor'
import { draftSignature, useDiscardGuard } from './discardGuard'
import { dishBackStep } from './planningBack'
import { dishFooterMode } from './planningFooter'
import { DiscardPrompt, PlanningPanel } from './PlanningPanel'
import { RecipeCover, RecipePicker } from './RecipePicker'

export interface DishDialogProps {
  mode: 'create' | 'edit'
  initialDate: string
  initialRecipeId?: string
  initialEntries: MealPlanEntry[]
  session?: CookSession
  recipes: Recipe[]
  /** Configured first weekday of the calendar week (0 = Monday … 6 = Sunday). */
  weekStartDay: number
  /** Keyboard-accessible move alternative for an existing dish. */
  onMoveRequest?: () => void
  /** Return from the create flow to the shared entry chooser. */
  onBackToChooser?: () => void
  onDone: () => void
  onClose: () => void
}

export function DishDialog({
  mode,
  initialDate,
  initialRecipeId,
  initialEntries,
  session,
  recipes,
  weekStartDay,
  onMoveRequest,
  onBackToChooser,
  onDone,
  onClose,
}: DishDialogProps) {
  const [recipeId, setRecipeId] = useState<string | null>(initialRecipeId ?? null)
  const [view, setView] = useState<'picker' | 'plan'>(() =>
    mode === 'create' && !initialRecipeId ? 'picker' : 'plan',
  )
  const [query, setQuery] = useState('')
  const [selection, setSelection] = useState<DaySelection>(() =>
    createDaySelection(initialEntries, initialDate),
  )
  const [correction, setCorrection] = useState('')
  const [saveCorrection, setSaveCorrection] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const recipe = recipeId
    ? recipes.find((candidate) => candidate.id === recipeId)
    : undefined
  // The cooking event is optional: old plans and repaired appointments may not
  // have one. The plan's stored id is then still the best link target so
  // CookPage can show its "missing session" fallback instead of hiding the
  // entire cook-mode entry.
  const cookSessionId =
    session?.id ??
    initialEntries.find((entry) => Boolean(entry.cookSessionId))?.cookSessionId ??
    null
  const selectedDays = selection.days
  const total = selectionTotal(selection)
  const planDays = useMemo(() => toPlanDays(selection), [selection])
  const knownOriginal = recipe ? resolveOriginalServings(recipe) : null
  const needsCorrection = Boolean(recipe) && knownOriginal === null
  const correctionNumber = (() => {
    const value = Number.parseFloat(correction.replace(',', '.'))
    return Number.isFinite(value) && value > 0 ? value : null
  })()
  const scale = recipe
    ? scalePlan(recipe, planDays, needsCorrection ? correctionNumber : null)
    : null
  const valid = Boolean(recipe) && isSelectionValid(selection)
  const removesWholePlan = initialEntries.length > 1 || Boolean(session)
  const showingPicker = mode === 'create' && (view === 'picker' || !recipe)
  const duration = recipe ? effectiveDuration(recipe) : ''
  const backStep = dishBackStep(mode, showingPicker, Boolean(onBackToChooser))

  const discard = useDiscardGuard(
    draftSignature({
      recipeId,
      days: planDays,
      correction,
      saveCorrection,
    }),
  )

  function selectDay(date: string) {
    if (discard.prompted) discard.cancel()
    setSelection((current) => toggleDay(current, date))
    setError(null)
  }

  function changeServings(date: string, delta: number) {
    if (discard.prompted) discard.cancel()
    setSelection((current) => adjustDayServings(current, date, delta))
    setError(null)
  }

  function chooseRecipe(id: string) {
    if (discard.prompted) discard.cancel()
    setRecipeId(id)
    setView('plan')
    setError(null)
  }

  function handleRequestClose() {
    if (busy) return
    if (discard.cancelIfPrompted()) return
    discard.request(onClose)
  }

  function handleBack() {
    if (!backStep || busy) return
    if (discard.cancelIfPrompted()) return
    if (backStep.target === 'picker') {
      // The draft stays in this dialog; only the visible step changes.
      setView('picker')
      setError(null)
      return
    }
    if (onBackToChooser) discard.request(onBackToChooser)
  }

  function handleMoveRequest() {
    if (!onMoveRequest || busy) return
    discard.request(onMoveRequest)
  }

  function handleCookNavigation(
    event: MouseEvent<HTMLAnchorElement>,
  ) {
    if (!discard.dirty || busy) return
    event.preventDefault()
    const href = event.currentTarget.getAttribute('href') ?? ''
    discard.request(() => {
      window.location.hash = href
    })
  }

  async function persist(allowCookedChange: boolean): Promise<void> {
    await saveDishPlan({
      cookSessionId: session?.id ?? null,
      recipeId: recipeId!,
      days: planDays,
      allowCookedChange,
      originalServings:
        needsCorrection && saveCorrection ? correctionNumber : null,
    })
  }

  async function handleSubmit() {
    if (!recipe) {
      setError('Das Rezept existiert nicht mehr.')
      return
    }
    if (!valid) {
      setError(
        selectedDays.length === 0
          ? 'Bitte mindestens einen Esstag auswählen.'
          : 'Bitte Rezept und Mitesser prüfen.',
      )
      return
    }
    setError(null)
    const conflict = session ? cookedRedefinition(session, planDays) : null
    let allowCookedChange = false
    if (conflict) {
      if (!window.confirm(`${conflict.message} Kochmenge anpassen?`)) return
      allowCookedChange = true
    }
    setBusy(true)
    try {
      await persist(allowCookedChange)
      onDone()
    } catch (cause) {
      if (cause instanceof CookedPlanConflictError && !allowCookedChange) {
        if (window.confirm(`${cause.message} Kochmenge trotzdem anpassen?`)) {
          try {
            await persist(true)
            onDone()
            return
          } catch (second) {
            setError((second as Error).message || 'Das Gericht konnte nicht gespeichert werden.')
            return
          }
        }
        return
      }
      setError((cause as Error).message || 'Das Gericht konnte nicht gespeichert werden.')
    } finally {
      setBusy(false)
    }
  }

  async function handleDelete() {
    const count = initialEntries.length
    const question = removesWholePlan
      ? count > 1
        ? `Alle ${count} Esstage dieser gemeinsamen Planung entfernen?`
        : 'Diese gemeinsame Planung entfernen?'
      : 'Dieses Gericht entfernen?'
    if (!window.confirm(question)) return
    setBusy(true)
    try {
      if (session?.id) {
        await deleteDishPlan(session.id)
      } else {
        for (const entry of initialEntries) await removeMealEntry(entry.id)
      }
      onDone()
    } catch (cause) {
      setError((cause as Error).message || 'Das Gericht konnte nicht entfernt werden.')
    } finally {
      setBusy(false)
    }
  }

  const footerMode = dishFooterMode(showingPicker, discard.prompted)
  const actions = (
    <div className="plan-panel-actions">
      <div className="plan-panel-actions-secondary">
        {mode === 'edit' && recipe ? (
          <a
            className="button"
            href={cookHash(recipe.id, cookSessionId)}
            onClick={handleCookNavigation}
          >
            Kochen
          </a>
        ) : null}
        {mode === 'edit' && onMoveRequest ? (
          <button
            type="button"
            className="button quiet"
            onClick={handleMoveRequest}
            disabled={busy}
          >
            Verschieben
          </button>
        ) : null}
        {mode === 'edit' && initialEntries.length > 0 ? (
          <button
            type="button"
            className="button danger-quiet"
            onClick={() => void handleDelete()}
            disabled={busy}
          >
            {removesWholePlan
              ? 'Ganze Planung entfernen'
              : 'Gericht entfernen'}
          </button>
        ) : null}
      </div>
      <div className="plan-panel-actions-primary">
        <button
          type="button"
          className="button"
          onClick={handleRequestClose}
          disabled={busy}
        >
          Abbrechen
        </button>
        <button
          type="button"
          className="button primary"
          onClick={() => void handleSubmit()}
          disabled={busy || !valid}
        >
          {busy ? 'Speichere …' : mode === 'create' ? 'Einplanen' : 'Speichern'}
        </button>
      </div>
    </div>
  )
  const footer =
    footerMode === 'prompt' ? (
      <DiscardPrompt
        onKeepEditing={discard.cancel}
        onDiscard={discard.confirm}
      />
    ) : footerMode === 'actions' ? (
      actions
    ) : undefined

  return (
    <PlanningPanel
      title={
        showingPicker
          ? 'Rezept auswählen'
          : mode === 'create'
            ? 'Gericht einplanen'
            : 'Gericht bearbeiten'
      }
      subtitle={formatDayLabel(initialDate)}
      backLabel={backStep?.label}
      onBack={backStep ? handleBack : undefined}
      onRequestClose={handleRequestClose}
      closeDisabled={busy}
      footer={footer}
      focusKey={showingPicker ? 'picker' : 'plan'}
      className={`dish-dialog${showingPicker ? ' is-picking' : ''}`}
    >
      {showingPicker ? (
        <RecipePicker
          recipes={recipes}
          query={query}
          onQueryChange={setQuery}
          selectedRecipeId={recipeId}
          onChoose={chooseRecipe}
        />
      ) : (
        <>
          {recipe ? (
            <div className="plan-recipe">
              <RecipeCover recipe={recipe} className="plan-recipe-cover" />
              <div className="plan-recipe-text">
                <p className="plan-recipe-kicker">Rezept</p>
                <h3>{recipe.title}</h3>
                <p className="muted small">
                  {knownOriginal !== null
                    ? `${formatPortionCount(knownOriginal)} im Original`
                    : 'Originalportionen unklar'}
                  {duration ? ` · ${duration}` : ''}
                </p>
              </div>
              {mode === 'create' ? (
                <button
                  type="button"
                  className="button quiet plan-recipe-change"
                  onClick={() => {
                    if (discard.prompted) discard.cancel()
                    setView('picker')
                    setError(null)
                  }}
                  disabled={busy}
                >
                  Rezept ändern
                </button>
              ) : null}
            </div>
          ) : (
            <div className="notice danger" role="alert">
              Das Rezept ist nicht mehr in der Bibliothek.
            </div>
          )}

          <DaySelectionEditor
            initialDate={initialDate}
            selection={selection}
            weekStartDay={weekStartDay}
            busy={busy}
            removalHint={mode === 'edit' && initialEntries.length > 0}
            onToggleDay={selectDay}
            onChangeServings={changeServings}
          />

          <div className="plan-summary" aria-live="polite">
            <strong className="plan-summary-total">
              {formatPortionCount(total)}
            </strong>
            <span className="plan-summary-detail">
              {knownOriginalSummary(knownOriginal, correctionNumber)}
              {scale?.scaling.factor !== null &&
              scale?.scaling.factor !== undefined
                ? ` · Faktor ${formatFactor(scale.scaling.factor)}`
                : ''}
            </span>
          </div>

          {needsCorrection ? (
            <>
              <label className="field dish-original">
                <span className="field-label">Originalportionen des Rezepts</span>
                <input
                  type="number"
                  min={1}
                  step={1}
                  value={correction}
                  placeholder="z. B. 4"
                  onChange={(event) => {
                    if (discard.prompted) discard.cancel()
                    setCorrection(event.target.value)
                  }}
                />
              </label>
              <label className="check-field dish-correction-save">
                <input
                  type="checkbox"
                  checked={saveCorrection}
                  onChange={(event) => {
                    if (discard.prompted) discard.cancel()
                    setSaveCorrection(event.target.checked)
                  }}
                />
                Originalportionen im Rezept speichern
              </label>
            </>
          ) : null}

          {recipe && scale ? (
            <details className="scaling dish-scaling">
              <summary>
                {scale.scaling.factor === null
                  ? 'Zutaten (unverändert)'
                  : `Zutaten für ${formatPortionCount(total)}`}
              </summary>
              {scale.scaling.items.length === 0 ? (
                <p className="muted small">Keine Zutaten hinterlegt.</p>
              ) : (
                <ul className="scaling-list">
                  {scale.scaling.items.map((item) => (
                    <li
                      key={item.ingredient.id}
                      className={item.scaled ? '' : 'is-unscaled'}
                    >
                      <span>{scaledIngredientLine(item)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </details>
          ) : null}

          {error ? (
            <div className="notice danger" role="alert">
              {error}
            </div>
          ) : null}
        </>
      )}
    </PlanningPanel>
  )
}

function knownOriginalSummary(
  knownOriginal: number | null,
  correction: number | null,
): string {
  if (knownOriginal !== null) {
    return `aus einem Rezept für ${formatPortionCount(knownOriginal)}`
  }
  if (correction !== null) {
    return `für ${formatPortionCount(correction)} im Rezept`
  }
  return 'Originalportionen noch unklar · Mengen bleiben unverändert'
}
