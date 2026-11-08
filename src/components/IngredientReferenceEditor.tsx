/*
 * openCook Web
 * Copyright (C) 2026 openCook Web contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Explicit ingredient links for one instruction step. The user marks an
 * amount in the normal textarea (or places the caret and lets the editor insert
 * the amount) and chooses a stored ingredient. No text is rewritten in the
 * background and no reference is guessed from ingredient names.
 */

import { useState } from 'react'
import { randomId } from '../lib/id'
import {
  computeRemainingQuantity,
  hasLaterReferenceForIngredient,
  ingredientQuantityText,
  isStrictQuantityText,
  normalizeReferenceAnchors,
  parseQuantityPrefix,
  quantityTextsEqual,
  reconcileReferenceAnchors,
  resolveReferenceAnchor,
} from '../recipe/references'
import type { DraftStep } from '../recipe/editor'
import type {
  Ingredient,
  Instruction,
  InstructionReference,
  InstructionReferenceQuantity,
} from '../types'

export interface IngredientReferenceEditorProps {
  step: DraftStep
  stepIndex: number
  ingredients: readonly Ingredient[]
  /** Preview instructions built from the whole draft, for remainder checks. */
  instructions: readonly Instruction[]
  onChange: (step: DraftStep) => void
}

type QuantityKind = InstructionReferenceQuantity['kind']

const KIND_LABELS: Record<QuantityKind, string> = {
  full: 'Gesamtmenge',
  partial: 'Teilmenge',
  remainder: 'übrige Menge',
}

function baseTextFor(
  ingredient: Ingredient,
  kind: QuantityKind,
  partialText: string,
): string | null {
  if (kind === 'full') return ingredientQuantityText(ingredient)
  if (kind === 'partial') return partialText.trim() || null
  return null
}

function insertion(text: string, offset: number, amount: string): { text: string; offset: number } {
  const before = text.slice(0, offset)
  const after = text.slice(offset)
  const prefix = before && !/\s$/.test(before) ? ' ' : ''
  const suffix = after && !/^\s/.test(after) ? ' ' : ''
  return {
    text: `${before}${prefix}${amount}${suffix}${after}`,
    offset: offset + prefix.length,
  }
}

