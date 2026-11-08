/*
 * openCook Web
 * Copyright (C) 2026 openCook Web contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Universal schema.org/Recipe extractor for HTML documents.
 *
 * This module is deliberately independent of React, Dexie and the network: it
 * receives an HTML string plus the document URL and returns structured recipe
 * candidates. It never guesses recipe data. If a page has no structured
 * recipe, the caller gets zero candidates and an explanation.
 *
 * Supported input shapes:
 *  - one or many <script type="application/ld+json"> blocks
 *  - a single object, arrays, @graph and nested objects
 *  - @type as string, array, full schema.org URL or prefixed name
 *  - recipeIngredient as strings or structured objects
 *  - recipeInstructions as strings, HowToStep, HowToSection or ItemList
 *  - image as string, array, ImageObject or nested url/contentUrl
 */

import { parseDuration } from '../lib/duration'
import { formatParsedDuration } from '../lib/format'
import { parseIngredientLines, type IngredientLineInput } from './ingredients'
import { resolveHttpUrl } from './url'
import type { IngredientGroup, Ingredient, IngredientLink, Instruction } from '../types'

export interface UrlRecipeCandidate {
  /** Stable identity inside this document (JSON-LD @id or normalised title). */
  key: string
  title: string
  description: string
  servingsText: string
  servingsNumber: number | null
  prepTime: string
  cookTime: string
  totalTime: string
  ingredientGroups: IngredientGroup[]
  ingredients: Ingredient[]
  instructions: Instruction[]
  /** recipeCategory values as supplied by the page. */
  categories: string[]
  cuisine: string[]
  dishType: string[]
  tags: string[]
  /** Absolute http(s) image URLs, never data: or javascript: URLs. */
  images: string[]
  warnings: string[]
  /** Original JSON-LD recipe object for lossless storage/backup. */
  raw: Record<string, unknown>
}

export interface RecipeExtraction {
  candidates: UrlRecipeCandidate[]
  warnings: string[]
  /** Number of application/ld+json script blocks found. */
  jsonLdBlockCount: number
  /** Number of schema.org/Recipe objects before title/identity de-duplication. */
  recipeObjectCount: number
  /** Effective base URL (<base href> or document URL). */
  baseUrl: string
}

const MAX_JSON_LD_BLOCKS = 100
const MAX_JSON_LD_NODES = 50_000
const MAX_JSON_LD_DEPTH = 40
const MAX_RECIPE_CANDIDATES = 25
const MAX_IMAGES = 10
const MAX_INGREDIENTS = 500
const MAX_INSTRUCTIONS = 300
const MAX_DESCRIPTION_LENGTH = 20_000

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  auml: 'ä',
  ouml: 'ö',
  uuml: 'ü',
  Auml: 'Ä',
  Ouml: 'Ö',
  Uuml: 'Ü',
  szlig: 'ß',
  euro: '€',
  copy: '©',
  reg: '®',
}

export function decodeHtmlEntities(value: string): string {
  return value.replace(/&(#x?[0-9a-f]+|[a-z][a-z0-9]+);/gi, (match, entity: string) => {
    if (entity.startsWith('#x') || entity.startsWith('#X')) {
      const code = Number.parseInt(entity.slice(2), 16)
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : match
    }
    if (entity.startsWith('#')) {
      const code = Number.parseInt(entity.slice(1), 10)
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : match
    }
    const named = NAMED_ENTITIES[entity] ?? NAMED_ENTITIES[entity.toLowerCase()]
    return named ?? match
  })
}

