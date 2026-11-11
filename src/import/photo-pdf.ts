/*
 * Küchenrunde – PDF-Seiten für den Foto-/Scan-Import
 * Copyright (C) 2026 openCook Web contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * PDFs werden ausschließlich im Browser in Seitenbilder umgewandelt. Die
 * PDF-Bibliothek (pdfjs-dist, Apache-2.0) wird erst bei Bedarf dynamisch
 * geladen, damit der normale App-Start klein bleibt. Es werden höchstens so
 * viele Seiten übernommen, wie der gemeinsame OCR-Vertrag erlaubt.
 *
 * Der Renderer ist als Port injizierbar; Tests prüfen das Seitenlimit und die
 * Fehlerabbildung ohne echtes PDF oder Canvas.
 */

import { randomId } from '../lib/id'
import {
  PHOTO_OCR_JPEG_QUALITY,
  PHOTO_OCR_MAX_PAGES,
  PHOTO_OCR_MAX_PAGE_BYTES,
  PHOTO_OCR_TARGET_LONG_EDGE,
} from './photo-ocr'
import {
  arrayBufferToBase64,
  fitWithinLongEdge,
  isPdfPhotoFile,
  type PreparedPhotoPage,
} from './photo-image'

/** Schutzgrenze für die PDF-Rohdatei, bevor sie in den Speicher geladen wird. */
export const PHOTO_PDF_MAX_BYTES = 40 * 1024 * 1024
export const PHOTO_PDF_QUALITY_STEPS = [PHOTO_OCR_JPEG_QUALITY, 0.72, 0.55] as const

export type PhotoPdfErrorCode =
  | 'not-a-pdf'
  | 'too-large'
  | 'encrypted'
  | 'invalid'
  | 'too-many-pages'
  | 'render-failed'
  | 'unavailable'

export class PhotoPdfError extends Error {
  readonly code: PhotoPdfErrorCode

  constructor(code: PhotoPdfErrorCode, message: string) {
    super(message)
    this.name = 'PhotoPdfError'
    this.code = code
  }
}

export interface PdfRenderedPage {
  bytes: ArrayBuffer
  width: number
  height: number
}

/** Ein geladenes PDF. Der Renderer liefert bereits JPEG-Bytes. */
export interface PdfDocumentPort {
  readonly numPages: number
  renderPage(index: number, targetLongEdge: number): Promise<PdfRenderedPage>
  dispose?(): void | Promise<void>
}

export interface PdfLoaderPort {
  load(data: ArrayBuffer, onProgress?: (page: number) => void): Promise<PdfDocumentPort>
}

export interface PdfPhotoResult {
  pages: PreparedPhotoPage[]
  warnings: string[]
}

export interface RenderPdfOptions {
  loader?: PdfLoaderPort
  maxPages?: number
  targetLongEdge?: number
  onProgress?: (page: number) => void
}

function pdfNameWithoutExtension(name: string): string {
  return name.replace(/\.pdf$/i, '')
}

function mapPdfLoadError(cause: unknown): PhotoPdfError {
  const name =
    cause && typeof cause === 'object' && 'name' in cause
      ? String((cause as { name?: unknown }).name ?? '')
      : ''
  if (name === 'PasswordException') {
    return new PhotoPdfError(
      'encrypted',
      'Das PDF ist passwortgeschützt. Bitte die Datei ohne Passwort speichern oder die Seiten als Fotos übernehmen.',
    )
  }
  if (name === 'InvalidPDFException' || name === 'FormatError') {
    return new PhotoPdfError(
      'invalid',
      'Das PDF konnte nicht gelesen werden. Bitte prüfen, ob die Datei beschädigt ist.',
    )
  }
  return new PhotoPdfError(
    'render-failed',
    'Das PDF konnte nicht in Seitenbilder umgewandelt werden. Bitte die Seiten als Fotos übernehmen.',
  )
}

/**
 * Rendert ausgewählte PDF-Seiten in dasselbe JPEG-Format wie normale Fotos.
 * Ist das PDF länger als erlaubt, werden nur die ersten Seiten übernommen und
 * ein sichtbarer Hinweis zurückgegeben – stilles Abschneiden gibt es nicht.
 */
