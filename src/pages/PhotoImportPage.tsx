/*
 * Küchenrunde – Foto-/Scan-Import (Browseroberfläche)
 * Copyright (C) 2026 openCook Web contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Der Import läuft in vier klaren Schritten:
 *  1. Fotos aufnehmen/auswählen (iPhone) oder Dateien wählen/ziehen (Desktop),
 *     optional PDF-Seiten im Browser umwandeln.
 *  2. Seiten prüfen, ordnen, ersetzen oder entfernen.
 *  3. „Rezept erkennen“ – nur 1–4 Seiten, mit Ladezustand und Abbruch.
 *  4. Ergebnis im vorhandenen RecipeForm korrigieren und erst nach
 *     ausdrücklicher Bestätigung speichern.
 *
 * Fotos werden nie ungefragt dauerhaft gespeichert: Die Checkbox
 * „Seitenfotos als Rezeptbilder mitspeichern“ ist standardmäßig aus; nur dann
 * laufen die Seitenbilder durch die bestehende Cloud-Bildpipeline.
 */

import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import type { ChangeEvent, DragEvent, FormEvent } from 'react'
import { RecipeForm } from '../components/RecipeForm'
import { useImageUrl } from '../lib/useImageUrl'
import type { RecipeDraft } from '../recipe/editor'
import type { EditorImage } from '../recipe/repository'
import type { Recipe } from '../types'
import {
  PHOTO_OCR_MAX_PAGES,
  PHOTO_OCR_MAX_TOTAL_BYTES,
  type PhotoOcrErrorCode,
  type PhotoOcrPage,
} from '../import/photo-ocr'
import {
  PhotoOcrRequestError,
  isPhotoOcrAbort,
  photoOcrErrorMessage,
  type PhotoOcrResult,
} from '../import/photo-ocr-client'
import {
  formatPhotoBytes,
  isPdfPhotoFile,
  preparePhotoFiles,
  toEditorImages,
  toOcrPage,
  validatePhotoPageCount,
  validatePhotoTotalBytes,
  type PhotoFilePreparer,
  type PreparedPhotoPage,
} from '../import/photo-image'
import {
  renderPdfToPhotoPages,
  type PdfPhotoResult,
} from '../import/photo-pdf'
import {
  buildPhotoRecipe,
  draftFromOcrRecipe,
  isUnrecognizedOcrRecipe,
  photoDraftNotices,
  photoImportId,
  type PhotoDraftNotice,
} from '../import/photo-draft'

/* ---------------------------------------------------------------- */
/* Öffentliche Schnittstellen                                        */
/* ---------------------------------------------------------------- */

export interface PhotoRecognizeOptions {
  signal?: AbortSignal
}

export type PhotoRecognizeHandler = (
  pages: PhotoOcrPage[],
  options: PhotoRecognizeOptions,
) => Promise<PhotoOcrResult>

export type PhotoSaveHandler = (
  recipe: Recipe,
  images: EditorImage[],
) => Promise<string[] | void>

export interface PhotoImportPageProps {
  /** Same-origin OCR call; wired by the cloud page with the access token. */
  recognize: PhotoRecognizeHandler
  /** Existing cloud image pipeline; only called after explicit confirmation. */
  saveRecipe: PhotoSaveHandler
  /** Inject/test seam for the browser image pipeline. */
  prepareFile?: PhotoFilePreparer
  /** Inject/test seam for the PDF renderer. */
  renderPdf?: (file: File) => Promise<PdfPhotoResult>
  /** Injectable clock for deterministic metadata. */
  now?: () => number
}

export type PhotoImportStatus = 'idle' | 'recognizing' | 'review' | 'saving' | 'saved'

export interface PhotoSavedResult {
  id: string
  title: string
  warnings: string[]
}

export interface PhotoImportState {
  status: PhotoImportStatus
  pages: PreparedPhotoPage[]
  /** Fehler der letzten Dateiauswahl (zu groß, nicht lesbar, …). */
  selectionErrors: string[]
  /** Warnings der Bild-/PDF-Aufbereitung (kleine Fotos, PDF-Seitenlimit). */
  selectionWarnings: string[]
  recognizingPageCount: number
  error: string
  errorCode: PhotoOcrErrorCode | null
  manualFallback: boolean
  result: PhotoOcrResult | null
  draft: RecipeDraft | null
  notices: PhotoDraftNotice[]
  recognizedAt: number
  importId: string | null
  includePhotos: boolean
  images: EditorImage[]
  saved: PhotoSavedResult | null
}

