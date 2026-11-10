/*
 * openCook Web
 * Copyright (C) 2026 openCook Web contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Shared editable recipe form. The normal editor and the URL import preview use
 * exactly the same component, so URL imports are corrected in the established
 * editor instead of a second, divergent recipe editor.
 */

import { useMemo, useRef, useState } from 'react'
import type { ChangeEvent, FormEvent, ReactNode } from 'react'
import { randomId } from '../lib/id'
import { Markdown, useImageUrl } from './Markdown'
import {
  EFFORT_OPTIONS,
  buildIngredientList,
  buildInstructionList,
  type DraftStep,
  type RecipeDraft,
} from '../recipe/editor'
import { renderRecipeInstructions } from '../recipe/references'
import { resolveOriginalServings } from '../domain/scaling'
import type { EditorImage } from '../recipe/repository'
import { IngredientEditor } from './IngredientEditor'
import { IngredientReferenceEditor } from './IngredientReferenceEditor'

function EditorThumb({ image, alt }: { image: EditorImage; alt: string }) {
  const url = useImageUrl(image.bytes, image.mimeType)
  return url ? <img src={url} alt={alt} /> : <span className="muted">Bild</span>
}

function TagEditor({
  label,
  values,
  onChange,
  placeholder,
}: {
  label: string
  values: string[]
  onChange: (values: string[]) => void
  placeholder: string
}) {
  const [text, setText] = useState('')
  function add() {
    const value = text.trim()
    if (!value) return
    if (!values.some((entry) => entry.toLocaleLowerCase('de') === value.toLocaleLowerCase('de'))) {
      onChange([...values, value])
    }
    setText('')
  }
  return (
    <div className="field tag-field">
      <span className="field-label">{label}</span>
      {values.length > 0 ? (
        <div className="chips">
          {values.map((value) => (
            <button
              key={value}
              type="button"
              className="chip"
              onClick={() => onChange(values.filter((entry) => entry !== value))}
              aria-label={`${value} entfernen`}
            >
              {value} <span aria-hidden="true">×</span>
            </button>
          ))}
        </div>
      ) : null}
      <div className="tag-add">
        <input
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              add()
            }
          }}
          placeholder={placeholder}
          aria-label={`${label} hinzufügen`}
        />
        <button
          type="button"
          className="button tag-add-button"
          onClick={add}
          aria-label={`${label} hinzufügen`}
        >
          <span aria-hidden="true">+</span>
        </button>
      </div>
    </div>
  )
}

export interface RecipeFormProps {
  formId: string
  draft: RecipeDraft
  onChange: (draft: RecipeDraft) => void
  images: EditorImage[]
  onImagesChange: (images: EditorImage[]) => void
  /** Im Cloud-Modus werden Bilder noch nicht gespeichert. */
  imagesEnabled?: boolean
  onSubmit: (event: FormEvent) => void
  error?: string
  categoriesNote?: string
  children?: ReactNode
}