export async function renderPdfToPhotoPages(
  file: File,
  options: RenderPdfOptions = {},
): Promise<PdfPhotoResult> {
  if (!isPdfPhotoFile(file)) {
    throw new PhotoPdfError('not-a-pdf', 'Bitte eine PDF-Datei auswählen.')
  }
  if (!Number.isFinite(file.size) || file.size <= 0) {
    throw new PhotoPdfError('invalid', 'Das PDF ist leer.')
  }
  if (file.size > PHOTO_PDF_MAX_BYTES) {
    throw new PhotoPdfError(
      'too-large',
      'Das PDF ist zu groß für die Umwandlung (maximal 40 MB).',
    )
  }

  const maxPages = options.maxPages ?? PHOTO_OCR_MAX_PAGES
  const targetLongEdge = options.targetLongEdge ?? PHOTO_OCR_TARGET_LONG_EDGE
  const loader = options.loader ?? defaultPdfLoader

  let data: ArrayBuffer
  try {
    data = await file.arrayBuffer()
  } catch {
    throw new PhotoPdfError('invalid', 'Das PDF konnte nicht gelesen werden.')
  }

  let document: PdfDocumentPort
  try {
    document = await loader.load(data)
  } catch (cause) {
    throw mapPdfLoadError(cause)
  }

  try {
    const total = Math.trunc(document.numPages)
    if (!Number.isFinite(total) || total < 1) {
      throw new PhotoPdfError('invalid', 'Das PDF enthält keine Seiten.')
    }
    const pageCount = Math.min(total, maxPages)
    const warnings: string[] = []
    if (total > maxPages) {
      warnings.push(
        `Das PDF hat ${total} Seiten. Übernommen wurden die ersten ${maxPages} Seiten; mehr Seiten sind pro Rezept nicht möglich.`,
      )
    }

    const pages: PreparedPhotoPage[] = []
    for (let index = 0; index < pageCount; index += 1) {
      let rendered: PdfRenderedPage
      try {
        rendered = await document.renderPage(index, targetLongEdge)
      } catch {
        throw new PhotoPdfError(
          'render-failed',
          `Seite ${index + 1} des PDFs konnte nicht umgewandelt werden. Bitte die Seite als Foto übernehmen.`,
        )
      }
      if (!rendered || rendered.bytes.byteLength === 0) {
        throw new PhotoPdfError(
          'render-failed',
          `Seite ${index + 1} des PDFs ist leer und konnte nicht übernommen werden.`,
        )
      }
      if (rendered.bytes.byteLength > PHOTO_OCR_MAX_PAGE_BYTES) {
        throw new PhotoPdfError(
          'too-large',
          `Seite ${index + 1} des PDFs ist zu groß. Bitte das PDF mit weniger Auflösung exportieren.`,
        )
      }
      const width = Math.max(1, Math.round(rendered.width))
      const height = Math.max(1, Math.round(rendered.height))
      pages.push({
        id: randomId(),
        name: `${pdfNameWithoutExtension(file.name)} – Seite ${index + 1}`,
        mimeType: 'image/jpeg',
        bytes: rendered.bytes,
        width,
        height,
        originalWidth: width,
        originalHeight: height,
        dataBase64: arrayBufferToBase64(rendered.bytes),
      })
      options.onProgress?.(index + 1)
    }
    return { pages, warnings }
  } finally {
    try {
      await document.dispose?.()
    } catch {
      // Ein fehlgeschlagenes Aufräumen darf die bereits erzeugten Seiten nicht
      // verwerfen.
    }
  }
}

/* ---------------------------------------------------------------- */
/* Standard-Renderer mit pdfjs-dist (dynamischer Import)            */
/* ---------------------------------------------------------------- */

async function loadPdfJs(): Promise<typeof import('pdfjs-dist')> {
  if (typeof document === 'undefined') {
    throw new PhotoPdfError(
      'unavailable',
      'PDFs können nur im Browser umgewandelt werden.',
    )
  }
  const pdfjs = await import('pdfjs-dist')
  if (!pdfjs.GlobalWorkerOptions.workerSrc) {
    // Vite liefert den Worker als eigene Datei aus; keine CDN-/Fremd-URL.
    const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url')
    pdfjs.GlobalWorkerOptions.workerSrc = worker.default
  }
  return pdfjs
}

function encodeCanvasJpeg(
  canvas: HTMLCanvasElement,
  quality: number,
): Promise<ArrayBuffer> {
  return new Promise<ArrayBuffer>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error('Das PDF-Seitenbild konnte nicht gespeichert werden.'))
          return
        }
        blob.arrayBuffer().then(resolve).catch(reject)
      },
      'image/jpeg',
      quality,
    )
  })
}

/**
 * pdfjs-Renderer. Die Seite wird auf die Ziel-Kante skaliert, auf weißem
 * Hintergrund gezeichnet und mit sinkender Qualität als JPEG kodiert, bis die
 * Seitengrenze des Vertrags eingehalten wird.
 */
export const defaultPdfLoader: PdfLoaderPort = {
  async load(data) {
    const pdfjs = await loadPdfJs()
    const loadingTask = pdfjs.getDocument({ data: new Uint8Array(data) })
    const pdfDocument = await loadingTask.promise

    return {
      numPages: pdfDocument.numPages,
      async renderPage(index, targetLongEdge) {
        const page = await pdfDocument.getPage(index + 1)
        try {
          const base = page.getViewport({ scale: 1 })
          const fit = fitWithinLongEdge(base.width, base.height, targetLongEdge)
          const scale = fit.scale > 0 ? fit.scale : 1
          const viewport = page.getViewport({ scale })
          const canvas = globalThis.document.createElement('canvas')
          canvas.width = Math.max(1, Math.round(viewport.width))
          canvas.height = Math.max(1, Math.round(viewport.height))
          const context = canvas.getContext('2d')
          if (!context) {
            throw new Error('Canvas-Kontext fehlt.')
          }
          context.save()
          context.fillStyle = '#ffffff'
          context.fillRect(0, 0, canvas.width, canvas.height)
          context.restore()
          await page.render({ canvas, viewport }).promise

          let bytes: ArrayBuffer | null = null
          for (const quality of PHOTO_PDF_QUALITY_STEPS) {
            bytes = await encodeCanvasJpeg(canvas, quality)
            if (bytes.byteLength <= PHOTO_OCR_MAX_PAGE_BYTES) break
          }
          if (!bytes) throw new Error('Leeres Seitenbild.')
          return { bytes, width: canvas.width, height: canvas.height }
        } finally {
          page.cleanup()
        }
      },
      async dispose() {
        await loadingTask.destroy()
      },
    }
  },
}