/** Convert a small HTML fragment to plain text without executing or trusting it. */
export function htmlToText(value: string): string {
  if (!value) return ''
  const text = value
    .replace(/\r\n?/g, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6]|tr|section|article|blockquote)>/gi, '\n')
    .replace(/<[^>]*>/g, '')
  return decodeHtmlEntities(text)
    .split('\n')
    .map((line) => line.replace(/[ \t\f\v]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
    .trim()
}

function cleanLine(value: unknown): string {
  if (typeof value === 'string') return htmlToText(value).replace(/\s+/g, ' ').trim()
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return ''
}

function readScalar(value: unknown): string {
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  if (Array.isArray(value)) {
    for (const entry of value) {
      const text = readScalar(entry)
      if (text) return text
    }
  }
  if (isRecord(value)) {
    return readScalar(value.name) || readScalar(value.value) || readScalar(value.text)
  }
  return ''
}

function readStringList(value: unknown, limit = 40): string[] {
  const values: string[] = []
  const push = (entry: string) => {
    for (const part of entry.split(',')) {
      const text = htmlToText(part).replace(/\s+/g, ' ').trim()
      if (text && text.length <= 200) values.push(text)
    }
  }
  const visit = (entry: unknown) => {
    if (typeof entry === 'string') {
      push(entry)
      return
    }
    if (typeof entry === 'number' && Number.isFinite(entry)) {
      values.push(String(entry))
      return
    }
    if (Array.isArray(entry)) {
      for (const item of entry) visit(item)
    }
  }
  visit(value)
  const result: string[] = []
  const seen = new Set<string>()
  for (const entry of values) {
    const key = entry.toLocaleLowerCase('de')
    if (seen.has(key)) continue
    seen.add(key)
    result.push(entry)
    if (result.length >= limit) break
  }
  return result
}

function readDuration(
  value: unknown,
  field: 'prepTime' | 'cookTime' | 'totalTime',
  warnings: string[],
): string {
  const text = readScalar(value)
  if (!text) return ''
  const parsed = parseDuration(text)
  if (!parsed) {
    warnings.push(`Zeitangabe „${field}“ (${text}) konnte nicht sicher interpretiert werden.`)
    return text
  }
  return formatParsedDuration(parsed)
}

function leadingInt(value: string): number | null {
  const match = /^\s*(\d{1,3})/.exec(value)
  return match?.[1] ? Number.parseInt(match[1], 10) : null
}

function readServings(value: unknown): string {
  const text = readScalar(value)
  return text ? htmlToText(text).replace(/\s+/g, ' ').trim() : ''
}

/** Parse recipeIngredient, accepting strings, arrays and structured objects. */
function readIngredientLines(
  value: unknown,
  baseUrl: string,
  warnings: string[],
  depth = 0,
): IngredientLineInput[] {
  if (value === undefined || value === null) return []
  if (depth > 10) {
    warnings.push('Zutatenstruktur ist zu tief verschachtelt und wurde teilweise ignoriert.')
    return []
  }
  const lines: IngredientLineInput[] = []

  const visit = (entry: unknown) => {
    if (lines.length >= MAX_INGREDIENTS) return
    if (typeof entry === 'string') {
      for (const line of htmlToText(entry).split('\n')) {
        const text = line.trim()
        if (text) lines.push({ raw: text })
        if (lines.length >= MAX_INGREDIENTS) return
      }
      return
    }
    if (Array.isArray(entry)) {
      for (const item of entry) visit(item)
      return
    }
    if (!isRecord(entry)) {
      warnings.push('Eine Zutatenangabe hatte ein unbekanntes Format und wurde übersprungen.')
      return
    }
    if (Array.isArray(entry.itemListElement)) {
      visit(entry.itemListElement)
      return
    }

    const name = cleanLine(entry.name) || cleanLine(entry.text)
    const description = cleanLine(entry.description)
    const amount = cleanLine(entry.amount ?? entry.quantity)
    const unit = cleanLine(entry.unitText ?? entry.unit ?? entry.unitCode)
    if (!name && !description) {
      warnings.push('Eine strukturierte Zutat ohne Namen wurde übersprungen.')
      return
    }

    let raw = name || description
    if (name && description && !name.includes(description)) {
      // Keep the source text visible instead of guessing whether the
      // description is a shopping or preparation hint.
      raw = `${raw} ${description}`
    }
    if (amount && !raw.startsWith(amount)) raw = `${amount} ${raw}`
    if (unit) {
      const unitPresent = new RegExp(`(^|\\s)${escapeRegExp(unit)}(\\s|$)`, 'i').test(raw)
      if (!unitPresent) {
        raw =
          amount && raw.startsWith(amount)
            ? `${amount} ${unit} ${raw.slice(amount.length).trim()}`
            : `${unit} ${raw}`
      }
    }

    const purchaseNote =
      cleanLine(entry.purchaseNote) ||
      cleanLine(entry.shoppingNote) ||
      ''
    const preparationNote =
      cleanLine(entry.preparationNote) ||
      cleanLine(entry.prepNote) ||
      ''

    const links: IngredientLink[] = []
    const linkUrl = readScalar(entry.url ?? entry.sameAs)
    if (linkUrl) {
      const resolved = resolveHttpUrl(linkUrl, baseUrl)
      if (resolved) links.push({ label: name || description, url: resolved })
    }

    lines.push({
      raw: raw.trim(),
      purchaseNote: purchaseNote || undefined,
      preparationNote: preparationNote || undefined,
      links: links.length > 0 ? links : undefined,
    })
  }

  visit(value)
  if (lines.length >= MAX_INGREDIENTS) {
    warnings.push(`Nur die ersten ${MAX_INGREDIENTS} Zutaten wurden übernommen.`)
  }
  return lines
}

/** Flatten recipeInstructions in document order, including HowToSection nesting. */
function readInstructions(value: unknown, warnings: string[]): Instruction[] {
  if (value === undefined || value === null) return []
  const flat: Array<{ text: string; sectionPath: string[] }> = []
  let truncated = false

  const pushText = (text: string, sectionPath: string[]) => {
    for (const line of text.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed) continue
      if (flat.length >= MAX_INSTRUCTIONS) {
        truncated = true
        return
      }
      flat.push({ text: trimmed, sectionPath })
    }
  }

  const visit = (entry: unknown, sectionPath: string[], depth: number) => {
    if (truncated || depth > 20) return
    if (typeof entry === 'string') {
      pushText(htmlToText(entry), sectionPath)
      return
    }
    if (Array.isArray(entry)) {
      for (const item of entry) visit(item, sectionPath, depth + 1)
      return
    }
    if (!isRecord(entry)) {
      warnings.push('Eine Anweisung hatte ein unbekanntes Format und wurde übersprungen.')
      return
    }

    const itemList =
      entry.itemListElement ?? entry.steps ?? entry.recipeInstructions ?? undefined
    const isSection = hasType(entry['@type'], 'HowToSection') || Array.isArray(itemList)
    const name = cleanLine(entry.name)
    if (isSection && Array.isArray(itemList)) {
      const nextPath = name ? [...sectionPath, name] : sectionPath
      for (const item of itemList) visit(item, nextPath, depth + 1)
      return
    }

    const text =
      cleanLine(entry.text) || cleanLine(entry.name) || cleanLine(entry.description)
    if (text) {
      pushText(text, sectionPath)
    } else {
      warnings.push('Ein Anweisungsobjekt ohne Text wurde übersprungen.')
    }
  }

  visit(value, [], 0)
  if (truncated) warnings.push(`Nur die ersten ${MAX_INSTRUCTIONS} Anweisungen wurden übernommen.`)

  const instructions: Instruction[] = []
  let lastSection = ''
  for (const entry of flat) {
    const section = entry.sectionPath.join(' – ')
    let text = entry.text
    if (section && section !== lastSection && !text.startsWith(`**${section}**`)) {
      // Section titles are source content. Prefixing the first step keeps them
      // visible without inventing an extra numbered step.
      text = `**${section}**\n\n${text}`
    }
    lastSection = section
    instructions.push({
      id: `step-${instructions.length + 1}`,
      position: instructions.length,
      raw: text,
      text,
    })
  }
  return instructions
}