export function RecipeForm({
  formId,
  draft,
  onChange,
  images,
  onImagesChange,
  imagesEnabled = true,
  onSubmit,
  error,
  categoriesNote,
  children,
}: RecipeFormProps) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [imageError, setImageError] = useState('')
  const [previewServings, setPreviewServings] = useState(
    () => resolveOriginalServings({ servingsText: draft.servingsText }) ?? 1,
  )

  const previewIngredients = useMemo(
    () => buildIngredientList(draft.ingredients),
    [draft.ingredients],
  )
  const previewInstructions = useMemo(
    () => buildInstructionList(draft.steps),
    [draft.steps],
  )
  // Keep the draft step indexes for remainder checks; empty steps are allowed
  // and must not shift the instruction index used by the reference editor.
  const referenceInstructions = useMemo(
    () =>
      draft.steps.map((step, index) => ({
        id: step.id ?? `draft-step-${index}`,
        position: index,
        raw: step.text,
        text: step.text,
        references: step.references,
      })),
    [draft.steps],
  )
  const previewOriginalServings = useMemo(
    () => resolveOriginalServings({ servingsText: draft.servingsText }),
    [draft.servingsText],
  )
  const preview = useMemo(
    () =>
      renderRecipeInstructions(previewInstructions, previewIngredients, {
        originalServings: previewOriginalServings,
        targetServings: previewServings,
      }),
    [previewInstructions, previewIngredients, previewOriginalServings, previewServings],
  )
  const titleInvalid = Boolean(error && !draft.title.trim())
  const errorId = `${formId}-error`

  function update<K extends keyof RecipeDraft>(key: K, value: RecipeDraft[K]) {
    onChange({ ...draft, [key]: value })
  }

  function updateStep(key: string, patch: Partial<DraftStep>) {
    onChange({
      ...draft,
      steps: draft.steps.map((step) => (step.key === key ? { ...step, ...patch } : step)),
    })
  }

  function moveStep(index: number, direction: -1 | 1) {
    const target = index + direction
    if (target < 0 || target >= draft.steps.length) return
    const steps = [...draft.steps]
    const [moved] = steps.splice(index, 1)
    if (moved) steps.splice(target, 0, moved)
    onChange({ ...draft, steps })
  }

  async function handleImages(files: FileList | null) {
    if (!files || files.length === 0) return
    const added: EditorImage[] = []
    setImageError('')
    for (const file of Array.from(files)) {
      if (!file.type.startsWith('image/')) {
        setImageError(`„${file.name}“ ist keine Bilddatei.`)
        continue
      }
      if (file.size > 10 * 1024 * 1024) {
        setImageError(`„${file.name}“ ist größer als 10 MB.`)
        continue
      }
      added.push({
        id: randomId(),
        bytes: await file.arrayBuffer(),
        mimeType: file.type || 'image/jpeg',
      })
    }
    if (added.length > 0) onImagesChange([...images, ...added])
    if (fileRef.current) fileRef.current.value = ''
  }

  function makePrimary(index: number) {
    const copy = [...images]
    const [image] = copy.splice(index, 1)
    if (image) copy.unshift(image)
    onImagesChange(copy)
  }

  const stepCount = draft.steps.length
  const ingredientCount = draft.ingredients.length

  return (
    <form id={formId} className="editor-form" onSubmit={onSubmit}>
      {error ? (
        <div id={errorId} className="notice danger" role="alert">
          {error}
        </div>
      ) : null}

      <div className="editor-layout">
        <div className="editor-top-grid">
          <section className="panel editor-panel editor-basics">
            <div className="editor-panel-head">
              <h2>Grunddaten</h2>
            </div>

            <div className="editor-title-row">
              <label className="field editor-title-field">
                <span className="field-label">Titel *</span>
                <input
                  className="editor-title-input"
                  value={draft.title}
                  onChange={(event) => update('title', event.target.value)}
                  required
                  aria-invalid={titleInvalid || undefined}
                  aria-describedby={titleInvalid ? errorId : undefined}
                />
              </label>
              <div className="editor-flags" role="group" aria-label="Rezept markieren">
                <label className={`editor-flag${draft.favorite ? ' is-active' : ''}`}>
                  <input
                    type="checkbox"
                    checked={draft.favorite}
                    onChange={(event) => update('favorite', event.target.checked)}
                  />
                  Favorit
                </label>
                <label className={`editor-flag${draft.wantToCook ? ' is-active' : ''}`}>
                  <input
                    type="checkbox"
                    checked={draft.wantToCook}
                    onChange={(event) => update('wantToCook', event.target.checked)}
                  />
                  Möchte ich kochen
                </label>
              </div>
            </div>

            <label className="field">
              <span className="field-label">Beschreibung</span>
              <textarea
                rows={3}
                value={draft.description}
                onChange={(event) => update('description', event.target.value)}
                placeholder="Kurze Einordnung, Herkunft oder Besonderheiten"
              />
            </label>

            <div className="editor-meta-grid">
              <label className="field">
                <span className="field-label">Portionen</span>
                <input
                  value={draft.servingsText}
                  onChange={(event) => update('servingsText', event.target.value)}
                  placeholder="z. B. 4 Portionen"
                />
              </label>
              <label className="field">
                <span className="field-label">Gesamtzeit</span>
                <input
                  value={draft.totalTime}
                  onChange={(event) => update('totalTime', event.target.value)}
                  placeholder="z. B. 50 min"
                />
              </label>
              <label className="field">
                <span className="field-label">Zubereitungszeit</span>
                <input
                  value={draft.prepTime}
                  onChange={(event) => update('prepTime', event.target.value)}
                  placeholder="z. B. 20 min"
                />
              </label>
              <label className="field">
                <span className="field-label">Kochzeit</span>
                <input
                  value={draft.cookTime}
                  onChange={(event) => update('cookTime', event.target.value)}
                  placeholder="z. B. 30 min"
                />
              </label>
            </div>
          </section>

          <section className="panel editor-panel editor-panel-categories">
            <div className="editor-panel-head">
              <h2>Kategorien &amp; Tags</h2>
            </div>
            <div className="form-grid category-grid">
              <TagEditor
                label="Küche"
                values={draft.cuisine}
                onChange={(values) => update('cuisine', values)}
                placeholder="z. B. indisch, italienisch"
              />
              <TagEditor
                label="Gerichtstyp"
                values={draft.dishType}
                onChange={(values) => update('dishType', values)}
                placeholder="z. B. Curry, Pasta, Suppe"
              />
              <TagEditor
                label="Tags"
                values={draft.tags}
                onChange={(values) => update('tags', values)}
                placeholder="z. B. schnell, Meal Prep, Gäste"
              />
              <label className="field">
                <span className="field-label">Aufwand</span>
                <input
                  list="effort-options"
                  value={draft.effort}
                  onChange={(event) => update('effort', event.target.value)}
                  placeholder="z. B. einfach"
                />
                <datalist id="effort-options">
                  {EFFORT_OPTIONS.map((option) => (
                    <option key={option} value={option} />
                  ))}
                </datalist>
              </label>
            </div>
          </section>
        </div>

        <section className="panel editor-panel editor-panel-ingredients">
          <div className="editor-panel-head">
            <h2>Zutaten</h2>
            <span className="editor-count">
              {ingredientCount} {ingredientCount === 1 ? 'Zutat' : 'Zutaten'}
            </span>
          </div>
          <IngredientEditor
            ingredients={draft.ingredients}
            onChange={(ingredients) => update('ingredients', ingredients)}
          />
        </section>

        <section className="panel editor-panel editor-panel-steps">
          <div className="editor-panel-head">
            <h2>Zubereitung</h2>
            <span className="editor-count">
              {stepCount} {stepCount === 1 ? 'Schritt' : 'Schritte'}
            </span>
          </div>

          <div className="step-editor" role="list" aria-label="Zubereitungsschritte">
            {draft.steps.map((step, index) => (
              <article className="step-card" key={step.key} role="listitem">
                <header className="step-card-head">
                  <span className="step-number">{index + 1}</span>
                  <span className="step-card-title">Schritt {index + 1}</span>
                  <div
                    className="step-actions"
                    role="group"
                    aria-label={`Aktionen für Schritt ${index + 1}`}
                  >
                    <button
                      type="button"
                      className="button quiet"
                      onClick={() => moveStep(index, -1)}
                      disabled={index === 0}
                      aria-label={`Schritt ${index + 1} nach oben`}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      className="button quiet"
                      onClick={() => moveStep(index, 1)}
                      disabled={index === stepCount - 1}
                      aria-label={`Schritt ${index + 1} nach unten`}
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      className="button danger-quiet"
                      onClick={() =>
                        update(
                          'steps',
                          draft.steps.filter((entry) => entry.key !== step.key),
                        )
                      }
                      aria-label={`Schritt ${index + 1} entfernen`}
                    >
                      ×
                    </button>
                  </div>
                </header>
                <IngredientReferenceEditor
                  step={step}
                  stepIndex={index}
                  ingredients={previewIngredients}
                  instructions={referenceInstructions}
                  onChange={(next) => updateStep(step.key, next)}
                />
              </article>
            ))}
          </div>

          <button
            type="button"
            className="button editor-add-button"
            onClick={() =>
              update('steps', [
                ...draft.steps,
                { key: randomId(), text: '', references: [] },
              ])
            }
          >
            <span aria-hidden="true">+</span> Schritt hinzufügen
          </button>

          <details className="editor-preview">
            <summary>
              <span>Vorschau der Zubereitung</span>
              <span className="editor-preview-meta">
                {previewInstructions.length}{' '}
                {previewInstructions.length === 1 ? 'Schritt' : 'Schritte'}
              </span>
            </summary>
            <div className="editor-preview-body">
              <div className="reference-preview-head">
                <p className="muted small">
                  Markdown wird in der Vorschau und in der Kochansicht dargestellt.
                </p>
                <label className="reference-preview-servings">
                  <span className="muted small">Portionen</span>
                  <input
                    type="number"
                    min={0.5}
                    step={0.5}
                    value={previewServings}
                    onChange={(event) => {
                      const value = Number.parseFloat(event.target.value.replace(',', '.'))
                      if (Number.isFinite(value) && value > 0) {
                        setPreviewServings(Math.round(value * 10) / 10)
                      }
                    }}
                    aria-label="Portionen für die Vorschau"
                  />
                </label>
              </div>
              {previewOriginalServings === null ? (
                <p className="notice">
                  Die Originalportionen des Rezepts sind unklar. Verknüpfte Mengen bleiben in der
                  Vorschau unverändert, bis eine eindeutige Portionszahl angegeben ist.
                </p>
              ) : null}
              {previewInstructions.length === 0 ? (
                <p className="muted small">Noch keine Zubereitungsschritte.</p>
              ) : (
                <ol className="reference-preview-steps">
                  {preview.map((entry, index) => (
                    <li key={entry.instruction.id}>
                      <span className="reference-preview-number">{index + 1}</span>
                      <div className="reference-preview-text">
                        <Markdown text={entry.text} />
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </details>
        </section>

        <div className="editor-bottom-grid">
          {imagesEnabled ? (
          <section className="panel editor-panel editor-panel-images">
            <div className="editor-panel-head">
              <h2>Bilder</h2>
              <span className="editor-count">
                {images.length} {images.length === 1 ? 'Bild' : 'Bilder'}
              </span>
            </div>
            <p className="muted small">
              Das erste Bild ist das Hauptbild. Maximal 10 MB pro Bild.
            </p>
            {imageError ? (
              <div className="notice danger" role="alert">
                {imageError}
              </div>
            ) : null}
            <div className="editor-images">
              {images.map((image, index) => (
                <figure
                  key={image.id}
                  className={`editor-image${index === 0 ? ' is-primary' : ''}`}
                >
                  <EditorThumb
                    image={image}
                    alt={index === 0 ? 'Hauptbild des Rezepts' : `Rezeptbild ${index + 1}`}
                  />
                  {index === 0 ? <span className="editor-image-badge">Hauptbild</span> : null}
                  <figcaption>
                    <span>{index === 0 ? 'Vorschau' : `Bild ${index + 1}`}</span>
                    <span className="editor-image-actions">
                      {index > 0 ? (
                        <button
                          type="button"
                          className="button quiet"
                          onClick={() => makePrimary(index)}
                        >
                          Als Hauptbild
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className="button danger-quiet"
                        onClick={() =>
                          onImagesChange(images.filter((entry) => entry.id !== image.id))
                        }
                      >
                        Entfernen
                      </button>
                    </span>
                  </figcaption>
                </figure>
              ))}
              <label className="file-picker editor-image-add">
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  multiple
                  onChange={(event: ChangeEvent<HTMLInputElement>) =>
                    void handleImages(event.target.files)
                  }
                />
                <span className="file-picker-plus" aria-hidden="true">
                  +
                </span>
                <span>Bilder hinzufügen</span>
              </label>
            </div>
          </section>
          ) : (
            <section className="panel editor-panel editor-panel-images">
              <div className="editor-panel-head">
                <h2>Bilder</h2>
              </div>
              <p className="muted small">
                Bilder werden im Cloud-Modus noch nicht unterstützt. Rezepte
                ohne Bilder funktionieren vollständig.
              </p>
            </section>
          )}

          <section className="panel editor-panel editor-advanced">
            <details>
              <summary>
                <span className="editor-disclosure-title" role="heading" aria-level={2}>
                  Erweiterte Rezeptinformationen
                </span>
                <span className="editor-disclosure-hint">
                  Quelle, Notizen und importierte Kategorien
                </span>
              </summary>
              <div className="editor-disclosure-body">
                <div className="form-grid">
                  <label className="field span-2">
                    <span className="field-label">Quelle / Link</span>
                    <input
                      value={draft.sourceUrl}
                      onChange={(event) => update('sourceUrl', event.target.value)}
                    />
                  </label>
                  <label className="field span-2">
                    <span className="field-label">Notizen</span>
                    <textarea
                      rows={4}
                      value={draft.notes}
                      onChange={(event) => update('notes', event.target.value)}
                    />
                  </label>
                </div>
                <p className="muted small editor-imported-note">
                  Importierte Kategorien: {categoriesNote || '—'}
                </p>
              </div>
            </details>
          </section>
        </div>

        {children}
      </div>
    </form>
  )
}
