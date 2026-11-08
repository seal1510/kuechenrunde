import { useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db'
import { deleteRecipe } from '../import/importer'
import { EditorActionBar } from '../components/EditorActionBar'
import { RecipeForm } from '../components/RecipeForm'
import {
  buildRecipeFromDraft,
  draftFromRecipe,
  emptyDraft,
  type RecipeDraft,
} from '../recipe/editor'
import { editorFingerprint, hasEditorChanges } from '../recipe/editorSession'
import { confirmDiscardChanges, useUnsavedChangesGuard } from '../recipe/unsavedChanges'
import { saveRecipeWithImages, type EditorImage } from '../recipe/repository'
import type { RecipeImage } from '../types'

export function RecipeEditorPage({ id }: { id?: string }) {
  const data = useLiveQuery(async () => {
    if (!id) return { recipe: null, images: [] as RecipeImage[] }
    const recipe = await db.recipes.get(id)
    const images = recipe
      ? await db.images.where('recipeId').equals(id).sortBy('position')
      : []
    return { recipe, images }
  }, [id])

  const [draft, setDraft] = useState<RecipeDraft | null>(null)
  const [images, setImages] = useState<EditorImage[]>([])
  const [initialized, setInitialized] = useState(false)
  const [notFound, setNotFound] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const baselineRef = useRef<string | null>(null)

  useEffect(() => {
    if (initialized || !data) return
    if (!id) {
      const nextDraft = emptyDraft()
      const nextImages: EditorImage[] = []
      baselineRef.current = editorFingerprint(nextDraft, nextImages)
      setDraft(nextDraft)
      setImages(nextImages)
      setInitialized(true)
      return
    }
    if (!data.recipe) {
      setNotFound(true)
      setInitialized(true)
      return
    }
    const nextDraft = draftFromRecipe(data.recipe)
    const nextImages = data.images.map((image) => ({
      id: image.id,
      bytes: image.bytes,
      mimeType: image.mimeType,
    }))
    baselineRef.current = editorFingerprint(nextDraft, nextImages)
    setDraft(nextDraft)
    setImages(nextImages)
    setInitialized(true)
  }, [data, id, initialized])

  const dirty = useMemo(
    () => (draft ? hasEditorChanges(baselineRef.current, draft, images) : false),
    [draft, images],
  )

  useUnsavedChangesGuard(dirty, initialized && Boolean(draft))

  function handleCancel() {
    if (!draft || !confirmDiscardChanges(dirty)) return
    window.location.hash = id ? `#/recipe/${encodeURIComponent(id)}` : '#/'
  }

  async function handleDelete() {
    if (!id) return
    setDeleting(true)
    try {
      await deleteRecipe(id)
      baselineRef.current = null
      window.location.hash = '#/'
    } finally {
      setDeleting(false)
    }
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!draft) return
    if (!draft.title.trim()) {
      setError('Bitte einen Titel eingeben.')
      return
    }
    setSaving(true)
    setError('')
    try {
      const existing = id ? await db.recipes.get(id) : undefined
      if (id && !existing) throw new Error('Das Rezept wurde nicht gefunden.')
      const recipe = buildRecipeFromDraft(draft, existing)
      await saveRecipeWithImages(recipe, images)
      baselineRef.current = editorFingerprint(draft, images)
      window.location.hash = `#/recipe/${encodeURIComponent(recipe.id)}`
    } catch (cause) {
      setError((cause as Error).message || 'Das Rezept konnte nicht gespeichert werden.')
    } finally {
      setSaving(false)
    }
  }

  if (notFound) {
    return (
      <div className="page">
        <div className="empty-state">
          <p>Rezept nicht gefunden.</p>
          <a className="button" href="#/">
            Zur Bibliothek
          </a>
        </div>
      </div>
    )
  }

  if (!draft) {
    return (
      <div className="page">
        <p className="empty-state">Lade Rezept …</p>
      </div>
    )
  }

  return (
    <div className="page editor-page">
      <header className="page-head editor-head">
        <div>
          <a
            className="back-link editor-back"
            href={id ? `#/recipe/${encodeURIComponent(id)}` : '#/'}
          >
            ← {id ? 'Zum Rezept' : 'Zur Bibliothek'}
          </a>
          <h1>{id ? 'Rezept bearbeiten' : 'Neues Rezept'}</h1>
          <p className="muted small">
            {id
              ? 'Änderungen werden erst beim Speichern übernommen.'
              : 'Wird lokal als manuelles Rezept gespeichert.'}
          </p>
        </div>
      </header>

      <EditorActionBar
        formId="recipe-editor"
        saving={saving}
        dirty={dirty}
        isNew={!id}
        onCancel={handleCancel}
      />

      <RecipeForm
        formId="recipe-editor"
        draft={draft}
        onChange={setDraft}
        images={images}
        onImagesChange={setImages}
        onSubmit={handleSubmit}
        error={error}
        categoriesNote={data?.recipe?.categories.join(', ')}
      >
        {id ? (
          <section className="panel danger-zone">
            <h2>Rezept löschen</h2>
            <p className="muted small">
              Entfernt dieses Rezept und seine Bilder. Ein vorheriges Backup wird empfohlen.
            </p>
            {confirmDelete ? (
              <div className="notice danger">
                <p>Dieses Rezept und seine Bilder endgültig löschen?</p>
                <div className="notice-actions">
                  <button
                    type="button"
                    className="button danger"
                    onClick={handleDelete}
                    disabled={deleting}
                  >
                    {deleting ? 'Lösche …' : 'Endgültig löschen'}
                  </button>
                  <button type="button" className="button" onClick={() => setConfirmDelete(false)}>
                    Abbrechen
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                className="button danger-quiet"
                onClick={() => setConfirmDelete(true)}
              >
                Rezept löschen
              </button>
            )}
          </section>
        ) : null}
      </RecipeForm>
    </div>
  )
}
