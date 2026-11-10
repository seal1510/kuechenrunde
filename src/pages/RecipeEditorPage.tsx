import { useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { EditorActionBar } from '../components/EditorActionBar'
import { RecipeForm } from '../components/RecipeForm'
import {
  buildRecipeFromDraft,
  draftFromRecipe,
  emptyDraft,
  type RecipeDraft,
} from '../recipe/editor'
import type {
  RecipeEditorBackend,
  RecipeEditorLoad,
} from '../recipe/editorBackend'
import { editorFingerprint, hasEditorChanges } from '../recipe/editorSession'
import { localRecipeEditorBackend } from '../recipe/localEditorBackend'
import type { EditorImage } from '../recipe/repository'
import { useUnsavedChangesGuard } from '../recipe/unsavedChanges'

export function RecipeEditorPage({
  id,
  backend = localRecipeEditorBackend,
}: {
  id?: string
  backend?: RecipeEditorBackend
}) {
  const [data, setData] = useState<RecipeEditorLoad | null | undefined>(undefined)
  const [loadError, setLoadError] = useState('')
  const [loadToken, setLoadToken] = useState(0)
  const [draft, setDraft] = useState<RecipeDraft | null>(null)
  const [images, setImages] = useState<EditorImage[]>([])
  const [initialized, setInitialized] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const baselineRef = useRef<string | null>(null)

  useEffect(() => {
    let active = true
    setData(undefined)
    setLoadError('')
    setInitialized(false)
    setDraft(null)
    setImages([])
    baselineRef.current = null

    void backend
      .load(id)
      .then((next) => {
        if (active) setData(next)
      })
      .catch((cause: unknown) => {
        if (!active) return
        setData(null)
        setLoadError(
          cause instanceof Error && cause.message
            ? cause.message
            : 'Das Rezept konnte nicht geladen werden.',
        )
      })

    return () => {
      active = false
    }
  }, [backend, id, loadToken])

  useEffect(() => {
    if (initialized || data === undefined || data === null) return
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
      setData(null)
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

  const { requestLeave, allowNextNavigation } = useUnsavedChangesGuard(
    dirty,
    initialized && Boolean(draft),
  )

  function handleCancel() {
    if (!draft) return
    const targetHash = id ? `#/recipe/${encodeURIComponent(id)}` : '#/'
    requestLeave(() => {
      window.location.hash = targetHash
    }, targetHash)
  }

  async function handleDelete() {
    if (!id) return
    setDeleting(true)
    setError('')
    try {
      await backend.remove(id, data?.rev)
      allowNextNavigation('#/')
      baselineRef.current = null
      window.location.hash = '#/'
    } catch (cause) {
      setError(
        cause instanceof Error && cause.message
          ? cause.message
          : 'Das Rezept konnte nicht gelöscht werden.',
      )
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
      const existing = data?.recipe ?? undefined
      if (id && !existing) throw new Error('Das Rezept wurde nicht gefunden.')
      const recipe = buildRecipeFromDraft(draft, existing)
      await backend.save(recipe, images, {
        isNew: !id,
        expectedRev: data?.rev,
      })
      const targetHash = `#/recipe/${encodeURIComponent(recipe.id)}`
      allowNextNavigation(targetHash)
      baselineRef.current = editorFingerprint(draft, images)
      window.location.hash = targetHash
    } catch (cause) {
      setError(
        cause instanceof Error && cause.message
          ? cause.message
          : 'Das Rezept konnte nicht gespeichert werden.',
      )
    } finally {
      setSaving(false)
    }
  }

  if (loadError) {
    return (
      <div className="page">
        <div className="empty-state">
          <p>Rezept konnte nicht geladen werden.</p>
          <p className="muted">{loadError}</p>
          <div className="notice-actions">
            <button
              type="button"
              className="button primary"
              onClick={() => setLoadToken((value) => value + 1)}
            >
              Erneut versuchen
            </button>
            <a className="button" href="#/">
              Zur Bibliothek
            </a>
          </div>
        </div>
      </div>
    )
  }

  if (data === null) {
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
            {id ? `Änderungen werden erst beim Speichern übernommen. ${backend.storageHint}` : backend.storageHint}
          </p>
        </div>
      </header>

      <RecipeForm
        formId="recipe-editor"
        draft={draft}
        onChange={setDraft}
        images={images}
        onImagesChange={setImages}
        imagesEnabled={backend.supportsImages}
        onSubmit={handleSubmit}
        error={error}
        categoriesNote={data?.recipe?.categories.join(', ')}
      >
        {id ? (
          <section className="panel danger-zone">
            <h2>Rezept löschen</h2>
            <p className="muted small">{backend.deleteHint}</p>
            {confirmDelete ? (
              <div className="notice danger">
                <p>Dieses Rezept endgültig löschen?</p>
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

      <EditorActionBar
        formId="recipe-editor"
        saving={saving}
        dirty={dirty}
        isNew={!id}
        onCancel={handleCancel}
      />
    </div>
  )
}
