/*
 * openCook Web
 * Copyright (C) 2026 openCook Web contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Mela importer. Format reference: https://mela.recipes/fileformat/index.html
 *
 * The importer reads `.melarecipe` (JSON) and `.melarecipes` (ZIP of JSON files)
 * entirely in the browser. It is intentionally conservative: every recipe keeps
 * its complete original JSON object, and every ingredient keeps its original
 * line. Fields that cannot be mapped are reported, never silently dropped.
 */

import { listZipEntries, readZipEntry } from './zip'
import type {
  ImportIssue,
  Ingredient,
  Instruction,
  MelaInspection,
  ParsedImage,
  ParsedMelaRecipe,
} from '../types'
import { parseIngredients } from './ingredients'
import { sniffImageMime } from './image-mime'

export const MELA_LIMITS = {
  /** Whole upload (JSON or ZIP). */
  maxFileBytes: 50 * 1024 * 1024,
  maxZipEntries: 500,
  /** One decompressed JSON file. */
  maxEntryBytes: 20 * 1024 * 1024,
  /** Sum of all decompressed entries. Guards against zip bombs. */
  maxTotalUncompressedBytes: 200 * 1024 * 1024,
  maxImagesPerRecipe: 50,
  maxImageBytes: 8 * 1024 * 1024,
} as const

export class MelaParseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MelaParseError'
  }
}

/**
 * Inspect a selected file without writing anything. Fatal file-level problems
 * are returned as error issues; individual bad recipes become error issues and
 * do not abort the rest of an archive.
 */
export async function inspectMelaFile(buffer: ArrayBuffer, fileName: string): Promise<MelaInspection> {
  const issues: ImportIssue[] = []
  const recipes: ParsedMelaRecipe[] = []
  const name = fileName || 'unbenannte Datei'

  if (buffer.byteLength === 0) {
    return { recipes, issues: [{ file: name, severity: 'error', message: 'Die Datei ist leer.' }] }
  }
  if (buffer.byteLength > MELA_LIMITS.maxFileBytes) {
    return {
      recipes,
      issues: [
        {
          file: name,
          severity: 'error',
          message: `Die Datei ist zu groß (${formatBytes(buffer.byteLength)}; erlaubt sind ${formatBytes(MELA_LIMITS.maxFileBytes)}).`,
        },
      ],
    }
  }

  const bytes = new Uint8Array(buffer)
  if (isZip(bytes)) {
    return inspectZip(bytes, name)
  }

  const text = decodeUtf8(bytes)
  if (text === null) {
    return {
      recipes,
      issues: [{ file: name, severity: 'error', message: 'Die Datei ist kein gültiges UTF-8.' }],
    }
  }

  const parsed = await parseJsonDocument(text, name)
  issues.push(...parsed.issues)
  recipes.push(...parsed.recipes)
  return { recipes, issues }
}