export function initialPhotoImportState(): PhotoImportState {
  return {
    status: 'idle',
    pages: [],
    selectionErrors: [],
    selectionWarnings: [],
    recognizingPageCount: 0,
    error: '',
    errorCode: null,
    manualFallback: false,
    result: null,
    draft: null,
    notices: [],
    recognizedAt: 0,
    importId: null,
    includePhotos: false,
    images: [],
    saved: null,
  }
}

export function totalPhotoBytes(pages: readonly PreparedPhotoPage[]): number {
  return pages.reduce((sum, page) => sum + page.bytes.byteLength, 0)
}

export function canStartRecognition(pages: readonly PreparedPhotoPage[]): boolean {
  return pages.length >= 1 && pages.length <= PHOTO_OCR_MAX_PAGES
}

export function canAddPhotoPage(pages: readonly PreparedPhotoPage[]): boolean {
  return pages.length < PHOTO_OCR_MAX_PAGES
}

/* ---------------------------------------------------------------- */
/* Dateiauswahl (auch ohne React testbar)                            */
/* ---------------------------------------------------------------- */

export interface PhotoSelectionDeps {
  prepareImage?: PhotoFilePreparer
  renderPdf?: (file: File) => Promise<PdfPhotoResult>
}

export interface PhotoSelectionResult {
  pages: PreparedPhotoPage[]
  errors: string[]
  warnings: string[]
}

/**
 * Verarbeitet die Dateiauswahl aus `<input type="file">` oder Drag & Drop:
 * Bilder laufen durch die JPEG-Pipeline, PDFs werden im Browser in Seiten
 * gerendert. Das Gesamtbudget aus dem Vertrag wird fortlaufend geprüft.
 */
export async function selectPhotoPages(
  existing: readonly PreparedPhotoPage[],
  files: readonly File[],
  deps: PhotoSelectionDeps = {},
): Promise<PhotoSelectionResult> {
  const imageFiles = files.filter((file) => !isPdfPhotoFile(file))
  const pdfFiles = files.filter((file) => isPdfPhotoFile(file))
  const errors: string[] = []
  const warnings: string[] = []

  const imageBatch = await preparePhotoFiles(imageFiles, existing, {
    prepare: deps.prepareImage,
  })
  const pages: PreparedPhotoPage[] = [...existing, ...imageBatch.pages]
  errors.push(...imageBatch.errors)
  warnings.push(...imageBatch.warnings)

  const renderPdf = deps.renderPdf ?? renderPdfToPhotoPages
  for (const file of pdfFiles) {
    if (!canAddPhotoPage(pages)) {
      errors.push(
        `Es sind höchstens ${PHOTO_OCR_MAX_PAGES} Seiten pro Rezept möglich. Bitte zuerst eine Seite entfernen.`,
      )
      break
    }
    try {
      const rendered = await renderPdf(file)
      warnings.push(...rendered.warnings)
      for (const page of rendered.pages) {
        if (!canAddPhotoPage(pages)) {
          errors.push(
            `Es sind höchstens ${PHOTO_OCR_MAX_PAGES} Seiten pro Rezept möglich; weitere PDF-Seiten wurden nicht übernommen.`,
          )
          break
        }
        const totalCheck = validatePhotoTotalBytes(totalPhotoBytes(pages) + page.bytes.byteLength)
        if (totalCheck) {
          errors.push(totalCheck.message)
          break
        }
        pages.push(page)
      }
    } catch (cause) {
      errors.push(
        cause instanceof Error && cause.message
          ? cause.message
          : `„${file.name}“ konnte nicht als PDF gelesen werden.`,
      )
    }
  }

  return { pages, errors, warnings }
}

/** Ersetzt genau eine Seite durch ein neu ausgewähltes Bild. */
export async function prepareReplacementPhotoPage(
  currentPages: readonly PreparedPhotoPage[],
  id: string,
  file: File,
  deps: PhotoSelectionDeps = {},
): Promise<{ page: PreparedPhotoPage | null; warning: string | null; error: string | null }> {
  if (isPdfPhotoFile(file)) {
    return {
      page: null,
      warning: null,
      error: 'Zum Ersetzen bitte ein einzelnes Bild auswählen (kein PDF).',
    }
  }
  const others = currentPages.filter((page) => page.id !== id)
  const batch = await preparePhotoFiles([file], others, { prepare: deps.prepareImage })
  const page = batch.pages[0] ?? null
  return {
    page,
    warning: batch.warnings[0] ?? null,
    error: batch.errors[0] ?? null,
  }
}

