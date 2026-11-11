import { useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import {
  inspectMelaFile,
} from '../import/mela'
import type {
  ImportIssue,
  ImportProgress,
  ImportResult,
  MelaInspection,
  ParsedMelaRecipe,
} from '../types'
import { PHOTO_IMPORT_HASH, URL_IMPORT_HASH } from '../routing/routes'

type PreviewRecipe = { recipe: ParsedMelaRecipe; duplicate: boolean }
type Status = 'idle' | 'inspecting' | 'ready' | 'importing' | 'done'

export type ExistingImportIdsHandler = (ids: string[]) => Promise<Set<string>>
export type MelaImportHandler = (
  recipes: ParsedMelaRecipe[],
  onProgress?: (progress: ImportProgress) => void,
) => Promise<ImportResult>

export interface ImportPageProps {
  service?: 'local' | 'cloud'
  existingImportIds: ExistingImportIdsHandler
  importRecipes: MelaImportHandler
  /** Nur im lokalen Modus: testweises Zurücksetzen der lokalen Daten. */
  deleteAllData?: () => Promise<void>
}

export function ImportPage({
  service = 'local',
  existingImportIds,
  importRecipes,
  deleteAllData,
}: ImportPageProps) {
  const cloud = service === 'cloud'
  const inputRef = useRef<HTMLInputElement>(null)
  const [status, setStatus] = useState<Status>('idle')
  const [fileName, setFileName] = useState('')
  const [inspection, setInspection] = useState<MelaInspection | null>(null)
  const [preview, setPreview] = useState<PreviewRecipe[]>([])
  const [progress, setProgress] = useState<ImportProgress | null>(null)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [fatalError, setFatalError] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)

  async function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    setStatus('inspecting')
    setFatalError('')
    setResult(null)
    setProgress(null)
    setInspection(null)
    setPreview([])
    setFileName(file.name)

    try {
      const buffer = await file.arrayBuffer()
      const inspected = await inspectMelaFile(buffer, file.name)
      const existing = await existingImportIds(inspected.recipes.map((recipe) => recipe.importId))
      const seen = new Set<string>()
      const nextPreview = inspected.recipes.map((recipe) => {
        const duplicate = existing.has(recipe.importId) || seen.has(recipe.importId)
        seen.add(recipe.importId)
        return { recipe, duplicate }
      })
      setInspection(inspected)
      setPreview(nextPreview)
      setStatus('ready')
    } catch (error) {
      setFatalError((error as Error).message || 'Die Datei konnte nicht gelesen werden.')
      setStatus('idle')
    } finally {
      // Allow selecting the same file again after an error.
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  async function handleImport() {
    const candidates = preview.filter((entry) => !entry.duplicate).map((entry) => entry.recipe)
    const duplicateCount = preview.filter((entry) => entry.duplicate).length
    if (candidates.length === 0) return
    setStatus('importing')
    setProgress({ current: 0, total: candidates.length, title: '' })
    try {
      const imported = await importRecipes(candidates, setProgress)
      setResult({ ...imported, duplicates: imported.duplicates + duplicateCount })
      setStatus('done')
      setPreview((current) => current.map((entry) => ({ ...entry, duplicate: true })))
    } catch (error) {
      setFatalError((error as Error).message || 'Der Import ist fehlgeschlagen.')
      setStatus('ready')
    }
  }

  async function handleDeleteAll() {
    if (!deleteAllData) return
    setDeleting(true)
    try {
      await deleteAllData()
      setConfirmDelete(false)
      setPreview([])
      setInspection(null)
      setResult(null)
      setFileName('')
      setStatus('idle')
    } finally {
      setDeleting(false)
    }
  }

  const importable = preview.filter((entry) => !entry.duplicate).length
  const totalWarnings =
    (inspection?.issues.filter((issue) => issue.severity === 'warning').length ?? 0) +
    preview.reduce((sum, entry) => sum + entry.recipe.warnings.length, 0)

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Mela-Import</h1>
          <p className="muted">
            {cloud
              ? 'Datei auswählen, prüfen, importieren. Die Datei wird in diesem Browser gelesen; gespeichert wird in der Familien-Cloud.'
              : 'Datei auswählen, prüfen, importieren. Die Verarbeitung findet vollständig in diesem Browser statt.'}
          </p>
        </div>
        <div className="page-head-actions">
          {cloud ? (
            <a className="button" href={PHOTO_IMPORT_HASH}>
              Foto / Scan
            </a>
          ) : null}
          <a className="button primary" href={URL_IMPORT_HASH}>
            Rezept per URL
          </a>
          <a className="button" href="#/">
            Zur Bibliothek
          </a>
        </div>
      </header>

      {cloud ? (
        <section className="panel photo-import-entry">
          <div className="photo-import-entry-head">
            <span className="photo-import-entry-icon" aria-hidden="true">
              📷
            </span>
            <div>
              <h2>Foto / Scan</h2>
              <p className="muted">
                Gedruckte oder handschriftliche Familienrezepte abfotografieren oder einscannen.
                Die Seiten werden im vorhandenen Rezepteditor geprüft und erst nach Bestätigung in
                der Familien-Cloud gespeichert.
              </p>
            </div>
          </div>
          <a className="button primary" href={PHOTO_IMPORT_HASH}>
            Foto / Scan starten
          </a>
        </section>
      ) : null}

      <section className="panel">
        <h2>Webseite statt Datei</h2>
        <p className="muted">
          {cloud
            ? 'Rezepte können auch direkt von einer öffentlichen Webseite importiert werden. Der Abruf läuft über den abgesicherten Importdienst der Familien-Cloud und wird vor dem Speichern als bearbeitbare Vorschau angezeigt.'
            : 'Rezepte können auch direkt von einer öffentlichen Webseite importiert werden. Der Abruf läuft über den lokalen Importdienst und wird vor dem Speichern als bearbeitbare Vorschau angezeigt.'}
        </p>
        <a className="button" href={URL_IMPORT_HASH}>
          Rezept per URL importieren
        </a>
      </section>

      <section className="panel">
        <h2>Datei auswählen</h2>
        <p className="muted">
          Unterstützt <code>.melarecipe</code> (JSON) und <code>.melarecipes</code> (ZIP). Bilder
          werden als Base64 aus der Datei gelesen und{' '}
          {cloud ? 'im privaten Familienspeicher' : 'lokal in IndexedDB'} gespeichert.
        </p>
        <label className="file-picker">
          <input
            ref={inputRef}
            type="file"
            accept=".melarecipe,.melarecipes,.json,.zip,application/json,application/zip"
            onChange={handleFile}
            disabled={status === 'inspecting' || status === 'importing'}
          />
          <span>{status === 'inspecting' ? 'Prüfe Datei …' : 'Mela-Datei auswählen'}</span>
        </label>
        {fileName ? <p className="muted small">Ausgewählt: {fileName}</p> : null}
        <p className="muted small">
          Hinweis: Es wurde noch kein realer Mela-Export validiert. Die Tests verwenden synthetische
          Fixtures; bitte einen eigenen Export (nicht ins Repository) gegenprüfen.
        </p>
      </section>

      {fatalError ? (
        <div className="notice danger" role="alert">
          <p>{fatalError}</p>
        </div>
      ) : null}

      {inspection ? (
        <section className="panel">
          <h2>Vorschau</h2>
          <p className="muted">
            {inspection.recipes.length} Rezept{inspection.recipes.length === 1 ? '' : 'e'} erkannt,{' '}
            {importable} neu, {preview.length - importable} bereits vorhanden oder doppelt,{' '}
            {totalWarnings} Hinweis{totalWarnings === 1 ? '' : 'e'}.
          </p>

          {inspection.issues.length > 0 ? <IssueList issues={inspection.issues} /> : null}

          {preview.length === 0 ? (
            <p className="muted">Keine importierbaren Rezepte gefunden.</p>
          ) : (
            <ul className="preview-list">
              {preview.map(({ recipe, duplicate }, index) => (
                <li key={`${recipe.importId}-${index}`} className={duplicate ? 'is-duplicate' : ''}>
                  <div>
                    <strong>{recipe.title}</strong>
                    <div className="muted small">
                      {recipe.ingredients.length} Zutaten · {recipe.instructions.length} Schritte ·{' '}
                      {recipe.images.length} Bild{recipe.images.length === 1 ? '' : 'er'}
                      {recipe.categories.length > 0 ? ` · ${recipe.categories.join(', ')}` : ''}
                    </div>
                    {recipe.warnings.length > 0 ? (
                      <ul className="warning-list">
                        {recipe.warnings.map((warning) => (
                          <li key={warning}>{warning}</li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                  <span className={`badge ${duplicate ? 'subtle' : ''}`}>
                    {duplicate ? 'Bereits vorhanden' : 'Neu'}
                  </span>
                </li>
              ))}
            </ul>
          )}

          {status === 'ready' && importable > 0 ? (
            <button type="button" className="button primary" onClick={handleImport}>
              {importable} Rezept{importable === 1 ? '' : 'e'} importieren
            </button>
          ) : null}
        </section>
      ) : null}

      {status === 'importing' && progress ? (
        <section className="panel" aria-live="polite">
          <h2>Importiere …</h2>
          <p>
            {progress.current} / {progress.total}
            {progress.title ? ` · ${progress.title}` : ''}
          </p>
          <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={progress.total} aria-valuenow={progress.current}>
            <span style={{ width: `${progress.total > 0 ? (progress.current / progress.total) * 100 : 0}%` }} />
          </div>
        </section>
      ) : null}

      {result ? (
        <section className="panel" aria-live="polite">
          <h2>Import-Ergebnis</h2>
          <ul className="result-list">
            <li>
              <strong>{result.imported}</strong> importiert
            </li>
            <li>
              <strong>{result.duplicates}</strong> Duplikat{result.duplicates === 1 ? '' : 'e'} übersprungen
            </li>
            <li>
              <strong>{result.images}</strong> Bild{result.images === 1 ? '' : 'er'} gespeichert
            </li>
            <li>
              <strong>{result.failed.length}</strong> fehlgeschlagen
            </li>
          </ul>
          {result.failed.length > 0 ? (
            <div className="notice danger">
              <h3>Fehler</h3>
              <ul>
                {result.failed.map((failure) => (
                  <li key={`${failure.title}-${failure.message}`}>
                    <strong>{failure.title}:</strong> {failure.message}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {result.warnings.length > 0 ? (
            <details className="notice">
              <summary>{result.warnings.length} Hinweis(e) zum Import</summary>
              <ul>
                {result.warnings.map((warning, index) => (
                  <li key={`${warning.title}-${index}`}>
                    <strong>{warning.title}:</strong> {warning.message}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
          <a className="button primary" href="#/">
            Zur Bibliothek
          </a>
        </section>
      ) : null}

      {deleteAllData ? (
        <section className="panel">
          <h2>Testdaten</h2>
          <p className="muted">
            Alle importierten Rezepte und Bilder liegen ausschließlich in diesem Browser. Zum
            vollständigen Zurücksetzen kannst du sie hier löschen.
          </p>
          {confirmDelete ? (
            <div className="notice danger">
              <p>Wirklich alle lokalen Rezepte, Bilder, Planungen, Tagesnotizen und Einkaufsdaten löschen?</p>
              <div className="notice-actions">
                <button type="button" className="button danger" onClick={handleDeleteAll} disabled={deleting}>
                  {deleting ? 'Lösche …' : 'Endgültig löschen'}
                </button>
                <button type="button" className="button" onClick={() => setConfirmDelete(false)}>
                  Abbrechen
                </button>
              </div>
            </div>
          ) : (
            <button type="button" className="button danger-quiet" onClick={() => setConfirmDelete(true)}>
              Alle Testdaten löschen
            </button>
          )}
        </section>
      ) : null}
    </div>
  )
}

function IssueList({ issues }: { issues: ImportIssue[] }) {
  return (
    <div className="notice">
      <h3>Dateihinweise</h3>
      <ul>
        {issues.map((issue, index) => (
          <li key={`${issue.file}-${index}`} className={issue.severity === 'error' ? 'text-danger' : ''}>
            <strong>{issue.file}:</strong> {issue.message}
          </li>
        ))}
      </ul>
    </div>
  )
}