async function inspectZip(bytes: Uint8Array, fileName: string): Promise<MelaInspection> {
  const issues: ImportIssue[] = []
  const recipes: ParsedMelaRecipe[] = []
  let listed
  try {
    listed = listZipEntries(bytes)
  } catch (error) {
    return {
      recipes,
      issues: [
        {
          file: fileName,
          severity: 'error',
          message: `ZIP konnte nicht gelesen werden: ${(error as Error).message}`,
        },
      ],
    }
  }

  if (listed.length > MELA_LIMITS.maxZipEntries) {
    return {
      recipes,
      issues: [
        {
          file: fileName,
          severity: 'error',
          message: `Das ZIP enthält zu viele Einträge (erlaubt sind ${MELA_LIMITS.maxZipEntries}).`,
        },
      ],
    }
  }

  let hostilePath: string | null = null
  let tooLargeTotal = false
  let declaredTotal = 0
  const recipeEntries = []
  for (const entry of listed) {
    const normalized = entry.name.replace(/\\/g, '/')
    if (
      normalized.startsWith('/') ||
      normalized.includes('..') ||
      entry.name.includes('\\') ||
      normalized.split('/').some((part) => part === '..')
    ) {
      hostilePath = entry.name
      break
    }
    if (normalized.endsWith('/')) continue
    if (normalized.startsWith('__MACOSX/') || normalized.endsWith('.DS_Store')) continue
    if (!normalized.toLowerCase().endsWith('.melarecipe')) continue
    if (entry.uncompressedSize > MELA_LIMITS.maxEntryBytes) {
      issues.push({
        file: entry.name,
        severity: 'error',
        message: 'Eintrag ist zu groß und wurde übersprungen.',
      })
      continue
    }
    declaredTotal += entry.uncompressedSize
    if (declaredTotal > MELA_LIMITS.maxTotalUncompressedBytes) {
      tooLargeTotal = true
      break
    }
    recipeEntries.push(entry)
  }

  if (hostilePath) {
    return {
      recipes: [],
      issues: [
        {
          file: fileName,
          severity: 'error',
          message: `Unsicherer Pfad im ZIP: "${hostilePath}". Der Import wurde abgebrochen.`,
        },
      ],
    }
  }
  if (tooLargeTotal) {
    return {
      recipes: [],
      issues: [
        {
          file: fileName,
          severity: 'error',
          message: 'Das ZIP ist entpackt zu groß (mögliche Zip-Bombe). Der Import wurde abgebrochen.',
        },
      ],
    }
  }
  if (recipeEntries.length === 0) {
    return {
      recipes,
      issues: [
        ...issues,
        {
          file: fileName,
          severity: 'error',
          message: 'Im ZIP wurde keine .melarecipe-Datei gefunden.',
        },
      ],
    }
  }

  let actualTotal = 0
  for (const entry of recipeEntries) {
    let data: Uint8Array
    try {
      data = readZipEntry(bytes, entry)
    } catch (error) {
      issues.push({ file: entry.name, severity: 'error', message: (error as Error).message })
      continue
    }
    if (data.byteLength > MELA_LIMITS.maxEntryBytes) {
      issues.push({ file: entry.name, severity: 'error', message: 'Eintrag ist zu groß und wurde übersprungen.' })
      continue
    }
    actualTotal += data.byteLength
    if (actualTotal > MELA_LIMITS.maxTotalUncompressedBytes) {
      return {
        recipes: [],
        issues: [
          ...issues,
          {
            file: fileName,
            severity: 'error',
            message: 'Das ZIP ist entpackt zu groß (mögliche Zip-Bombe). Der Import wurde abgebrochen.',
          },
        ],
      }
    }
    const text = decodeUtf8(data)
    if (text === null) {
      issues.push({ file: entry.name, severity: 'error', message: 'Eintrag ist kein gültiges UTF-8.' })
      continue
    }
    const parsed = await parseJsonDocument(text, entry.name)
    issues.push(...parsed.issues)
    recipes.push(...parsed.recipes)
  }

  return { recipes, issues }
}

async function parseJsonDocument(
  text: string,
  fileName: string,
): Promise<{ recipes: ParsedMelaRecipe[]; issues: ImportIssue[] }> {
  const issues: ImportIssue[] = []
  const recipes: ParsedMelaRecipe[] = []
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    return {
      recipes,
      issues: [
        {
          file: fileName,
          severity: 'error',
          message: `Ungültiges JSON: ${(error as Error).message}`,
        },
      ],
    }
  }

  const candidates = extractCandidates(parsed)
  if (candidates.length === 0) {
    return {
      recipes,
      issues: [
        {
          file: fileName,
          severity: 'error',
          message: 'Die Datei enthält kein Mela-Rezeptobjekt.',
        },
      ],
    }
  }

  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index]
    const label = candidates.length > 1 ? `${fileName} (Rezept ${index + 1})` : fileName
    if (!isRecord(candidate)) {
      issues.push({ file: label, severity: 'error', message: 'Eintrag ist kein JSON-Objekt.' })
      continue
    }
    try {
      recipes.push(await parseMelaRecipe(candidate, label))
    } catch (error) {
      const message = error instanceof MelaParseError ? error.message : (error as Error).message
      issues.push({ file: label, severity: 'error', message })
    }
  }

  return { recipes, issues }
}

function extractCandidates(value: unknown): unknown[] {
  if (Array.isArray(value)) return value
  if (isRecord(value) && Array.isArray(value.recipes)) return value.recipes
  return [value]
}