/* ---------------------------------------------------------------- */
/* Controller (ohne DOM testbar)                                     */
/* ---------------------------------------------------------------- */

export interface PhotoImportControllerDeps {
  recognize: PhotoRecognizeHandler
  saveRecipe: PhotoSaveHandler
  prepareImage?: PhotoFilePreparer
  renderPdf?: (file: File) => Promise<PdfPhotoResult>
  now?: () => number
}

export class PhotoImportController {
  private state: PhotoImportState = initialPhotoImportState()
  private readonly listeners = new Set<() => void>()
  private readonly deps: PhotoImportControllerDeps
  private recognitionToken = 0
  private abort: AbortController | null = null

  constructor(deps: PhotoImportControllerDeps) {
    this.deps = deps
  }

  getState = (): PhotoImportState => this.state

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private setState(patch: Partial<PhotoImportState>): void {
    this.state = { ...this.state, ...patch }
    for (const listener of this.listeners) listener()
  }

  /** Fotos/PDFs aus Dateiauswahl oder Drag & Drop hinzufügen (nur vor Erkennung). */
  async addFiles(files: readonly File[]): Promise<void> {
    if (this.state.status !== 'idle' || files.length === 0) return
    try {
      const result = await selectPhotoPages(this.state.pages, files, {
        prepareImage: this.deps.prepareImage,
        renderPdf: this.deps.renderPdf,
      })
      if (this.state.status !== 'idle') return
      this.setState({
        pages: result.pages,
        selectionErrors: result.errors,
        selectionWarnings: result.warnings,
        error: '',
        errorCode: null,
        manualFallback: false,
      })
    } catch (cause) {
      if (this.state.status !== 'idle') return
      this.setState({
        selectionErrors: [
          cause instanceof Error && cause.message
            ? cause.message
            : 'Die ausgewählten Dateien konnten nicht verarbeitet werden.',
        ],
        selectionWarnings: [],
      })
    }
  }

  /** Nur für Tests/Dateiauswahl: direkt einsortierte Seiten übernehmen. */
  setPages(pages: PreparedPhotoPage[]): void {
    if (this.state.status !== 'idle') return
    this.setState({ pages })
  }

  movePage(index: number, direction: -1 | 1): void {
    if (this.state.status !== 'idle') return
    const target = index + direction
    if (target < 0 || target >= this.state.pages.length) return
    const pages = [...this.state.pages]
    const [moved] = pages.splice(index, 1)
    if (moved) pages.splice(target, 0, moved)
    this.setState({ pages })
  }

  removePage(id: string): void {
    if (this.state.status !== 'idle') return
    this.setState({ pages: this.state.pages.filter((page) => page.id !== id) })
  }

  async replacePage(id: string, file: File): Promise<void> {
    if (this.state.status !== 'idle') return
    const result = await prepareReplacementPhotoPage(
      this.state.pages,
      id,
      file,
      { prepareImage: this.deps.prepareImage },
    )
    if (this.state.status !== 'idle') return
    if (!result.page) {
      this.setState({
        selectionErrors: result.error ? [result.error] : [],
        selectionWarnings: result.warning ? [result.warning] : [],
      })
      return
    }
    const page = result.page
    this.setState({
      pages: this.state.pages.map((entry) => (entry.id === id ? page : entry)),
      selectionErrors: [],
      selectionWarnings: result.warning ? [result.warning] : [],
    })
  }