export function IngredientReferenceEditor({
  step,
  stepIndex,
  ingredients,
  instructions,
  onChange,
}: IngredientReferenceEditorProps) {
  const [selection, setSelection] = useState({ start: 0, end: 0 })
  const [ingredientId, setIngredientId] = useState('')
  const [kind, setKind] = useState<QuantityKind>('full')
  const [partialText, setPartialText] = useState('')
  const [message, setMessage] = useState('')

  const selectedIngredient =
    ingredients.find((ingredient) => ingredient.id === ingredientId) ?? null

  function updateText(text: string) {
    onChange({
      ...step,
      text,
      references: reconcileReferenceAnchors(step.text, text, step.references),
    })
  }

  function refreshSelection(target: HTMLTextAreaElement) {
    setSelection({ start: target.selectionStart, end: target.selectionEnd })
  }

  function expectedTextFor(
    ingredient: Ingredient,
    quantityKind: QuantityKind,
    partial: string,
    offset: number,
    referenceIndex: number,
  ): { text: string | null; error: string } {
    if (quantityKind !== 'remainder') {
      const text = baseTextFor(ingredient, quantityKind, partial)
      if (!text) return { text: null, error: 'Bitte eine Menge angeben.' }
      if (!isStrictQuantityText(text)) {
        return {
          text: null,
          error:
            quantityKind === 'partial'
              ? 'Die Teilmenge muss eine reine Mengenangabe sein (die Einheit kommt aus der Zutat).'
              : 'Die Zutat hat keine eindeutige Mengenangabe. Bitte zuerst Menge und Einheit der Zutat korrigieren.',
        }
      }
      return { text, error: '' }
    }
    const laterSameIngredient =
      step.references.some(
        (reference) =>
          reference.ingredientId === ingredient.id && reference.anchorOffset > offset,
      ) ||
      hasLaterReferenceForIngredient(instructions, ingredient.id, {
        instructionIndex: stepIndex + 1,
        referenceIndex: 0,
      })
    if (laterSameIngredient) {
      return {
        text: null,
        error: 'Die übrige Menge kann nur nach allen bisherigen Teilmengen dieser Zutat stehen.',
      }
    }
    const remaining = computeRemainingQuantity(
      instructions,
      ingredients,
      ingredient.id,
      { instructionIndex: stepIndex, referenceIndex },
    )
    if (!remaining) {
      return {
        text: null,
        error:
          'Die übrige Menge ist nicht sicher berechenbar. Verwende eine ausdrückliche Teilmenge.',
      }
    }
    return { text: remaining.text, error: '' }
  }

  function linkReference() {
    setMessage('')
    if (!selectedIngredient) {
      setMessage('Bitte zuerst eine Zutat auswählen.')
      return
    }
    const selectedText = step.text.slice(selection.start, selection.end)
    const prefix = parseQuantityPrefix(selectedText)
    const expected = expectedTextFor(
      selectedIngredient,
      kind,
      partialText,
      selection.start,
      step.references.length,
    )
    if (expected.error || !expected.text) {
      setMessage(expected.error || 'Die Menge ist nicht eindeutig.')
      return
    }

    let nextText = step.text
    let anchor: string
    let anchorOffset: number

    if (selectedText.trim()) {
      if (!prefix) {
        setMessage(
          'Die markierte Stelle enthält keine lesbare Mengenangabe. Markiere z. B. „400“ oder setze den Cursor an die gewünschte Stelle.',
        )
        return
      }
      if (!quantityTextsEqual(prefix.text, expected.text)) {
        setMessage(
          `Die markierte Menge „${prefix.text}“ passt nicht zur gewählten ${KIND_LABELS[kind]} (${expected.text}).`,
        )
        return
      }
      anchor = prefix.text
      anchorOffset = selection.start + prefix.start
    } else {
      const inserted = insertion(step.text, selection.start, expected.text)
      nextText = inserted.text
      anchor = expected.text
      anchorOffset = inserted.offset
    }

    const reference: InstructionReference = {
      id: randomId(),
      ingredientId: selectedIngredient.id,
      anchor,
      anchorOffset,
      quantity:
        kind === 'partial'
          ? { kind: 'partial', quantityText: partialText.trim() }
          : { kind },
    }
    const references = normalizeReferenceAnchors(nextText, [...step.references, reference])
    onChange({ ...step, text: nextText, references })
    setSelection({ start: anchorOffset + anchor.length, end: anchorOffset + anchor.length })
    setMessage(
      kind === 'partial'
        ? 'Teilmenge verknüpft. Sie wird immer von den Originalportionen aus skaliert.'
        : 'Zutat verknüpft. Der Originaltext bleibt unverändert gespeichert.',
    )
  }

  function updateReference(
    referenceId: string,
    patch: Partial<InstructionReference>,
  ) {
    onChange({
      ...step,
      references: normalizeReferenceAnchors(
        step.text,
        step.references.map((reference) =>
          reference.id === referenceId ? { ...reference, ...patch } : reference,
        ),
      ),
    })
  }

  function changeKind(reference: InstructionReference, nextKind: QuantityKind) {
    const anchorAmount = parseQuantityPrefix(reference.anchor)?.text ?? ''
    const quantity: InstructionReferenceQuantity =
      nextKind === 'partial'
        ? {
            kind: 'partial',
            quantityText:
              reference.quantity.kind === 'partial'
                ? reference.quantity.quantityText
                : anchorAmount,
          }
        : { kind: nextKind }
    updateReference(reference.id, { quantity })
  }

  function reanchor(reference: InstructionReference) {
    setMessage('')
    const selectedText = step.text.slice(selection.start, selection.end)
    const prefix = parseQuantityPrefix(selectedText)
    if (!prefix) {
      setMessage('Bitte im Schritt die neue Mengenangabe markieren.')
      return
    }
    const referenceIndex = step.references.findIndex((entry) => entry.id === reference.id)
    const ingredient = ingredients.find((entry) => entry.id === reference.ingredientId)
    if (!ingredient) {
      setMessage('Die verknüpfte Zutat existiert nicht mehr.')
      return
    }
    const expected = expectedTextFor(
      ingredient,
      reference.quantity.kind,
      reference.quantity.kind === 'partial' ? reference.quantity.quantityText : '',
      selection.start,
      referenceIndex < 0 ? step.references.length : referenceIndex,
    )
    if (expected.error || !expected.text) {
      setMessage(expected.error || 'Die Menge ist nicht eindeutig.')
      return
    }
    if (!quantityTextsEqual(prefix.text, expected.text)) {
      setMessage(
        `Die markierte Menge „${prefix.text}“ passt nicht zur Verknüpfung (${expected.text}).`,
      )
      return
    }
    updateReference(reference.id, {
      anchor: prefix.text,
      anchorOffset: selection.start + prefix.start,
    })
    setMessage('Verknüpfung neu verankert.')
  }

  function removeReference(referenceId: string) {
    onChange({
      ...step,
      references: step.references.filter((reference) => reference.id !== referenceId),
    })
    setMessage('Verknüpfung entfernt. Der Text bleibt unverändert.')
  }

  return (
    <div className="step-reference-editor">
      <div className="step-textarea-wrap">
        <textarea
          rows={3}
          value={step.text}
          onChange={(event) => updateText(event.target.value)}
          onSelect={(event) => refreshSelection(event.currentTarget)}
          onKeyUp={(event) => refreshSelection(event.currentTarget)}
          onMouseUp={(event) => refreshSelection(event.currentTarget)}
          placeholder="Arbeitsschritt"
          aria-label={`Schritt ${stepIndex + 1}`}
        />
      </div>

      {step.references.length > 0 ? (
        <ul className="reference-list" aria-label="Verknüpfte Zutaten">
          {step.references.map((reference, referenceIndex) => {
            const ingredient =
              ingredients.find((entry) => entry.id === reference.ingredientId) ?? null
            const anchorRange = resolveReferenceAnchor(step.text, reference)
            const partialInvalid =
              reference.quantity.kind === 'partial' &&
              !isStrictQuantityText(reference.quantity.quantityText)
            const remainderInvalid =
              reference.quantity.kind === 'remainder' &&
              Boolean(ingredient) &&
              (hasLaterReferenceForIngredient(instructions, reference.ingredientId, {
                instructionIndex: stepIndex,
                referenceIndex: referenceIndex + 1,
              }) ||
                !computeRemainingQuantity(instructions, ingredients, reference.ingredientId, {
                  instructionIndex: stepIndex,
                  referenceIndex,
                }))
            const issue = !ingredient
              ? 'Zutat fehlt – bitte Verknüpfung entfernen.'
              : !anchorRange
                ? 'Mengenangabe im Text nicht gefunden – bitte neu verankern oder entfernen.'
                : partialInvalid
                  ? 'Teilmenge ist keine lesbare Mengenangabe.'
                  : remainderInvalid
                    ? 'Die übrige Menge ist nicht sicher berechenbar. Verwende eine ausdrückliche Teilmenge.'
                    : ''
            return (
              <li className={`reference-row${issue ? ' is-invalid' : ''}`} key={reference.id}>
                <div className="reference-main">
                  <strong>{ingredient?.name ?? 'Unbekannte Zutat'}</strong>
                  <span className="reference-anchor">„{reference.anchor}“</span>
                  <select
                    value={reference.quantity.kind}
                    onChange={(event) =>
                      changeKind(reference, event.target.value as QuantityKind)
                    }
                    aria-label="Mengenbezug"
                  >
                    {(['full', 'partial', 'remainder'] as const).map((option) => (
                      <option key={option} value={option}>
                        {KIND_LABELS[option]}
                      </option>
                    ))}
                  </select>
                  {reference.quantity.kind === 'partial' ? (
                    <input
                      className="reference-partial"
                      value={reference.quantity.quantityText}
                      onChange={(event) =>
                        updateReference(reference.id, {
                          quantity: {
                            kind: 'partial',
                            quantityText: event.target.value,
                          },
                        })
                      }
                      placeholder="Teilmenge"
                      aria-label="Teilmenge bezogen auf die Originalportionen"
                    />
                  ) : null}
                  <button
                    type="button"
                    className="button quiet"
                    onClick={() => reanchor(reference)}
                    disabled={!ingredient}
                  >
                    Neu verankern
                  </button>
                  <button
                    type="button"
                    className="button danger-quiet"
                    onClick={() => removeReference(reference.id)}
                  >
                    Entfernen
                  </button>
                </div>
                {issue ? <p className="reference-warning">{issue}</p> : null}
                {reference.quantity.kind === 'partial' && ingredient ? (
                  <p className="muted small">
                    Teilmenge bezogen auf die Originalportionen; Einheit aus der Zutat
                    {ingredient.unit ? ` (${ingredient.unit})` : ''}.
                  </p>
                ) : null}
              </li>
            )
          })}
        </ul>
      ) : null}

      <details className="reference-add">
        <summary>Zutat im Text verknüpfen</summary>
        {ingredients.length === 0 ? (
          <p className="muted small">Lege zuerst eine Zutat an.</p>
        ) : (
          <div className="reference-add-fields">
            <label className="field">
              <span className="field-label">Zutat</span>
              <select
                value={ingredientId}
                onChange={(event) => setIngredientId(event.target.value)}
              >
                <option value="">Zutat wählen …</option>
                {ingredients.map((ingredient) => (
                  <option key={ingredient.id} value={ingredient.id}>
                    {ingredient.name}
                    {ingredient.quantityText ? ` (${ingredient.quantityText})` : ''}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span className="field-label">Menge</span>
              <select
                value={kind}
                onChange={(event) => setKind(event.target.value as QuantityKind)}
              >
                {(['full', 'partial', 'remainder'] as const).map((option) => (
                  <option key={option} value={option}>
                    {KIND_LABELS[option]}
                  </option>
                ))}
              </select>
            </label>
            {kind === 'partial' ? (
              <label className="field">
                <span className="field-label">Teilmenge (Originalportionen)</span>
                <input
                  value={partialText}
                  onChange={(event) => setPartialText(event.target.value)}
                  placeholder="z. B. 40"
                />
              </label>
            ) : null}
            <p className="muted small reference-hint">
              Markiere im Schritt die Mengenangabe (z. B. „400“ oder „2-3“) und klicke dann
              „Verknüpfen“. Ohne Markierung wird die Menge an der Cursorposition eingefügt.
            </p>
            <button type="button" className="button primary" onClick={linkReference}>
              Verknüpfen
            </button>
          </div>
        )}
      </details>
      {message ? (
        <p className="muted small step-reference-message" role="status">
          {message}
        </p>
      ) : null}
    </div>
  )
}
