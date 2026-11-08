/*
 * openCook Web
 * Copyright (C) 2026 openCook Web contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Planning dialog for a free dish. It uses the same seven-day picker, eater
 * steppers and ingredient editor as library recipes, but stores its name,
 * reference portions and ingredients only in the meal plan.
 */

import { useMemo, useState } from 'react'
import { IngredientEditor } from '../../components/IngredientEditor'
import { formatPortionCount } from '../../lib/format'
import { cookedRedefinition } from '../../domain/dishplan'
import { scaleDishIngredients } from '../../domain/dishSource'
import { scaledIngredientLine } from '../../domain/scaling'
import {
  adjustDayServings,
  createDaySelection,
  isSelectionValid,
  selectionTotal,
  toPlanDays,
  toggleDay,
  type DaySelection,
} from '../../domain/daySelection'
import { buildIngredientList, type DraftIngredient } from '../../recipe/editor'
import {
  CookedPlanConflictError,
  deleteDishPlan,
} from '../../mealplan/dishService'
import { saveFreeDishPlan } from '../../mealplan/freeDishService'
import { removeMealEntry } from '../../mealplan/service'
import type { CookSession, FreeDish, Ingredient, MealPlanEntry } from '../../types'
import { DaySelectionEditor } from './DaySelectionEditor'

function ingredientRows(ingredients: readonly Ingredient[]): DraftIngredient[] {
  return ingredients.map((ingredient) => ({
    key: ingredient.id,
    id: ingredient.id,
    group: '',
    quantity:
      ingredient.quantityText ??
      (ingredient.quantity !== null ? String(ingredient.quantity) : ''),
    unit: ingredient.unit ?? '',
    name: ingredient.name,
    purchaseNote: ingredient.purchaseNote ?? '',
    preparationNote: ingredient.preparationNote ?? '',
  }))
}

function parseReference(text: string): number | null {
  const value = Number.parseFloat(text.replace(',', '.'))
  return Number.isFinite(value) && value > 0 ? Math.round(value * 10) / 10 : null
}

export interface FreeDishDialogProps {
  mode: 'create' | 'edit'
  initialDate: string
  initialEntries: MealPlanEntry[]
  session?: CookSession
  freeDish?: FreeDish
  weekStartDay: number
  onMoveRequest?: () => void
  onDone: () => void
  onClose: () => void
}

export function FreeDishDialog({
  mode,
  initialDate,
  initialEntries,
  session,
  freeDish,
  weekStartDay,
  onMoveRequest,
  onDone,
  onClose,
}: FreeDishDialogProps) {
  const [name, setName] = useState(freeDish?.name ?? '')
  const [selection, setSelection] = useState<DaySelection>(() =>
    createDaySelection(initialEntries, initialDate),
  )
  const [rows, setRows] = useState<DraftIngredient[]>(() =>
    ingredientRows(freeDish?.ingredients ?? []),
  )
  const [referenceText, setReferenceText] = useState(
    freeDish ? String(freeDish.referenceServings) : '',
  )
  const [referenceTouched, setReferenceTouched] = useState(Boolean(freeDish))
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const total = selectionTotal(selection)
  const planDays = useMemo(() => toPlanDays(selection), [selection])
  const reference = referenceTouched ? parseReference(referenceText) : total
  const referenceValue = referenceTouched ? referenceText : String(total || '')
  const previewIngredients = useMemo(() => buildIngredientList(rows), [rows])
  const preview = useMemo(() => {
    if (previewIngredients.length === 0 || !reference) return null
    return scaleDishIngredients(
      {
        kind: 'free',
        freeDish: {
          id: freeDish?.id ?? 'preview',
          name,
          referenceServings: reference,
          ingredients: previewIngredients,
          createdAt: 0,
          updatedAt: 0,
        },
      },
      total,
    )
  }, [previewIngredients, reference, total, name, freeDish?.id])
  const valid =
    name.trim().length > 0 &&
    isSelectionValid(selection) &&
    reference !== null &&
    reference > 0

  function selectDay(date: string) {
    setSelection((current) => toggleDay(current, date))
    setError(null)
  }

  function changeServings(date: string, delta: number) {
    setSelection((current) => adjustDayServings(current, date, delta))
    setError(null)
  }

  async function persist(allowCookedChange: boolean): Promise<void> {
    await saveFreeDishPlan({
      cookSessionId: session?.id ?? null,
      freeDishId: freeDish?.id ?? null,
      name,
      days: planDays,
      referenceServings: reference!,
      ingredients: rows,
      allowCookedChange,
    })
  }

  async function handleSubmit() {
    if (!valid) {
      setError(
        selection.days.length === 0
          ? 'Bitte mindestens einen Esstag auswählen.'
          : !name.trim()
            ? 'Bitte einen Namen für das Gericht angeben.'
            : 'Bitte die Zutaten-Portionen prüfen.',
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
        aria-label={mode === 'create' ? 'Freies Gericht einplanen' : 'Freies Gericht bearbeiten'}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="modal-head">
          <div>
            <h2>{mode === 'create' ? 'Freies Gericht einplanen' : 'Gericht bearbeiten'}</h2>
          </div>
          <button type="button" className="button quiet" onClick={onClose}>
            Schließen
          </button>
        </div>

        <label className="field free-dish-name">
          <span className="field-label">Name des Gerichts</span>
          <input
            value={name}
            onChange={(event) => {
              setName(event.target.value)
              setError(null)
            }}
            placeholder="z. B. Nudeln mit Pesto"
            autoFocus
          />
        </label>

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
        </div>

        <details className="free-dish-ingredients">
          <summary>Zutaten</summary>
          <div className="free-dish-reference">
            <span className="muted small">Zutatenmengen für</span>
            <input
              className="free-dish-reference-input"
              type="number"
              min={1}
              step={1}
              inputMode="decimal"
              value={referenceValue}
              aria-label="Zutatenmengen für Portionen"
              onChange={(event) => {
                setReferenceText(event.target.value)
                setReferenceTouched(true)
                setError(null)
              }}
            />
            <span className="muted small">Portionen</span>
          </div>
          <IngredientEditor
            ingredients={rows}
            onChange={setRows}
            showGroup={false}
          />
          {previewIngredients.length === 0 ? (
            <p className="muted small">Keine Zutaten hinterlegt.</p>
          ) : preview ? (
            <details className="scaling dish-scaling">
              <summary>
                {preview.factor === null
                  ? 'Zutaten (unverändert)'
                  : `Zutaten für ${formatPortionCount(total)}`}
              </summary>
              <ul className="scaling-list">
                {preview.items.map((item) => (
                  <li key={item.ingredient.id} className={item.scaled ? '' : 'is-unscaled'}>
                    <span>{scaledIngredientLine(item)}</span>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </details>

        {error ? (
          <div className="notice danger" role="alert">
            {error}
          </div>
        ) : null}

        <div className="dialog-actions">
          <div className="dialog-actions-left">
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
      </div>
    </div>
  )
}