  /** „Rezept erkennen“: 1–4 Seiten, Ladezustand, Abbrechen. */
  async recognize(): Promise<void> {
    if (this.state.status === 'recognizing' || this.state.status === 'saving') return
    const pages = this.state.pages
    const countCheck = validatePhotoPageCount(0, pages.length)
    if (!canStartRecognition(pages) || countCheck) {
      this.setState({
        error:
          countCheck?.message ??
          `Bitte 1 bis ${PHOTO_OCR_MAX_PAGES} Seiten auswählen, bevor die Erkennung startet.`,
        errorCode: null,
        manualFallback: false,
      })
      return
    }

    const token = this.recognitionToken + 1
    this.recognitionToken = token
    const controller = new AbortController()
    this.abort = controller
    this.setState({
      status: 'recognizing',
      recognizingPageCount: pages.length,
      error: '',
      errorCode: null,
      manualFallback: false,
      saved: null,
    })

    try {
      const result = await this.deps.recognize(pages.map(toOcrPage), {
        signal: controller.signal,
      })
      if (token !== this.recognitionToken) return
      if (isUnrecognizedOcrRecipe(result.recipe)) {
        this.setState({
          status: 'idle',
          recognizingPageCount: 0,
          result,
          draft: null,
          notices: photoDraftNotices(result.recipe, result.pages),
          error:
            'Auf den Fotos wurde kein Rezept erkannt. Bitte schärfere Fotos verwenden oder das Rezept manuell anlegen.',
          errorCode: null,
          manualFallback: true,
        })
        return
      }
      const recognizedAt = (this.deps.now ?? Date.now)()
      this.setState({
        status: 'review',
        recognizingPageCount: 0,
        result,
        draft: draftFromOcrRecipe(result.recipe),
        notices: photoDraftNotices(result.recipe, result.pages),
        recognizedAt,
        importId: photoImportId(recognizedAt),
        includePhotos: false,
        images: [],
        error: '',
        errorCode: null,
        manualFallback: false,
      })
    } catch (cause) {
      if (token !== this.recognitionToken) return
      if (isPhotoOcrAbort(cause)) {
        this.setState({ status: 'idle', recognizingPageCount: 0 })
        return
      }
      const code = cause instanceof PhotoOcrRequestError ? cause.code : null
      this.setState({
        status: 'idle',
        recognizingPageCount: 0,
        error:
          cause instanceof Error && cause.message
            ? cause.message
            : code
              ? photoOcrErrorMessage(code)
              : 'Die Foto-Erkennung ist fehlgeschlagen. Bitte erneut versuchen.',
        errorCode: code,
        manualFallback: true,
      })
    } finally {
      if (this.abort === controller) this.abort = null
    }
  }

  cancelRecognition(): void {
    this.recognitionToken += 1
    this.abort?.abort()
    this.abort = null
    if (this.state.status === 'recognizing') {
      this.setState({ status: 'idle', recognizingPageCount: 0, error: '' })
    }
  }

  changeDraft(draft: RecipeDraft): void {
    if (!this.state.draft) return
    this.setState({ draft })
  }

  setIncludePhotos(value: boolean): void {
    if (!this.state.draft) return
    this.setState({
      includePhotos: value,
      images: value ? toEditorImages(this.state.pages) : [],
    })
  }

  changeImages(images: EditorImage[]): void {
    // Ohne Häkchen werden Seitenfotos nicht gespeichert; manuelle
    // Bildänderungen im Editor bleiben in diesem Import deshalb wirkungslos.
    if (!this.state.includePhotos) return
    this.setState({ images })
  }

  /** Speichert erst nach ausdrücklicher Bestätigung. */
  async save(): Promise<void> {
    const { draft, result, status } = this.state
    if (status !== 'review' || !draft || !result) return
    if (!draft.title.trim()) {
      this.setState({ error: 'Bitte einen Titel eingeben, bevor das Rezept gespeichert wird.' })
      return
    }
    const recognizedAt = this.state.recognizedAt || (this.deps.now ?? Date.now)()
    const importId = this.state.importId ?? photoImportId(recognizedAt)
    this.setState({ status: 'saving', error: '', importId })
    try {
      const recipe = buildPhotoRecipe(draft, {
        model: result.model,
        pageCount: this.state.pages.length,
        recognizedAt,
        pages: result.pages,
        uncertainties: result.recipe.uncertainties,
        warnings: result.recipe.warnings,
        importId,
      })
      const images = this.state.includePhotos ? this.state.images : []
      const warnings = (await this.deps.saveRecipe(recipe, images)) ?? []
      this.setState({
        status: 'saved',
        saved: { id: recipe.id, title: recipe.title, warnings },
      })
    } catch (cause) {
      this.setState({
        status: 'review',
        error:
          cause instanceof Error && cause.message
            ? cause.message
            : 'Das Rezept konnte nicht gespeichert werden.',
      })
    }
  }

  /** Verwirft alles: keine Rezeptänderung, keine Speicherung. */
  reset(): void {
    this.cancelRecognition()
    this.setState(initialPhotoImportState())
  }

  /** Beim Unmount eines laufenden Erkennungsaufrufs abbrechen. */
  dispose(): void {
    this.recognitionToken += 1
    this.abort?.abort()
    this.abort = null
  }
}

/* ---------------------------------------------------------------- */
/* Teilkomponenten                                                   */
/* ---------------------------------------------------------------- */