export async function parseMelaRecipe(
  obj: Record<string, unknown>,
  sourceName = 'Mela-Rezept',
): Promise<ParsedMelaRecipe> {
  const warnings: string[] = []
  const title = asString(obj.title).trim()
  if (!title) {
    throw new MelaParseError('Das Rezept hat keinen Titel (Feld "title").')
  }

  const rawId = asString(obj.id).trim()
  let importId = rawId
  if (!importId) {
    importId = `local-${await sha256Hex(stableStringify(obj))}`
    warnings.push('Keine Mela-ID vorhanden – eine stabile ID wurde aus dem Inhalt abgeleitet.')
  }

  const description = asString(obj.text)
  const servingsText = asString(obj.yield)
  const categories = readStringArray(obj.categories, 'categories', warnings)
  const favorite = readBoolean(obj.favorite, 'favorite', warnings)
  const wantToCook = readBoolean(obj.wantToCook, 'wantToCook', warnings)
  const melaDate = readNumber(obj.date, 'date', warnings)

  const ingredientsRaw = readMultilineField(obj.ingredients, 'ingredients', warnings)
  const instructionsRaw = readMultilineField(obj.instructions, 'instructions', warnings)
  const ingredientResult = parseIngredients(ingredientsRaw)
  warnings.push(...ingredientResult.warnings)

  const instructions: Instruction[] = instructionsRaw
    .replace(/\r\n?/g, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => ({
      id: `step-${index + 1}`,
      position: index,
      raw: line,
      text: line,
    }))

  const images: ParsedImage[] = []
  const rawImages = obj.images
  if (rawImages !== undefined && rawImages !== null) {
    if (!Array.isArray(rawImages)) {
      warnings.push('Feld "images" ist kein Array – es wurden keine Bilder importiert.')
    } else {
      const limited = rawImages.slice(0, MELA_LIMITS.maxImagesPerRecipe)
      if (rawImages.length > limited.length) {
        warnings.push(
          `Nur ${limited.length} von ${rawImages.length} Bildern importiert (Limit pro Rezept).`,
        )
      }
      limited.forEach((entry, index) => {
        if (typeof entry !== 'string') {
          warnings.push(`Bild ${index + 1} ist kein Base64-String und wurde übersprungen.`)
          return
        }
        const decoded = decodeBase64Image(entry)
        if (!decoded) {
          warnings.push(`Bild ${index + 1} konnte nicht dekodiert werden und wurde übersprungen.`)
          return
        }
        images.push(decoded)
      })
    }
  }

  let nutrition = asString(obj.nutrition)
  if (isRecord(obj.nutrition) || Array.isArray(obj.nutrition)) {
    nutrition = JSON.stringify(obj.nutrition)
    warnings.push('Nährwerte waren kein Text – sie wurden als JSON in "nutrition" bewahrt.')
  }

  const rawImagesForStorage = Array.isArray(obj.images)
    ? obj.images.map((entry, index) =>
        typeof entry === 'string'
          ? `[Bild ${index + 1}: Bytes liegen in der Bildtabelle]`
          : { index: index + 1, invalidImageValue: entry },
      )
    : obj.images

  const raw: Record<string, unknown> = { ...obj }
  if (rawImages !== undefined) raw.images = rawImagesForStorage

  return {
    importId,
    title,
    description,
    ingredientGroups: ingredientResult.groups,
    ingredients: ingredientResult.ingredients,
    instructions,
    servingsText,
    servingsNumber: leadingInt(servingsText),
    prepTime: asString(obj.prepTime),
    cookTime: asString(obj.cookTime),
    totalTime: asString(obj.totalTime),
    categories,
    notes: asString(obj.notes),
    nutrition,
    sourceUrl: asString(obj.link),
    favorite,
    wantToCook,
    melaDate,
    images,
    warnings,
    raw,
  }
}

function readMultilineField(value: unknown, field: string, warnings: string[]): string {
  if (value === undefined || value === null) {
    warnings.push(`Feld "${field}" fehlt.`)
    return ''
  }
  if (typeof value === 'string') return value
  if (Array.isArray(value) && value.every((entry) => typeof entry === 'string')) {
    warnings.push(`Feld "${field}" war ein Array – Zeilen wurden mit Zeilenumbrüchen verbunden.`)
    return value.join('\n')
  }
  warnings.push(`Feld "${field}" hat ein unerwartetes Format und wurde nicht übernommen.`)
  return ''
}

function readStringArray(value: unknown, field: string, warnings: string[]): string[] {
  if (value === undefined || value === null) return []
  if (typeof value === 'string') {
    warnings.push(`Feld "${field}" war ein String – als einzelne Kategorie übernommen.`)
    return value.trim() ? [value.trim()] : []
  }
  if (!Array.isArray(value)) {
    warnings.push(`Feld "${field}" ist kein Array und wurde ignoriert.`)
    return []
  }
  const strings = value.filter((entry): entry is string => typeof entry === 'string')
  if (strings.length !== value.length) {
    warnings.push(`Feld "${field}" enthielt ${value.length - strings.length} Nicht-String-Einträge.`)
  }
  return strings.map((entry) => entry.trim()).filter(Boolean)
}

