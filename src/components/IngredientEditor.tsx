/*
 * openCook Web
 * Copyright (C) 2026 openCook Web contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Shared editable ingredient rows for library recipes and free dishes. Both
 * use the same quantity/unit/name fields and the same optional purchase and
 * preparation notes; only the dialog around them differs.
 */

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
  function updateIngredient(key: string, patch: Partial<DraftIngredient>) {
    onChange(
      ingredients.map((ingredient) =>
        ingredient.key === key ? { ...ingredient, ...patch } : ingredient,
      ),
    )
  }

  return (
    <>
      <div className="ingredient-editor">
        {ingredients.map((ingredient) => (
          <div className="ingredient-row" key={ingredient.key}>
            {showGroup ? (
              <input
                className="ing-group"
                value={ingredient.group}
                onChange={(event) =>
                  updateIngredient(ingredient.key, { group: event.target.value })
                }
                placeholder="Gruppe"
                aria-label="Zutatengruppe"
              />
            ) : null}
            <input
              className="ing-qty"
              value={ingredient.quantity}
              onChange={(event) =>
                updateIngredient(ingredient.key, { quantity: event.target.value })
              }
              placeholder="Menge"
              aria-label="Menge"
            />
            <input
              className="ing-unit"
              value={ingredient.unit}
              onChange={(event) =>
                updateIngredient(ingredient.key, { unit: event.target.value })
              }
              placeholder="Einheit"
              aria-label="Einheit"
            />
            <input
              className="ing-name"
              value={ingredient.name}
              onChange={(event) =>
                updateIngredient(ingredient.key, { name: event.target.value })
              }
              placeholder="Zutat"
              aria-label="Zutat"
            />
            <button
              type="button"
              className="button danger-quiet"
              onClick={() =>
                onChange(ingredients.filter((entry) => entry.key !== ingredient.key))
              }
              aria-label="Zutat entfernen"
            >
              ×
            </button>
            <input
              className="ing-purchase"
              value={ingredient.purchaseNote}
              onChange={(event) =>
                updateIngredient(ingredient.key, { purchaseNote: event.target.value })
              }
              placeholder="Einkaufshinweis"
              aria-label="Einkaufshinweis"
            />
            <input
              className="ing-prep"
              value={ingredient.preparationNote}
              onChange={(event) =>
                updateIngredient(ingredient.key, { preparationNote: event.target.value })
              }
              placeholder="Zubereitungshinweis"
              aria-label="Zubereitungshinweis"
            />
          </div>
        ))}
      </div>
      <button
        type="button"
        className="button"
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
        Zutat hinzufügen
      </button>
    </>
  )
}
