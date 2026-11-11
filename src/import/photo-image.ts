/*
 * Küchenrunde – Bildaufbereitung für den Foto-/Scan-Import
 * Copyright (C) 2026 openCook Web contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Der Browser verkleinert Fotos vor dem Upload und wandelt sie einheitlich in
 * JPEG um. Das hält die Anfrage klein und erfüllt gleichzeitig den gemeinsamen
 * Vertrag aus `photo-ocr.ts`. Alle Funktionen, die ohne DOM auskommen
 * (Grenzwerte, Fit-Mathematik, Base64, Budgetprüfung), sind separat testbar.
 *
 * Es werden keine Fotos dauerhaft gespeichert. Die Bytes existieren nur im
 * Arbeitsspeicher des Importvorgangs.
 */

import { randomId } from '../lib/id'
import type { EditorImage } from '../recipe/repository'
import {
  PHOTO_OCR_ALLOWED_MIME_TYPES,
  PHOTO_OCR_JPEG_QUALITY,
  PHOTO_OCR_MAX_PAGES,
  PHOTO_OCR_MAX_PAGE_BYTES,
  PHOTO_OCR_MAX_TOTAL_BYTES,
  PHOTO_OCR_MIN_LONG_EDGE,
  PHOTO_OCR_TARGET_LONG_EDGE,
  type PhotoOcrMimeType,
  type PhotoOcrPage,
} from './photo-ocr'

/**
 * Formate, die der Browser zumindest öffnen und neu als JPEG kodieren kann.
 * Auch HEIC/HEIF wird akzeptiert, weil iPhones Fotos standardmäßig so
 * ablegen; die Ausgabe ist trotzdem immer JPEG. Kann ein Browser das Format
 * nicht dekodieren, erscheint eine verständliche Fehlermeldung.
 */
export const PHOTO_IMAGE_INPUT_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
  'image/avif',
  'image/gif',
  'image/bmp',
] as const

/** Rohdateien über dieser Grenze werden gar nicht erst in den Decoder gegeben. */
export const PHOTO_IMAGE_MAX_INPUT_BYTES = 30 * 1024 * 1024
/** Nach dem Re-Encoding wird es noch einmal mit schlechterer Qualität versucht. */
export const PHOTO_IMAGE_FALLBACK_QUALITIES = [PHOTO_OCR_JPEG_QUALITY, 0.7, 0.55] as const

export type PhotoImageErrorCode =
  | 'not-an-image'
  | 'unsupported-type'
  | 'too-large'
  | 'too-many-pages'
  | 'total-too-large'
  | 'decode-failed'
  | 'encode-failed'

export class PhotoImageError extends Error {
  readonly code: PhotoImageErrorCode

  constructor(code: PhotoImageErrorCode, message: string) {
    super(message)
    this.name = 'PhotoImageError'
    this.code = code
  }
}

/** Minimal nötige Dateimerkmale; erlaubt echte `File`-Objekte und Test-Doubles. */
export interface PhotoFileLike {
  name: string
  size: number
  type: string
}

export interface PhotoDimensions {
  width: number
  height: number
}

export interface FitResult extends PhotoDimensions {
  /** Verkleinerungsfaktor; immer <= 1, es wird nie hochskaliert. */
  scale: number
}

export interface PreparedPhotoPage {
  /** Stabile ID innerhalb des Importvorgangs. */
  id: string
  name: string
  mimeType: PhotoOcrMimeType
  /** Bereits als JPEG kodierte Bytes für die optionale Bildspeicherung. */
  bytes: ArrayBuffer
  width: number
  height: number
  originalWidth: number
  originalHeight: number
  /** Reines Base64 ohne Data-URL-Präfix. */
  dataBase64: string
}

export type PhotoFilePreparer = (file: File) => Promise<PreparedPhotoPage>

export interface PreparedPhotoBatch {
  pages: PreparedPhotoPage[]
  errors: string[]
  warnings: string[]
}

/* ---------------------------------------------------------------- */
/* Reine Hilfsfunktionen                                             */
/* ---------------------------------------------------------------- */