function PhotoPageThumb({
  page,
  index,
  large = false,
}: {
  page: PreparedPhotoPage
  index: number
  large?: boolean
}) {
  const url = useImageUrl(page.bytes, page.mimeType)
  if (!url) {
    return (
      <span className={large ? 'photo-page-placeholder is-large' : 'photo-page-placeholder'}>
        Seite {index + 1}
      </span>
    )
  }
  return (
    <img
      src={url}
      alt={large ? `Seite ${index + 1} in groß` : `Vorschau Seite ${index + 1}`}
      className={large ? 'photo-page-large-image' : undefined}
    />
  )
}

function PhotoDropzone({ onFiles }: { onFiles: (files: File[]) => void }) {
  const [dragging, setDragging] = useState(false)
  function handleDragOver(event: DragEvent<HTMLDivElement>) {
    event.preventDefault()
    setDragging(true)
  }
  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault()
    setDragging(false)
    const files = Array.from(event.dataTransfer.files ?? [])
    if (files.length > 0) onFiles(files)
  }
  return (
    <div
      className={`photo-dropzone${dragging ? ' is-dragging' : ''}`}
      onDragOver={handleDragOver}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
      role="region"
      aria-label="Dateien hier ablegen"
    >
      <span className="photo-dropzone-icon" aria-hidden="true">
        ↓
      </span>
      <p>
        <strong>Bilder oder ein PDF hierher ziehen</strong>
      </p>
      <p className="muted small">Am Computer kannst du Dateien auch direkt ablegen.</p>
    </div>
  )
}

export interface PhotoImportViewProps {
  state: PhotoImportState
  onAddFiles: (files: File[]) => void
  onReplacePage: (id: string, file: File) => void
  onMovePage: (index: number, direction: -1 | 1) => void
  onRemovePage: (id: string) => void
  onRecognize: () => void
  onCancelRecognition: () => void
  onChangeDraft: (draft: RecipeDraft) => void
  onChangeImages: (images: EditorImage[]) => void
  onIncludePhotos: (value: boolean) => void
  onSave: () => void
  onReset: () => void
}

function PhotoPageList({
  state,
  onMovePage,
  onRemovePage,
  onReplacePage,
}: Pick<PhotoImportViewProps, 'state' | 'onMovePage' | 'onRemovePage' | 'onReplacePage'>) {
  const editable = state.status === 'idle'
  const total = totalPhotoBytes(state.pages)
  return (
    <section className="panel photo-pages-panel">
      <div className="photo-panel-head">
        <div>
          <h2>Seiten</h2>
          <p className="muted small">
            {state.pages.length} von {PHOTO_OCR_MAX_PAGES} Seiten ·{' '}
            {formatPhotoBytes(total)} von {formatPhotoBytes(PHOTO_OCR_MAX_TOTAL_BYTES)}
          </p>
        </div>
        <span className="badge subtle">Reihenfolge = Lesereihenfolge</span>
      </div>
      <ol className="photo-page-list">
        {state.pages.map((page, index) => (
          <li className="photo-page" key={page.id}>
            <div className="photo-page-thumb">
              <PhotoPageThumb page={page} index={index} />
            </div>
            <div className="photo-page-body">
              <p className="photo-page-title">Seite {index + 1}</p>
              <p className="muted small">
                {page.width} × {page.height} · {formatPhotoBytes(page.bytes.byteLength)}
              </p>
              {editable ? (
                <div
                  className="photo-page-actions"
                  role="group"
                  aria-label={`Aktionen für Seite ${index + 1}`}
                >
                  <button
                    type="button"
                    className="button quiet"
                    onClick={() => onMovePage(index, -1)}
                    disabled={index === 0}
                    aria-label={`Seite ${index + 1} nach oben`}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className="button quiet"
                    onClick={() => onMovePage(index, 1)}
                    disabled={index === state.pages.length - 1}
                    aria-label={`Seite ${index + 1} nach unten`}
                  >
                    ↓
                  </button>
                  <label className="button quiet photo-page-replace">
                    <input
                      type="file"
                      accept="image/*"
                      onChange={(event: ChangeEvent<HTMLInputElement>) => {
                        const file = event.target.files?.[0]
                        event.target.value = ''
                        if (file) onReplacePage(page.id, file)
                      }}
                    />
                    Ersetzen
                  </label>
                  <button
                    type="button"
                    className="button danger-quiet"
                    onClick={() => onRemovePage(page.id)}
                    aria-label={`Seite ${index + 1} entfernen`}
                  >
                    Entfernen
                  </button>
                </div>
              ) : (
                <p className="muted small photo-page-locked">
                  Fotos sind für diese Erkennung gesperrt. Mit „Verwerfen“ startest du neu.
                </p>
              )}
              <details className="photo-page-compare">
                <summary>Groß ansehen</summary>
                <div className="photo-page-large">
                  <PhotoPageThumb page={page} index={index} large />
                </div>
              </details>
            </div>
          </li>
        ))}
      </ol>
    </section>
  )
}