function collectImageUrls(
  value: unknown,
  baseUrl: string,
  warnings: string[],
  out: string[],
  depth = 0,
) {
  if (value === undefined || value === null || depth > 12) return
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return
    if (/^data:/i.test(trimmed)) {
      warnings.push('Ein eingebettetes Data-URL-Bild wurde nicht übernommen.')
      return
    }
    const resolved = resolveHttpUrl(trimmed, baseUrl)
    if (resolved) out.push(resolved)
    else warnings.push('Eine Bild-URL war ungültig und wurde übersprungen.')
    return
  }
  if (Array.isArray(value)) {
    for (const item of value) collectImageUrls(item, baseUrl, warnings, out, depth + 1)
    return
  }
  if (!isRecord(value)) return
  for (const key of ['url', 'contentUrl', 'thumbnailUrl', '@id']) {
    const entry = value[key]
    if (typeof entry === 'string' || Array.isArray(entry) || isRecord(entry)) {
      collectImageUrls(entry, baseUrl, warnings, out, depth + 1)
    }
  }
}

function readImages(value: unknown, baseUrl: string, warnings: string[]): string[] {
  const urls: string[] = []
  collectImageUrls(value, baseUrl, warnings, urls)
  const result: string[] = []
  const seen = new Set<string>()
  for (const url of urls) {
    if (seen.has(url)) continue
    if (url.length > 2048) continue
    seen.add(url)
    result.push(url)
    if (result.length >= MAX_IMAGES) break
  }
  if (urls.length > result.length) {
    warnings.push(`Nur die ersten ${MAX_IMAGES} Bilder wurden berücksichtigt.`)
  }
  return result
}

