/*
 * openCook Web
 * Copyright (C) 2026 openCook Web contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Shared editable ingredient rows for library recipes and free dishes. Both
 * use the same quantity/unit/name fields and the same optional purchase and
 * preparation notes; only the dialog around them differs.
 */

import { useId } from 'react'
import { randomId } from '../lib/id'
import type { DraftIngredient } from '../recipe/editor'

export interface IngredientEditorProps {
  ingredients: DraftIngredient[]
  onChange: (ingredients: DraftIngredient[]) => void
  /** Free dishes have no ingredient groups. */
  showGroup?: boolean
}

export function IngredientEditor({
  ingredients,
  onChange,
  showGroup = true,
}: IngredientEditorProps) {
  const groupListId = useId()
  const groupOptions = Array.from(
    new Set(
      ingredients
        .map((ingredient) => ingredient.group.trim())
        .filter((group) => group.length > 0),
    ),
  ).sort((a, b) => a.localeCompare(b, 'de'))

  function updateIngredient(key: string, patch: Partial<DraftIngredient>) {
    onChange(
      ingredients.map((ingredient) =>
        ingredient.key === key ? { ...ingredient, ...patch } : ingredient,
      ),
    )
  }

  function moveIngredient(index: number, direction: -1 | 1) {
    const target = index + direction
    if (target < 0 || target >= ingredients.length) return
    const next = [...ingredients]
    const [moved] = next.splice(index, 1)
    if (moved) next.splice(target, 0, moved)
    onChange(next)
  }

  return (
    <>
      <datalist id={groupListId}>
        {groupOptions.map((group) => (
          <option key={group} value={group} />
        ))}
      </datalist>
      <div className="ingredient-editor" role="list" aria-label="Zutaten">
        {ingredients.map((ingredient, index) => {
          const noteCount =
            (ingredient.purchaseNote.trim() ? 1 : 0) +
            (ingredient.preparationNote.trim() ? 1 : 0)
          const group = ingredient.group.trim()
          const summary = [
            showGroup && group ? `Gruppe: ${group}` : '',
            noteCount > 0
              ? `${noteCount} Hinweis${noteCount === 1 ? '' : 'e'}`
              : showGroup
                ? 'Gruppe & Hinweise'
                : 'Hinweise',
          ]
            .filter(Boolean)
            .join(' · ')

          return (
            <div className="ingredient-row" key={ingredient.key} role="listitem">
              <div className="ingredient-main">
                <div className="ingredient-fields">
                  <label className="ingredient-field">
                    <span className="ingredient-label">Menge</span>
                    <input
                      className="ing-qty"
                      value={ingredient.quantity}
                      onChange={(event) =>
                        updateIngredient(ingredient.key, { quantity: event.target.value })
                      }
                      placeholder="z. B. 2"
                      inputMode="decimal"
                      aria-label={`Menge Zutat ${index + 1}`}
                    />
                  </label>
                  <label className="ingredient-field">
                    <span className="ingredient-label">Einheit</span>
                    <input
                      className="ing-unit"
                      value={ingredient.unit}
                      onChange={(event) =>
                        updateIngredient(ingredient.key, { unit: event.target.value })
                      }
                      placeholder="z. B. EL"
                      aria-label={`Einheit Zutat ${index + 1}`}
                    />
                  </label>
                  <label className="ingredient-field ing-name-field">
                    <span className="ingredient-label">Zutat</span>
                    <input
                      className="ing-name"
                      value={ingredient.name}
                      onChange={(event) =>
                        updateIngredient(ingredient.key, { name: event.target.value })
                      }
                      placeholder="Zutatenbezeichnung"
                      aria-label={`Zutat ${index + 1}`}
                    />
                  </label>
                </div>
                <div
                  className="ingredient-actions"
                  role="group"
                  aria-label={`Aktionen für Zutat ${index + 1}`}
                >
                  <button
                    type="button"
                    className="button quiet ingredient-action"
                    onClick={() => moveIngredient(index, -1)}
                    disabled={index === 0}
                    aria-label={`Zutat ${index + 1} nach oben`}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className="button quiet ingredient-action"
                    onClick={() => moveIngredient(index, 1)}
                    disabled={index === ingredients.length - 1}
                    aria-label={`Zutat ${index + 1} nach unten`}
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    className="button danger-quiet ingredient-action"
                    onClick={() =>
                      onChange(ingredients.filter((entry) => entry.key !== ingredient.key))
                    }
                    aria-label={`Zutat ${index + 1} entfernen`}
                  >
                    ×
                  </button>
                </div>
              </div>

              <details className="ingredient-extras">
                <summary>{summary}</summary>
                <div className="ingredient-extras-fields">
                  {showGroup ? (
                    <label className="field">
                      <span className="field-label">Gruppe</span>
                      <input
                        value={ingredient.group}
                        list={groupListId}
                        onChange={(event) =>
                          updateIngredient(ingredient.key, { group: event.target.value })
                        }
                        placeholder="z. B. Teig"
                        aria-label={`Zutatengruppe für Zutat ${index + 1}`}
                      />
                    </label>
                  ) : null}
                  <label className="field">
                    <span className="field-label">Einkaufshinweis</span>
                    <input
                      className="ing-purchase"
                      value={ingredient.purchaseNote}
                      onChange={(event) =>
                        updateIngredient(ingredient.key, { purchaseNote: event.target.value })
                      }
                      placeholder="z. B. bevorzugt Bio"
                      aria-label={`Einkaufshinweis für Zutat ${index + 1}`}
                    />
                  </label>
                  <label className="field">
                    <span className="field-label">Zubereitungshinweis</span>
                    <input
                      className="ing-prep"
                      value={ingredient.preparationNote}
                      onChange={(event) =>
                        updateIngredient(ingredient.key, { preparationNote: event.target.value })
                      }
                      placeholder="z. B. fein würfeln"
                      aria-label={`Zubereitungshinweis für Zutat ${index + 1}`}
                    />
                  </label>
                </div>
              </details>
            </div>
          )
        })}
      </div>
      <button
        type="button"
        className="button editor-add-button"
        onClick={() => {
          const id = randomId()
          onChange([
            ...ingredients,
            {
              key: id,
              id,
              group: '',
              quantity: '',
              unit: '',
              name: '',
              purchaseNote: '',
              preparationNote: '',
            },
          ])
        }}
      >
        <span aria-hidden="true">+</span> Zutat hinzufügen
      </button>
    </>
  )
}