/**
 * Reine Darstellung des Importzustands. Alle Aktionen kommen von außen, damit
 * die Oberfläche ohne Browser (statisches Markup) testbar bleibt.
 */
export function PhotoImportView({
  state,
  onAddFiles,
  onReplacePage,
  onMovePage,
  onRemovePage,
  onRecognize,
  onCancelRecognition,
  onChangeDraft,
  onChangeImages,
  onIncludePhotos,
  onSave,
  onReset,
}: PhotoImportViewProps) {
  const busy = state.status === 'recognizing' || state.status === 'saving'
  const fileInputDisabled = busy
  const captureDisabled = busy || !canAddPhotoPage(state.pages)
  const recognizeDisabled = !canStartRecognition(state.pages) || busy
  const total = totalPhotoBytes(state.pages)

  if (state.saved) {
    return (
      <div className="page photo-import-page">
        <header className="page-head">
          <div>
            <h1>Rezept per Foto oder Scan importieren</h1>
            <p className="muted">Fotos aufnehmen, erkennen, prüfen und speichern.</p>
          </div>
        </header>
        <section className="panel" aria-live="polite">
          <h2>Rezept gespeichert</h2>
          <p>
            <strong>{state.saved.title}</strong> wurde in der Familien-Cloud gespeichert.
          </p>
          {state.saved.warnings.length > 0 ? (
            <div className="notice">
              <ul>
                {state.saved.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            </div>
          ) : null}
          <div className="notice-actions">
            <a className="button primary" href={`#/recipe/${encodeURIComponent(state.saved.id)}`}>
              Rezept öffnen
            </a>
            <button type="button" className="button" onClick={onReset}>
              Weiteres Foto importieren
            </button>
          </div>
        </section>
      </div>
    )
  }

  return (
    <div className="page photo-import-page">
      <header className="page-head">
        <div>
          <h1>Rezept per Foto oder Scan importieren</h1>
          <p className="muted">
            Gedruckte oder handschriftliche Familienrezepte fotografieren, erkennen lassen und im
            vorhandenen Editor korrigieren. Gespeichert wird erst nach ausdrücklicher Bestätigung.
          </p>
        </div>
        <div className="page-head-actions">
          <a className="button" href="#/import">
            Andere Importwege
          </a>
          <a className="button quiet" href="#/">
            Zur Bibliothek
          </a>
        </div>
      </header>

      {state.error ? (
        <div className="notice danger" role="alert">
          <p>{state.error}</p>
          {state.errorCode === 'quota-exhausted' ? (
            <p className="muted small">
              Es entstehen keine Kosten. Bitte morgen erneut versuchen oder das Rezept manuell
              anlegen.
            </p>
          ) : null}
          {state.errorCode === 'not-configured' ? (
            <p className="muted small">
              Der Erkennungsdienst ist auf diesem Deployment nicht eingerichtet. Das Rezept kann
              weiterhin manuell angelegt werden.
            </p>
          ) : null}
          {state.manualFallback ? (
            <div className="notice-actions">
              <a className="button" href="#/recipe/new">
                Rezept manuell anlegen
              </a>
              {state.pages.length > 0 ? (
                <button type="button" className="button quiet" onClick={onRecognize}>
                  Erneut erkennen
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      {state.status === 'idle' ? (
        <section className="panel photo-capture-panel">
          <div className="photo-panel-head">
          <div>
            <h2>Fotos hinzufügen</h2>
            <p className="muted small">
              Ein Rezept kann aus bis zu {PHOTO_OCR_MAX_PAGES} Seiten bestehen. Fotos bleiben in
              diesem Browser und werden nur für die Erkennung gesendet.
            </p>
          </div>
          {state.pages.length > 0 ? (
            <span className="badge">
              {state.pages.length} {state.pages.length === 1 ? 'Seite' : 'Seiten'}
            </span>
          ) : null}
        </div>

        <div className="photo-capture-actions">
          <label
            className={`photo-capture-button${captureDisabled ? ' is-disabled' : ''}`}
            aria-disabled={captureDisabled || undefined}
          >
            <input
              type="file"
              accept="image/*"
              capture="environment"
              disabled={captureDisabled || fileInputDisabled}
              onChange={(event: ChangeEvent<HTMLInputElement>) => {
                const file = event.target.files?.[0]
                event.target.value = ''
                if (file) onAddFiles([file])
              }}
            />
            <span className="photo-capture-icon" aria-hidden="true">
              📷
            </span>
            <strong>Foto aufnehmen</strong>
            <span className="muted small">Ein Foto pro Aufnahme, wiederholbar</span>
          </label>

          <label
            className={`photo-capture-button${captureDisabled ? ' is-disabled' : ''}`}
            aria-disabled={captureDisabled || undefined}
          >
            <input
              type="file"
              accept="image/*"
              multiple
              disabled={captureDisabled || fileInputDisabled}
              onChange={(event: ChangeEvent<HTMLInputElement>) => {
                const files = Array.from(event.target.files ?? [])
                event.target.value = ''
                if (files.length > 0) onAddFiles(files)
              }}
            />
            <span className="photo-capture-icon" aria-hidden="true">
              🖼️
            </span>
            <strong>Aus Fotos auswählen</strong>
            <span className="muted small">Mehrere Bilder aus der Mediathek</span>
          </label>

          <label
            className={`photo-capture-button photo-pdf-button${captureDisabled ? ' is-disabled' : ''}`}
            aria-disabled={captureDisabled || undefined}
          >
            <input
              type="file"
              accept="application/pdf,.pdf"
              disabled={captureDisabled || fileInputDisabled}
              onChange={(event: ChangeEvent<HTMLInputElement>) => {
                const file = event.target.files?.[0]
                event.target.value = ''
                if (file) onAddFiles([file])
              }}
            />
            <span className="photo-capture-icon" aria-hidden="true">
              📄
            </span>
            <strong>PDF auswählen</strong>
            <span className="muted small">Wird im Browser in Seiten umgewandelt</span>
          </label>
        </div>

          <PhotoDropzone onFiles={onAddFiles} />
          <p className="muted small">
            Auf dem iPhone am besten einzelne Fotos aufnehmen; PDFs sind für gescannte Rezepte am
            Computer gedacht. Es werden höchstens {PHOTO_OCR_MAX_PAGES} Seiten übernommen.
          </p>
        </section>
      ) : null}

      {state.selectionErrors.length > 0 ? (
        <div className="notice danger" role="alert">
          <h3>Dateien konnten nicht übernommen werden</h3>
          <ul>
            {state.selectionErrors.map((message, index) => (
              <li key={`${message}-${index}`}>{message}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {state.selectionWarnings.length > 0 ? (
        <details className="notice">
          <summary>{state.selectionWarnings.length} Hinweis(e) zu den Fotos</summary>
          <ul>
            {state.selectionWarnings.map((warning, index) => (
              <li key={`${warning}-${index}`}>{warning}</li>
            ))}
          </ul>
        </details>
      ) : null}

      {state.pages.length > 0 ? (
        <PhotoPageList
          state={state}
          onMovePage={onMovePage}
          onRemovePage={onRemovePage}
          onReplacePage={onReplacePage}
        />
      ) : null}

      {state.status === 'idle' || state.status === 'recognizing' ? (
        <section className="panel photo-recognize-panel">
          <div className="photo-panel-head">
            <div>
              <h2>Rezept erkennen</h2>
              <p className="muted small">
                1–{PHOTO_OCR_MAX_PAGES} Seiten · {state.pages.length} ausgewählt ·{' '}
                {formatPhotoBytes(total)}. Handschrift wird als Text übernommen; unklare Stellen
                erscheinen anschließend als Hinweise.
              </p>
            </div>
          </div>
          {state.status === 'recognizing' ? (
            <div className="notice photo-recognizing" aria-live="polite">
              <span className="photo-spinner" aria-hidden="true" />
              <p>
                Erkenne {state.recognizingPageCount}{' '}
                {state.recognizingPageCount === 1 ? 'Seite' : 'Seiten'} … Das kann je nach
                Seitenzahl bis zu etwa zwei Minuten dauern.
              </p>
              <div className="notice-actions">
                <button type="button" className="button" onClick={onCancelRecognition}>
                  Erkennen abbrechen
                </button>
              </div>
            </div>
          ) : (
            <div className="photo-recognize-actions">
              <button
                type="button"
                className="button primary"
                onClick={onRecognize}
                disabled={recognizeDisabled}
              >
                Rezept erkennen
              </button>
              {!canStartRecognition(state.pages) ? (
                <p className="muted small">
                  {state.pages.length === 0
                    ? 'Zuerst mindestens eine Seite hinzufügen.'
                    : `Höchstens ${PHOTO_OCR_MAX_PAGES} Seiten pro Erkennung.`}
                </p>
              ) : null}
            </div>
          )}
        </section>
      ) : null}

      {state.result && state.draft && state.status !== 'idle' ? (
        <>
          <section className="panel photo-notices-panel">
            <div className="photo-panel-head">
              <div>
                <h2>Erkanntes Rezept prüfen</h2>
                <p className="muted small">
                  Jede Angabe kann unten im Editor korrigiert werden. Fotos bleiben zum Vergleichen
                  sichtbar; gespeichert wird erst nach Klick auf „Rezept speichern“.
                </p>
              </div>
              {state.notices.length > 0 ? (
                <span className="badge subtle">
                  {state.notices.length} Hinweis{state.notices.length === 1 ? '' : 'e'}
                </span>
              ) : (
                <span className="badge">Keine Unklarheiten gemeldet</span>
              )}
            </div>
            {state.notices.length > 0 ? (
              <div className="notice photo-notices">
                <h3>Unklarheiten und Warnungen der KI</h3>
                <ul>
                  {state.notices.map((notice) => (
                    <li key={notice.id}>
                      {notice.reference ? <strong>{notice.reference}: </strong> : null}
                      {notice.text}
                    </li>
                  ))}
                </ul>
                <p className="muted small">
                  Bitte die genannten Stellen mit den Fotos vergleichen und im Editor korrigieren.
                </p>
              </div>
            ) : null}
          </section>

          <section className="panel import-actions photo-save-panel">
            <div className="photo-save-copy">
              <h2>Speichern</h2>
              <p className="muted small">
                Das Rezept wird in der Familien-Cloud gespeichert. Ohne Häkchen bleiben die
                Seitenfotos nur in diesem Browser und werden nicht dauerhaft abgelegt.
              </p>
              <label className="check-field photo-save-images">
                <input
                  type="checkbox"
                  checked={state.includePhotos}
                  onChange={(event) => onIncludePhotos(event.target.checked)}
                  disabled={state.status === 'saving'}
                />
                Seitenfotos als Rezeptbilder mitspeichern
              </label>
            </div>
            <div className="notice-actions">
              <button
                type="button"
                className="button"
                onClick={onReset}
                disabled={state.status === 'saving'}
              >
                Verwerfen
              </button>
              <button
                type="submit"
                form="photo-import-form"
                className="button primary"
                disabled={state.status === 'saving' || !state.draft.title.trim()}
              >
                {state.status === 'saving' ? 'Speichere …' : 'Rezept speichern'}
              </button>
            </div>
          </section>

          <RecipeForm
            formId="photo-import-form"
            draft={state.draft}
            onChange={onChangeDraft}
            images={state.images}
            imagesEnabled={state.includePhotos}
            imagesDisabledNote="Seitenfotos werden nur gespeichert, wenn oben „Seitenfotos als Rezeptbilder mitspeichern“ aktiviert ist."
            onImagesChange={onChangeImages}
            onSubmit={(event: FormEvent) => {
              event.preventDefault()
              onSave()
            }}
            categoriesNote="Fotos können als Rezeptbilder mitgespeichert werden"
          />
        </>
      ) : null}
    </div>
  )
}

/* ---------------------------------------------------------------- */
/* Verbundene Seite                                                  */
/* ---------------------------------------------------------------- */

export function PhotoImportPage({
  recognize,
  saveRecipe,
  prepareFile,
  renderPdf,
  now,
}: PhotoImportPageProps) {
  const controller = useMemo(
    () =>
      new PhotoImportController({
        recognize,
        saveRecipe,
        prepareImage: prepareFile,
        renderPdf,
        now,
      }),
    [recognize, saveRecipe, prepareFile, renderPdf, now],
  )
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getState,
    controller.getState,
  )

  useEffect(() => () => controller.dispose(), [controller])

  return (
    <PhotoImportView
      state={state}
      onAddFiles={(files) => void controller.addFiles(files)}
      onReplacePage={(id, file) => void controller.replacePage(id, file)}
      onMovePage={(index, direction) => controller.movePage(index, direction)}
      onRemovePage={(id) => controller.removePage(id)}
      onRecognize={() => void controller.recognize()}
      onCancelRecognition={() => controller.cancelRecognition()}
      onChangeDraft={(draft) => controller.changeDraft(draft)}
      onChangeImages={(images) => controller.changeImages(images)}
      onIncludePhotos={(value) => controller.setIncludePhotos(value)}
      onSave={() => void controller.save()}
      onReset={() => controller.reset()}
    />
  )
}
