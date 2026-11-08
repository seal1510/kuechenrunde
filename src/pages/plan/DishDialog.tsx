import { useMemo, useState } from 'react'
import {
  cookedRedefinition,
  scalePlan,
} from '../../domain/dishplan'
import { resolveOriginalServings, scaledIngredientLine } from '../../domain/scaling'
import { formatDuration, formatFactor, formatPortionCount } from '../../lib/format'
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

function RecipePicker({
  recipes,
  onChoose,
}: {
  recipes: Recipe[]
  onChoose: (recipeId: string) => void
}) {
  const [query, setQuery] = useState('')
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return recipes
    return recipes.filter(
      (recipe) =>
        recipe.title.toLowerCase().includes(needle) ||
        recipe.ingredients.some((ingredient) => ingredient.name.toLowerCase().includes(needle)),
    )
  }, [recipes, query])

  return (
    <div className="recipe-search">
      {recipes.length > 0 ? (
        <label className="search-field">
          <span className="visually-hidden">Rezepte durchsuchen</span>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Rezept oder Zutat suchen …"
            autoFocus
          />
        </label>
      ) : null}
      {recipes.length === 0 ? (
        <div className="recipe-picker-empty">
          <p className="muted small">Noch keine Rezepte vorhanden.</p>
          <a className="button primary" href="#/recipe/new">
            Neues Rezept
          </a>
        </div>
      ) : filtered.length === 0 ? (
        <p className="muted small">Keine Rezepte gefunden.</p>
      ) : (
        <ul className="recipe-option-list recipe-search-results">
          {filtered.map((recipe) => (
            <li key={recipe.id}>
              <button type="button" className="recipe-option" onClick={() => onChoose(recipe.id)}>
                <span>{recipe.title}</span>
                <span className="muted small">
                  {recipe.categories.slice(0, 2).join(', ')}
                  {recipe.totalTime ? ` · ${formatDuration(recipe.totalTime)}` : ''}
                  {recipe.servingsNumber
                    ? ` · ${formatPortionCount(recipe.servingsNumber)}`
                    : ''}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

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
  onDone,
  onClose,
}: DishDialogProps) {
  const [recipeId, setRecipeId] = useState<string | null>(initialRecipeId ?? null)
  const [showPicker, setShowPicker] = useState(mode === 'create' && !initialRecipeId)
  const [selection, setSelection] = useState<DaySelection>(() =>
    createDaySelection(initialEntries, initialDate),
  )
  const [correction, setCorrection] = useState('')
  const [saveCorrection, setSaveCorrection] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const recipe = recipeId ? recipes.find((candidate) => candidate.id === recipeId) : undefined
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

  function selectDay(date: string) {
    setSelection((current) => toggleDay(current, date))
    setError(null)
  }

  function changeServings(date: string, delta: number) {
    setSelection((current) => adjustDayServings(current, date, delta))
    setError(null)
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
    if (
      !window.confirm(
        count > 1
          ? `Alle ${count} Tage dieses Gerichts entfernen?`
          : 'Dieses Gericht entfernen?',
      )
    ) {
      return
    }
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

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="modal dish-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={mode === 'create' ? 'Gericht einplanen' : 'Gericht bearbeiten'}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="modal-head">
          <div>
            <h2>{mode === 'create' ? 'Gericht einplanen' : 'Gericht bearbeiten'}</h2>
            {mode === 'edit' && recipe ? (
              <p className="muted small">{recipe.title}</p>
            ) : null}
          </div>
          <button type="button" className="button quiet" onClick={onClose}>
            Schließen
          </button>
        </div>

        {mode === 'create' && (showPicker || !recipe) ? (
          <RecipePicker
            recipes={recipes}
            onChoose={(id) => {
              setRecipeId(id)
              setShowPicker(false)
            }}
          />
        ) : (
          <>
            {mode === 'create' && recipe ? (
              <div className="selected-recipe">
                <div>
                  <strong>{recipe.title}</strong>
                  <p className="muted small">
                    {recipe.totalTime ? formatDuration(recipe.totalTime) : ''}
                  </p>
                </div>
                <button
                  type="button"
                  className="button quiet"
                  onClick={() => setShowPicker(true)}
                >
                  Rezept ändern
                </button>
              </div>
            ) : null}

            <DaySelectionEditor
              initialDate={initialDate}
              selection={selection}
              weekStartDay={weekStartDay}
              busy={busy}
              onToggleDay={selectDay}
              onChangeServings={changeServings}
            />

            <div className="dish-total">
              <span className="muted small">Gesamt</span>
              <strong>{formatPortionCount(total)}</strong>
              {scale?.scaling.factor !== null && scale?.scaling.factor !== undefined ? (
                <span className="muted small">
                  aus {formatPortionCount(scale.originalServings ?? total)} · Faktor{' '}
                  {formatFactor(scale.scaling.factor)}
                </span>
              ) : (
                <span className="muted small">Mengen bleiben unverändert</span>
              )}
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
                    onChange={(event) => setCorrection(event.target.value)}
                  />
                </label>
                <label className="check-field dish-correction-save">
                  <input
                    type="checkbox"
                    checked={saveCorrection}
                    onChange={(event) => setSaveCorrection(event.target.checked)}
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
                      <li key={item.ingredient.id} className={item.scaled ? '' : 'is-unscaled'}>
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

            <div className="dialog-actions">
              <div className="dialog-actions-left">
                {mode === 'edit' && recipe ? (
                  <a className="button primary" href={cookHash(recipe.id, cookSessionId)}>
                    Kochen
                  </a>
                ) : null}
                {mode === 'edit' && onMoveRequest ? (
                  <button
                    type="button"
                    className="button quiet"
                    onClick={onMoveRequest}
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
                    Gericht entfernen
                  </button>
                ) : null}
              </div>
              <div className="dialog-actions-right">
                <button type="button" className="button" onClick={onClose} disabled={busy}>
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
          </>
        )}
      </div>
    </div>
  )
}
