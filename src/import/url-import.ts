/*
 * openCook Web
 * Copyright (C) 2026 openCook Web contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Integration between the pure JSON-LD parser and the existing local recipe
 * library. This is the only URL-import module that touches Dexie.
 *
 * Duplicate rules:
 *  - The source URL is stored in `importUrl` (normalised final URL).
 *  - The chosen JSON-LD recipe keeps its own stable `candidateKey`.
 *  - An exact duplicate means same URL *and* same candidate key.
 *  - Same URL but a different candidate is reported as a hint, not a block.
 *  - Titles are never used to lock or merge recipes.
 *  - Existing recipes are never written or overwritten by an import.
 */

import { randomId } from '../lib/id'
import { draftFromParts, buildRecipeFromDraft, type RecipeDraft } from '../recipe/editor'
import type { Recipe, RecipeImportMeta } from '../types'
import type { UrlRecipeCandidate } from './jsonld'
import { normalizeHttpUrl, sourceHost } from './url'
import type { RecipeUrlFetcher } from './url-fetcher'
import type { EditorImage } from '../recipe/repository'

export interface UrlImportContext {
  /** URL the user entered. */
  originalUrl: string
  /** Final URL after redirects, normalised. */
  finalUrl: string
  fetchedAt: number
  candidate: UrlRecipeCandidate
}

export interface UrlDuplicateInfo {
  /** Same URL and same JSON-LD recipe identity. */
  exact: Recipe | null
  /** Other recipes from the same page (different JSON-LD recipe). */
  sameSource: Recipe[]
}

const FNV_OFFSET = 0xcbf29ce484222325n
const FNV_PRIME = 0x100000001b3n

function fnv1a64Hex(value: string): string {
  let hash = FNV_OFFSET
  for (const byte of new TextEncoder().encode(value)) {
    hash ^= BigInt(byte)
    hash = (hash * FNV_PRIME) & 0xffffffffffffffffn
  }
  return hash.toString(16).padStart(16, '0')
}

export function candidateImportKey(finalUrl: string, candidateKey: string): string {
  const normalized = normalizeHttpUrl(finalUrl) ?? finalUrl.trim()
  return `${normalized}#${candidateKey}`
}

export function importIdForCandidate(finalUrl: string, candidateKey: string): string {
  // The hash keeps the source traceable; the random suffix keeps the unique
  // importId index free for an explicitly confirmed second copy.
  return `url-${fnv1a64Hex(candidateImportKey(finalUrl, candidateKey))}-${randomId()}`
}

/** Map extracted JSON-LD data to the same draft shape the recipe editor uses. */
export function draftFromUrlCandidate(context: UrlImportContext): RecipeDraft {
  const { candidate } = context
  return draftFromParts({
    title: candidate.title,
    description: candidate.description,
    sourceUrl: context.finalUrl,
    notes: '',
    servingsText: candidate.servingsText,
    prepTime: candidate.prepTime,
    cookTime: candidate.cookTime,
    totalTime: candidate.totalTime,
    cuisine: candidate.cuisine,
    dishType: candidate.dishType,
    effort: '',
    tags: candidate.tags,
    favorite: false,
    wantToCook: false,
    ingredientGroups: candidate.ingredientGroups,
    ingredients: candidate.ingredients,
    instructions: candidate.instructions,
  })
}

export interface UrlRecipeBuildInput {
  draft: RecipeDraft
  context: UrlImportContext
  imageWarnings: string[]
}

/** Build a new URL-imported recipe. Never pass an existing recipe here. */
export function buildUrlRecipe(input: UrlRecipeBuildInput): Recipe {
  const { draft, context, imageWarnings } = input
  const importMeta: RecipeImportMeta = {
    source: 'url',
    originalUrl: context.originalUrl,
    finalUrl: context.finalUrl,
    candidateKey: context.candidate.key,
    fetchedAt: context.fetchedAt,
    imageSourceUrls: [...context.candidate.images],
    imageWarnings: [...imageWarnings],
  }

  return buildRecipeFromDraft(draft, undefined, {
    importSource: 'url',
    importId: importIdForCandidate(context.finalUrl, context.candidate.key),
    importUrl: context.finalUrl,
    importMeta,
    // recipeCategory is mapped to editable dishType; keep imported categories
    // reserved for Mela semantics.
    categories: [],
    raw: {
      source: 'jsonld',
      documentUrl: context.finalUrl,
      originalUrl: context.originalUrl,
      candidateKey: context.candidate.key,
      fetchedAt: context.fetchedAt,
      jsonLd: context.candidate.raw,
    },
  })
}

/**
 * Find recipes whose source URL matches. Uses normalised URLs only, never
 * titles. A full scan also catches manual/Mela recipes with a matching
 * `sourceUrl` that predate URL imports.
 */
export function findUrlImportDuplicatesIn(
  recipes: readonly Recipe[],
  importUrl: string,
  candidateKey: string,
): UrlDuplicateInfo {
  const normalized = normalizeHttpUrl(importUrl)
  if (!normalized) return { exact: null, sameSource: [] }

  const sameSource = recipes.filter((recipe) => {
    for (const raw of [recipe.importUrl, recipe.sourceUrl]) {
      if (!raw) continue
      if (normalizeHttpUrl(raw) === normalized) return true
    }
    return false
  })
  const exact = sameSource.find((recipe) => recipe.importMeta?.candidateKey === candidateKey) ?? null
  return {
    exact,
    sameSource: sameSource.filter((recipe) => recipe.id !== exact?.id),
  }
}

export interface DownloadedImages {
  images: EditorImage[]
  warnings: string[]
}

/**
 * Download candidate images through the same safe fetch service and keep their
 * bytes locally. Any failure only produces a warning; the recipe import stays
 * possible and the editor still offers manual image selection.
 */
export async function downloadCandidateImages(
  imageUrls: string[],
  fetcher: RecipeUrlFetcher,
  limit = 10,
): Promise<DownloadedImages> {
  const images: EditorImage[] = []
  const warnings: string[] = []
  const unique = Array.from(new Set(imageUrls.filter(Boolean)))
  if (unique.length > limit) {
    warnings.push(`Es wurden nur die ersten ${limit} Bilder geladen.`)
  }
  for (const url of unique.slice(0, limit)) {
    try {
      const image = await fetcher.fetchImage(url)
      images.push({
        id: randomId(),
        bytes: image.bytes,
        mimeType: image.mimeType,
      })
    } catch (error) {
      warnings.push(
        `Bild von ${sourceHost(url)} konnte nicht sicher geladen werden: ${(error as Error).message}`,
      )
    }
  }
  return { images, warnings }
}

/** Small helper for UI copy; exported separately to keep the page readable. */
export function duplicateSummary(info: UrlDuplicateInfo): string {
  if (info.exact) {
    return 'Dieses Rezept wurde bereits von dieser URL importiert. Das bestehende Rezept bleibt unverändert.'
  }
  if (info.sameSource.length > 0) {
    return 'Von dieser Seite ist bereits ein anderes Rezept importiert. Es wird nichts überschrieben.'
  }
  return ''
}