function hasType(value: unknown, expected: string): boolean {
  const types = Array.isArray(value) ? value : [value]
  const needle = expected.toLocaleLowerCase('en')
  return types.some((entry) => {
    if (typeof entry !== 'string') return false
    const clean = entry.trim().toLocaleLowerCase('en')
    return (
      clean === needle ||
      clean.endsWith(`/${needle}`) ||
      clean.endsWith(`:${needle}`) ||
      clean.endsWith(`#${needle}`)
    )
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Read the effective base URL from <base href>, falling back to the document URL. */
export function documentBaseUrl(html: string, pageUrl: string): string {
  const baseTag = /<base\b[^>]*>/i.exec(html)
  if (baseTag) {
    const href = readAttribute(baseTag[0], 'href')
    if (href) {
      const resolved = resolveHttpUrl(decodeHtmlEntities(href), pageUrl)
      if (resolved) return resolved
    }
  }
  return pageUrl
}

function readAttribute(attributes: string, name: string): string | null {
  const regex = new RegExp(
    `(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`,
    'i',
  )
  const match = regex.exec(attributes)
  if (!match) return null
  const value = match[1] ?? match[2] ?? match[3] ?? ''
  return decodeHtmlEntities(value).trim()
}

/** Extract the text of every application/ld+json script block. */
export function extractJsonLdBlocks(html: string): { texts: string[]; warnings: string[] } {
  const texts: string[] = []
  const warnings: string[] = []
  const script = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi
  let match: RegExpExecArray | null
  while ((match = script.exec(html)) !== null) {
    const type = readAttribute(match[1] ?? '', 'type')
    if (!type) continue
    const mime = type.split(';')[0]?.trim().toLocaleLowerCase('en')
    if (mime !== 'application/ld+json') continue
    if (texts.length >= MAX_JSON_LD_BLOCKS) {
      warnings.push(`Mehr als ${MAX_JSON_LD_BLOCKS} JSON-LD-Blöcke gefunden; weitere wurden ignoriert.`)
      break
    }
    texts.push(match[2] ?? '')
  }
  return { texts, warnings }
}

function parseJsonLdText(text: string, index: number, warnings: string[]): unknown {
  const cleaned = text
    .replace(/^\uFEFF/, '')
    .trim()
    .replace(/^<!--/, '')
    .replace(/-->$/, '')
    .replace(/^\/\*<!\[CDATA\[\*\//, '')
    .replace(/\/\*\]\]>\*\/$/, '')
    .replace(/^<!\[CDATA\[/, '')
    .replace(/\]\]>$/, '')
    .trim()
  if (!cleaned) {
    warnings.push(`JSON-LD-Block ${index + 1} ist leer.`)
    return null
  }
  try {
    return JSON.parse(cleaned)
  } catch (firstError) {
    const decoded = decodeHtmlEntities(cleaned)
    if (decoded !== cleaned) {
      try {
        return JSON.parse(decoded)
      } catch {
        // Fall through to the original error message.
      }
    }
    warnings.push(
      `JSON-LD-Block ${index + 1} ist kein gültiges JSON: ${(firstError as Error).message}`,
    )
    return null
  }
}

function collectRecipeObjects(
  value: unknown,
  out: Record<string, unknown>[],
  warnings: string[],
): void {
  const seen = new WeakSet<object>()
  let nodes = 0
  let truncated = false

  const walk = (entry: unknown, depth: number) => {
    if (truncated || depth > MAX_JSON_LD_DEPTH) {
      truncated = true
      return
    }
    if (Array.isArray(entry)) {
      for (const item of entry) walk(item, depth + 1)
      return
    }
    if (!isRecord(entry)) return
    if (seen.has(entry)) return
    seen.add(entry)
    nodes += 1
    if (nodes > MAX_JSON_LD_NODES) {
      truncated = true
      return
    }
    if (hasType(entry['@type'], 'Recipe')) {
      out.push(entry)
      if (out.length > MAX_RECIPE_CANDIDATES) {
        truncated = true
        return
      }
    }
    for (const [key, child] of Object.entries(entry)) {
      if (key === '@context') continue
      if (typeof child === 'object' && child !== null) walk(child, depth + 1)
    }
  }

  walk(value, 0)
  if (truncated) {
    warnings.push('Die JSON-LD-Struktur war zu groß oder zu tief; sie wurde gekürzt.')
  }
}

function candidateKeyFor(
  recipe: Record<string, unknown>,
  title: string,
  index: number,
  baseUrl: string,
): string {
  const id = readScalar(recipe['@id'])
  if (id) {
    const resolved = resolveHttpUrl(id, baseUrl) ?? id
    return `id:${resolved}`
  }
  const normalizedTitle = title
    .toLocaleLowerCase('de')
    .replace(/\s+/g, ' ')
    .trim()
  return normalizedTitle ? `title:${normalizedTitle}` : `untitled:${index + 1}`
}

function normalizeCandidate(
  recipe: Record<string, unknown>,
  index: number,
  baseUrl: string,
  key: string,
): UrlRecipeCandidate {
  const warnings: string[] = []

  const title = cleanLine(recipe.name) || cleanLine(recipe.headline)
  if (!title) warnings.push('Das Rezept hat keinen Titel (Feld „name“).')

  const description = htmlToText(readScalar(recipe.description)).slice(
    0,
    MAX_DESCRIPTION_LENGTH,
  )
  const servingsText = readServings(recipe.recipeYield ?? recipe.yield)

  const ingredientInput = readIngredientLines(
    recipe.recipeIngredient ?? recipe.ingredients,
    baseUrl,
    warnings,
  )
  const ingredientResult = parseIngredientLines(ingredientInput)
  warnings.push(...ingredientResult.warnings)
  if (ingredientResult.ingredients.length === 0) {
    warnings.push('Das Rezept enthält keine Zutaten (Feld „recipeIngredient“).')
  }

  const instructions = readInstructions(
    recipe.recipeInstructions ?? recipe.instructions,
    warnings,
  )
  if (instructions.length === 0) {
    warnings.push('Das Rezept enthält keine Anweisungen (Feld „recipeInstructions“).')
  }

  const categories = readStringList(recipe.recipeCategory ?? recipe.recipeType)
  const cuisine = readStringList(recipe.recipeCuisine)
  const tags = readStringList(recipe.keywords ?? recipe.tag)
  const images = readImages(recipe.image ?? recipe.images ?? recipe.thumbnailUrl, baseUrl, warnings)

  return {
    key,
    title,
    description,
    servingsText,
    servingsNumber: leadingInt(servingsText),
    prepTime: readDuration(recipe.prepTime, 'prepTime', warnings),
    cookTime: readDuration(recipe.cookTime, 'cookTime', warnings),
    totalTime: readDuration(recipe.totalTime, 'totalTime', warnings),
    ingredientGroups: ingredientResult.groups,
    ingredients: ingredientResult.ingredients,
    instructions,
    categories,
    cuisine,
    // recipeCategory is the schema.org equivalent of a dish type. The imported
    // categories field stays reserved for Mela's category semantics.
    dishType: categories,
    tags,
    images,
    warnings,
    raw: recipe,
  }
}

/**
 * Extract every schema.org/Recipe candidate from an HTML document.
 * Never throws for malformed page content; problems become warnings.
 */
export function extractRecipeCandidates(html: string, pageUrl: string): RecipeExtraction {
  const warnings: string[] = []
  const baseUrl = documentBaseUrl(html || '', pageUrl)
  const { texts, warnings: blockWarnings } = extractJsonLdBlocks(html || '')
  warnings.push(...blockWarnings)

  const recipeObjects: Record<string, unknown>[] = []
  for (let index = 0; index < texts.length; index += 1) {
    const parsed = parseJsonLdText(texts[index] ?? '', index, warnings)
    if (parsed === null) continue
    collectRecipeObjects(parsed, recipeObjects, warnings)
  }

  if (texts.length === 0) {
    warnings.push(
      'Auf der Seite wurden keine JSON-LD-Daten gefunden. Ohne schema.org/Recipe wird kein Rezept geraten.',
    )
  } else if (recipeObjects.length === 0) {
    warnings.push(
      'Es sind JSON-LD-Daten vorhanden, aber kein Objekt vom Typ schema.org/Recipe.',
    )
  }

  const candidates: UrlRecipeCandidate[] = []
  const seenKeys = new Map<string, number>()
  const seenIds = new Set<string>()
  for (let index = 0; index < recipeObjects.length; index += 1) {
    const recipe = recipeObjects[index]!
    const id = readScalar(recipe['@id'])
    if (id) {
      if (seenIds.has(id)) continue
      seenIds.add(id)
    }
    const title = cleanLine(recipe.name) || cleanLine(recipe.headline)
    const baseKey = candidateKeyFor(recipe, title, index, baseUrl)
    const count = (seenKeys.get(baseKey) ?? 0) + 1
    seenKeys.set(baseKey, count)
    const key = count === 1 ? baseKey : `${baseKey}#${count}`
    try {
      candidates.push(normalizeCandidate(recipe, index, baseUrl, key))
    } catch (error) {
      warnings.push(
        `Rezept ${index + 1} konnte nicht gelesen werden: ${(error as Error).message}`,
      )
    }
  }

  if (candidates.length > MAX_RECIPE_CANDIDATES) {
    candidates.length = MAX_RECIPE_CANDIDATES
    warnings.push(`Nur die ersten ${MAX_RECIPE_CANDIDATES} Rezepte wurden übernommen.`)
  }

  return {
    candidates,
    warnings,
    jsonLdBlockCount: texts.length,
    recipeObjectCount: recipeObjects.length,
    baseUrl,
  }
}