function readBoolean(value: unknown, field: string, warnings: string[]): boolean {
  if (value === undefined || value === null) return false
  if (typeof value === 'boolean') return value
  warnings.push(`Feld "${field}" ist kein Boolean und wurde als false interpretiert.`)
  return false
}

function readNumber(value: unknown, field: string, warnings: string[]): number | null {
  if (value === undefined || value === null) return null
  if (typeof value === 'number' && Number.isFinite(value)) return value
  warnings.push(`Feld "${field}" ist keine Zahl und wurde ignoriert.`)
  return null
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function leadingInt(value: string): number | null {
  const match = /^\s*(\d{1,3})/.exec(value)
  return match?.[1] ? Number.parseInt(match[1], 10) : null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isZip(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 4 &&
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    (bytes[2] === 0x03 || bytes[2] === 0x05 || bytes[2] === 0x07) &&
    (bytes[3] === 0x04 || bytes[3] === 0x06 || bytes[3] === 0x08)
  )
}

function decodeUtf8(bytes: Uint8Array): string | null {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return null
  }
}

function decodeBase64Image(value: string): ParsedImage | null {
  let payload = value.trim()
  let declaredMime = ''
  const dataUri = /^data:([^;,]+)?[^,]*,(.*)$/s.exec(payload)
  if (dataUri) {
    declaredMime = dataUri[1] ?? ''
    payload = dataUri[2] ?? ''
  }
  payload = payload.replace(/\s+/g, '')
  if (!payload) return null
  // Base64 expands by ~4/3; reject before allocating the decoded string.
  if (payload.length > Math.ceil((MELA_LIMITS.maxImageBytes * 4) / 3) + 16) return null

  let binary: string
  try {
    binary = atob(payload)
  } catch {
    return null
  }
  if (binary.length === 0 || binary.length > MELA_LIMITS.maxImageBytes) return null
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  const sniffed = sniffImageMime(bytes)
  const mimeType = declaredMime.startsWith('image/') ? declaredMime : (sniffed ?? 'image/jpeg')
  return { mimeType, bytes: bytes.buffer as ArrayBuffer }
}

/** Stable JSON for content-derived ids: object keys are sorted recursively. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  const record = value as Record<string, unknown>
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(',')}}`
}

async function sha256Hex(value: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle
  if (subtle) {
    const digest = await subtle.digest('SHA-256', new TextEncoder().encode(value))
    return Array.from(new Uint8Array(digest))
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('')
  }
  // crypto.subtle is unavailable in insecure contexts (e.g. an iPhone opening the
  // dev server over a LAN IP). A deterministic 64-bit FNV-1a keeps dedupe stable.
  return fnv1a64Hex(value).padStart(16, '0').repeat(4)
}

function fnv1a64Hex(value: string): string {
  let hash = 0xcbf29ce484222325n
  const prime = 0x100000001b3n
  for (const byte of new TextEncoder().encode(value)) {
    hash ^= BigInt(byte)
    hash = (hash * prime) & 0xffffffffffffffffn
  }
  return hash.toString(16)
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

const FRACTION_GLYPHS: Record<string, string> = {
  '1/2': '½',
  '1/4': '¼',
  '3/4': '¾',
  '1/3': '⅓',
  '2/3': '⅔',
  '1/8': '⅛',
  '3/8': '⅜',
  '5/8': '⅝',
  '7/8': '⅞',
}

/** Format the preserved quantity token for display without changing stored data. */
function formatQuantityForDisplay(value: string): string {
  return value
    .replace(/\b(1\/2|1\/4|3\/4|1\/3|2\/3|1\/8|3\/8|5\/8|7\/8)\b/g, (fraction) => {
      return FRACTION_GLYPHS[fraction] ?? fraction
    })
    .replace(/(\d)\s+(½|¼|¾|⅓|⅔|⅛|⅜|⅝|⅞)/g, '$1$2')
    .replace(/(\d)\.(\d)/g, '$1,$2')
    .replace(/\s*[-–]\s*/g, '–')
}

export function formatIngredientAmount(ingredient: Ingredient): string {
  if (ingredient.quantity === null) return ''
  const preserved = ingredient.quantityText?.trim()
  const quantity =
    preserved || ingredient.quantity.toLocaleString('de-DE', { maximumFractionDigits: 2 })
  return [formatQuantityForDisplay(quantity), ingredient.unit].filter(Boolean).join(' ')
}