/** Dateiendung als Notnagel, wenn der Browser keinen MIME-Typ setzt. */
const MIME_BY_EXTENSION: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  heic: 'image/heic',
  heif: 'image/heif',
  avif: 'image/avif',
  gif: 'image/gif',
  bmp: 'image/bmp',
  pdf: 'application/pdf',
}

export function photoFileMimeType(file: PhotoFileLike): string {
  const declared = file.type.trim().toLowerCase()
  if (declared) return declared
  const extension = /\.([A-Za-z0-9]+)$/.exec(file.name.trim())?.[1]?.toLowerCase()
  return extension ? (MIME_BY_EXTENSION[extension] ?? '') : ''
}

export function isPdfPhotoFile(file: PhotoFileLike): boolean {
  return photoFileMimeType(file) === 'application/pdf'
}

export function isSupportedPhotoImageType(mimeType: string): boolean {
  return (PHOTO_IMAGE_INPUT_MIME_TYPES as readonly string[]).includes(mimeType)
}

export function isAllowedOcrMimeType(value: unknown): value is PhotoOcrMimeType {
  return (
    typeof value === 'string' &&
    (PHOTO_OCR_ALLOWED_MIME_TYPES as readonly string[]).includes(value)
  )
}

/**
 * Prüft eine einzelne Auswahl vor dem Dekodieren. Die eigentliche
 * Größenprüfung erfolgt nach dem Verkleinern auf die tatsächlichen
 * JPEG-Bytes; eine 9-MB-Kameraaufnahme ist also erlaubt, solange sie nach
 * der Optimierung unter dem Seitengrenzwert liegt.
 */
export function validatePhotoFile(file: PhotoFileLike): PhotoImageError | null {
  if (isPdfPhotoFile(file)) {
    return new PhotoImageError(
      'not-an-image',
      `„${file.name}“ ist ein PDF. PDFs werden nur über die PDF-Auswahl umgewandelt.`,
    )
  }
  const mimeType = photoFileMimeType(file)
  if (!mimeType || !mimeType.startsWith('image/')) {
    return new PhotoImageError('not-an-image', `„${file.name}“ ist keine Bilddatei.`)
  }
  if (!isSupportedPhotoImageType(mimeType)) {
    return new PhotoImageError(
      'unsupported-type',
      `„${file.name}“ hat ein nicht unterstütztes Bildformat. Bitte JPEG, PNG, WebP oder HEIC verwenden.`,
    )
  }
  if (!Number.isFinite(file.size) || file.size <= 0) {
    return new PhotoImageError('too-large', `„${file.name}“ ist leer.`)
  }
  if (file.size > PHOTO_IMAGE_MAX_INPUT_BYTES) {
    return new PhotoImageError(
      'too-large',
      `„${file.name}“ ist größer als ${formatPhotoBytes(PHOTO_IMAGE_MAX_INPUT_BYTES)} und kann nicht verarbeitet werden.`,
    )
  }
  return null
}

/**
 * Prüft die Seitenzahl, bevor Dateien dekodiert werden. `incomingCount` ist
 * die Anzahl der ausgewählten Bilder/PDF-Seiten.
 */
export function validatePhotoPageCount(
  existingCount: number,
  incomingCount: number,
  maxPages = PHOTO_OCR_MAX_PAGES,
): PhotoImageError | null {
  if (incomingCount <= 0) return null
  if (existingCount + incomingCount > maxPages) {
    return new PhotoImageError(
      'too-many-pages',
      `Es sind höchstens ${maxPages} Seiten pro Rezept möglich. Bitte zuerst eine Seite entfernen.`,
    )
  }
  return null
}

/** Prüft, ob die bereits aufbereiteten Seiten das Gesamtbudget einhalten. */
export function validatePhotoTotalBytes(totalBytes: number): PhotoImageError | null {
  if (totalBytes > PHOTO_OCR_MAX_TOTAL_BYTES) {
    return new PhotoImageError(
      'total-too-large',
      `Die Seiten sind zusammen zu groß (maximal ${formatPhotoBytes(PHOTO_OCR_MAX_TOTAL_BYTES)}). Bitte weniger oder kleinere Seiten verwenden.`,
    )
  }
  return null
}

/**
 * Passt eine Bildgröße in die lange Kante ein. Es wird nie hochskaliert; bei
 * ungültigen Werten kommt eine leere Größe mit Faktor 1 zurück.
 */
export function fitWithinLongEdge(
  width: number,
  height: number,
  longEdge = PHOTO_OCR_TARGET_LONG_EDGE,
): FitResult {
  const maxEdge = Math.max(width, height)
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0 ||
    !Number.isFinite(longEdge) ||
    longEdge <= 0 ||
    maxEdge <= 0
  ) {
    return { width: 0, height: 0, scale: 1 }
  }
  const scale = Math.min(1, longEdge / maxEdge)
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
    scale,
  }
}

/** Verkleinert nur, wenn die lange Kante den Zielwert überschreitet. */
export function shouldDownscale(
  width: number,
  height: number,
  longEdge = PHOTO_OCR_TARGET_LONG_EDGE,
): boolean {
  return Math.max(width, height) > longEdge
}

/**
 * Sehr kleine Fotos sind technisch gültig, aber für Handschrift oft unlesbar.
 * Die Oberfläche zeigt das als Hinweis, nicht als Fehler.
 */
export function photoResolutionWarning(
  width: number,
  height: number,
): string | null {
  if (!(width > 0) || !(height > 0)) return null
  if (Math.max(width, height) >= PHOTO_OCR_MIN_LONG_EDGE) return null
  return `Ein Foto ist mit ${width} × ${height} Pixeln sehr klein und möglicherweise schwer lesbar.`
}

/** Standard-Base64 ohne Data-URL-Präfix, in Blöcken gegen Call-Stack-Limits. */
export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  const chunkSize = 0x8000
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, offset + chunkSize)
    binary += String.fromCharCode(...chunk)
  }
  return btoa(binary)
}

/** Dekodierte Länge eines Standard-Base64-Strings (ohne ihn zu parsen). */
export function base64ByteLength(base64: string): number {
  const clean = base64.trim()
  if (!clean) return 0
  const padding = clean.endsWith('==') ? 2 : clean.endsWith('=') ? 1 : 0
  return Math.max(0, Math.floor((clean.length * 3) / 4) - padding)
}

/** Formatiert Bytes für deutsche Hinweistexte. */
export function formatPhotoBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  if (bytes < 1024) return `${Math.round(bytes)} B`
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toLocaleString('de-DE', { maximumFractionDigits: 1 })} KB`
  }
  return `${(bytes / 1024 / 1024).toLocaleString('de-DE', { maximumFractionDigits: 1 })} MB`
}

/** Wandelt eine aufbereitete Seite in das Format der Pages Function. */
export function toOcrPage(page: PreparedPhotoPage): PhotoOcrPage {
  return {
    mimeType: page.mimeType,
    dataBase64: page.dataBase64,
    width: page.width,
    height: page.height,
  }
}

/**
 * Seitenbilder als EditorImages für die bestehende Cloud-Bildpipeline. Die
 * Bytes sind bereits JPEG; sie werden nur übernommen, wenn der Nutzer die
 * Checkbox „Seitenfotos mitspeichern“ ausdrücklich aktiviert hat.
 */
export function toEditorImages(pages: readonly PreparedPhotoPage[]): EditorImage[] {
  return pages.map((page) => ({
    id: page.id,
    name: `${page.name.replace(/\.[A-Za-z0-9]+$/, '') || 'Seite'}.jpg`,
    bytes: page.bytes,
    mimeType: page.mimeType,
  }))
}

/* ---------------------------------------------------------------- */
/* DOM-Pipeline (in Tests injizierbar)                              */
/* ---------------------------------------------------------------- */

export interface DecodedPhotoImage {
  width: number
  height: number
  draw(context: CanvasRenderingContext2D, width: number, height: number): void
  close?(): void
}

export interface PhotoCanvasLike {
  width: number
  height: number
  getContext(contextId: '2d'): CanvasRenderingContext2D | null
  toBlob(
    callback: (blob: Blob | null) => void,
    type?: string,
    quality?: number,
  ): void
}

export interface PhotoImagePipeline {
  decode(file: File): Promise<DecodedPhotoImage>
  createCanvas(width: number, height: number): PhotoCanvasLike
  encodeJpeg(canvas: PhotoCanvasLike, quality: number): Promise<ArrayBuffer>
}

async function decodeWithCreateImageBitmap(file: File): Promise<DecodedPhotoImage> {
  const bitmap = await createImageBitmap(file)
  return {
    width: bitmap.width,
    height: bitmap.height,
    draw(context, width, height) {
      // Wechselnde Ausrichtung: das Ziel-Rechteck ist immer explizit.
      context.drawImage(bitmap, 0, 0, width, height)
    },
    close() {
      bitmap.close()
    },
  }
}

/**
 * Safari hat `createImageBitmap` lange nicht unterstützt. Der Umweg über ein
 * `<img>`-Element respektiert die EXIF-Ausrichtung in aktuellen Browsern.
 */
async function decodeWithImageElement(file: File): Promise<DecodedPhotoImage> {
  const url = URL.createObjectURL(file)
  const image = new Image()
  image.decoding = 'async'
  try {
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve()
      image.onerror = () =>
        reject(new Error('Das Bildformat konnte nicht geöffnet werden.'))
      image.src = url
    })
    return {
      width: image.naturalWidth,
      height: image.naturalHeight,
      draw(context, width, height) {
        context.drawImage(image, 0, 0, width, height)
      },
      close() {
        image.removeAttribute('src')
        URL.revokeObjectURL(url)
      },
    }
  } catch (cause) {
    URL.revokeObjectURL(url)
    throw cause
  }
}

function decodePhoto(file: File): Promise<DecodedPhotoImage> {
  if (typeof createImageBitmap === 'function') {
    return decodeWithCreateImageBitmap(file)
  }
  return decodeWithImageElement(file)
}

function encodeJpeg(
  canvas: PhotoCanvasLike,
  quality: number,
): Promise<ArrayBuffer> {
  return new Promise<ArrayBuffer>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error('Das Bild konnte nicht als JPEG gespeichert werden.'))
          return
        }
        blob
          .arrayBuffer()
          .then((bytes) => resolve(bytes))
          .catch(() =>
            reject(new Error('Das Bild konnte nicht als JPEG gespeichert werden.')),
          )
      },
      'image/jpeg',
      quality,
    )
  })
}

export const browserPhotoImagePipeline: PhotoImagePipeline = {
  decode: decodePhoto,
  createCanvas(width, height) {
    if (typeof document === 'undefined') {
      throw new Error('Diese Umgebung kann keine Bilder aufbereiten.')
    }
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    return canvas
  },
  encodeJpeg,
}

/**
 * Dekodiert, verkleinert und kodiert eine Bilddatei als JPEG. Der Zielwert
 * ist die lange Kante aus dem gemeinsamen Vertrag; es wird nie hochskaliert.
 * Ist die JPEG-Datei noch zu groß, wird sie mit niedrigerer Qualität erneut
 * kodiert, bevor ein verständlicher Fehler gemeldet wird.
 */
export async function preparePhotoFile(
  file: File,
  pipeline: PhotoImagePipeline = browserPhotoImagePipeline,
): Promise<PreparedPhotoPage> {
  const validation = validatePhotoFile(file)
  if (validation) throw validation

  let decoded: DecodedPhotoImage
  try {
    decoded = await pipeline.decode(file)
  } catch {
    throw new PhotoImageError(
      'decode-failed',
      `„${file.name}“ konnte in diesem Browser nicht gelesen werden. Bitte als JPEG speichern oder erneut fotografieren.`,
    )
  }

  try {
    const target = fitWithinLongEdge(decoded.width, decoded.height)
    if (target.width <= 0 || target.height <= 0) {
      throw new PhotoImageError('decode-failed', `„${file.name}“ hat keine gültige Größe.`)
    }

    const canvas = pipeline.createCanvas(target.width, target.height)
    const context = canvas.getContext('2d')
    if (!context) {
      throw new PhotoImageError(
        'decode-failed',
        `„${file.name}“ konnte nicht für die Erkennung vorbereitet werden.`,
      )
    }
    // JPEG kennt keine Transparenz: ohne weißen Hintergrund würden
    // transparente Bildbereiche schwarz.
    context.save()
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, target.width, target.height)
    context.restore()
    decoded.draw(context, target.width, target.height)

    let bytes: ArrayBuffer | null = null
    for (const quality of PHOTO_IMAGE_FALLBACK_QUALITIES) {
      const encoded = await pipeline.encodeJpeg(canvas, quality)
      bytes = encoded
      if (encoded.byteLength <= PHOTO_OCR_MAX_PAGE_BYTES) break
    }
    if (!bytes) {
      throw new PhotoImageError(
        'encode-failed',
        `„${file.name}“ konnte nicht als JPEG gespeichert werden.`,
      )
    }
    if (bytes.byteLength > PHOTO_OCR_MAX_PAGE_BYTES) {
      throw new PhotoImageError(
        'too-large',
        `„${file.name}“ ist auch nach der Optimierung größer als ${formatPhotoBytes(PHOTO_OCR_MAX_PAGE_BYTES)}. Bitte ein Foto mit weniger Details verwenden.`,
      )
    }

    return {
      id: randomId(),
      name: file.name,
      mimeType: 'image/jpeg',
      bytes,
      width: target.width,
      height: target.height,
      originalWidth: decoded.width,
      originalHeight: decoded.height,
      dataBase64: arrayBufferToBase64(bytes),
    }
  } finally {
    decoded.close?.()
  }
}

/**
 * Verarbeitet eine Dateiauswahl nacheinander. Fehler einzelner Dateien werden
 * gesammelt, damit die Oberfläche sie anzeigen kann, ohne die übrigen Fotos zu
 * verwerfen. Das Gesamtbudget wird nach jeder Seite geprüft.
 */
export async function preparePhotoFiles(
  files: readonly File[],
  existing: readonly PreparedPhotoPage[] = [],
  options: {
    pipeline?: PhotoImagePipeline
    prepare?: PhotoFilePreparer
  } = {},
): Promise<PreparedPhotoBatch> {
  const errors: string[] = []
  const warnings: string[] = []
  const pages: PreparedPhotoPage[] = []
  const prepare = options.prepare ?? ((file: File) => preparePhotoFile(file, options.pipeline))

  let count = existing.length
  let totalBytes = existing.reduce((sum, page) => sum + page.bytes.byteLength, 0)

  for (const file of files) {
    const pageCheck = validatePhotoPageCount(count, 1)
    if (pageCheck) {
      errors.push(pageCheck.message)
      break
    }
    const fileCheck = validatePhotoFile(file)
    if (fileCheck) {
      errors.push(fileCheck.message)
      continue
    }
    try {
      const page = await prepare(file)
      const totalCheck = validatePhotoTotalBytes(totalBytes + page.bytes.byteLength)
      if (totalCheck) {
        errors.push(totalCheck.message)
        break
      }
      pages.push(page)
      count += 1
      totalBytes += page.bytes.byteLength
      const resolution = photoResolutionWarning(page.originalWidth, page.originalHeight)
      if (resolution) warnings.push(`${page.name}: ${resolution}`)
    } catch (cause) {
      errors.push(
        cause instanceof Error && cause.message
          ? cause.message
          : `„${file.name}“ konnte nicht verarbeitet werden.`,
      )
    }
  }

  return { pages, errors, warnings }
}

/* ---------------------------------------------------------------- */
/* Object-URLs für die Vorschau                                     */
/* ---------------------------------------------------------------- */

export interface PhotoObjectUrlApi {
  createObjectURL(blob: Blob): string
  revokeObjectURL(url: string): void
}

/** Vorschaubild für eine aufbereitete Seite. Der Aufrufer gibt es frei. */
export function createPhotoPreviewUrl(
  bytes: ArrayBuffer,
  mimeType: string,
  api: PhotoObjectUrlApi = URL,
): string | null {
  try {
    return api.createObjectURL(new Blob([bytes], { type: mimeType }))
  } catch {
    return null
  }
}

export function revokePhotoPreviewUrl(
  url: string | null | undefined,
  api: PhotoObjectUrlApi = URL,
): void {
  if (!url) return
  try {
    api.revokeObjectURL(url)
  } catch {
    // Ein bereits freigegebenes Object-URL darf den Import nicht abbrechen.
  }
}
