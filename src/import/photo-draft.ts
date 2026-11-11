/*
 * Küchenrunde – Zuordnung der KI-Antwort in den vorhandenen Rezepteditor
 * Copyright (C) 2026 openCook Web contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Es gibt bewusst keine zweite Rezeptdatenstruktur: Die validierte
 * OCR-Antwort wird in den bestehenden `RecipeDraft` abgebildet, im vorhandenen
 * `RecipeForm` korrigiert und mit `buildRecipeFromDraft` gespeichert. Nur die
 * Herkunft (`importSource: 'photo'`) und die Rohmetadaten sind neu.
 */

import { randomId } from '../lib/id'
import type { RecipeDraft } from '../recipe/editor'
import { buildRecipeFromDraft, draftFromParts, parseQuantityInput } from '../recipe/editor'
import type {
  Ingredient,
  IngredientGroup,
  Instruction,
  Recipe,
} from '../types'
import {
  PHOTO_OCR_CONTRACT_VERSION,
  type OcrIngredient,
  type OcrPageReport,
  type OcrRecipe,
  type OcrStep,
  type OcrUncertainty,
} from './photo-ocr'

/** Sichtbarer Hinweis aus der KI-Antwort, mit nachvollziehbarem Bezug. */
export interface PhotoDraftNotice {
  id: string
  tone: 'warning' | 'danger'
  /** z. B. „Zutat 3, Menge“, „Schritt 2, Temperatur“ oder „Seite 1“. */
  reference: string
  text: string
}

function noticeKey(reference: string, text: string): string {
  return `${reference.toLocaleLowerCase('de')}\u0000${text.toLocaleLowerCase('de')}`
}

function draftIngredient(
  ingredient: OcrIngredient,
  index: number,
  groupIdFor: (title: string) => string | null,
): Ingredient | null {
  const name = ingredient.name.trim()
  if (!name) return null
  const quantityText = ingredient.quantity.trim()
  const unit = ingredient.unit.trim()
  return {
    id: randomId(),
    groupId: groupIdFor(ingredient.group),
    position: index,
    raw: [quantityText, unit, name].filter(Boolean).join(' '),
    name,
    quantity: parseQuantityInput(quantityText),
    quantityText: quantityText || null,
    unit: unit || null,
    purchaseNote: ingredient.purchaseNote.trim(),
    preparationNote: ingredient.preparationNote.trim(),
    parseStatus: parseQuantityInput(quantityText) !== null ? 'parsed' : 'plain',
    links: [],
  }
}

function draftInstruction(step: OcrStep, index: number): Instruction | null {
  const text = step.text.trim()
  if (!text) return null
  return {
    id: randomId(),
    position: index,
    raw: text,
    text,
    references: [],
  }
}

/**
 * Bildet die validierte KI-Antwort auf den bestehenden editierbaren Entwurf ab.
 * Mengen und Einheiten bleiben exakt als Text erhalten („1/2“, „2-3“,
 * „Prise“); nichts wird umgerechnet oder erfunden.
 */
export function draftFromOcrRecipe(recipe: OcrRecipe): RecipeDraft {
  const groups: IngredientGroup[] = []
  const groupIds = new Map<string, string>()
  const groupIdFor = (title: string): string | null => {
    const trimmed = title.trim()
    if (!trimmed) return null
    const key = trimmed.toLocaleLowerCase('de')
    const existing = groupIds.get(key)
    if (existing) return existing
    const id = `group-${groups.length + 1}`
    groupIds.set(key, id)
    groups.push({
      id,
      title: trimmed,
      position: groups.length,
      rawHeading: `# ${trimmed}`,
    })
    return id
  }

  const ingredients = recipe.ingredients
    .map((ingredient, index) => draftIngredient(ingredient, index, groupIdFor))
    .filter((ingredient): ingredient is Ingredient => ingredient !== null)
  const instructions = recipe.steps
    .map((step, index) => draftInstruction(step, index))
    .filter((instruction): instruction is Instruction => instruction !== null)

  return draftFromParts({
    title: recipe.title.trim(),
    description: recipe.description.trim(),
    sourceUrl: '',
    notes: recipe.notes.trim(),
    servingsText: recipe.servingsText.trim(),
    prepTime: recipe.prepTime.trim(),
    cookTime: recipe.cookTime.trim(),
    totalTime: recipe.totalTime.trim(),
    cuisine: [],
    dishType: [],
    effort: '',
    tags: [],
    favorite: false,
    wantToCook: false,
    ingredientGroups: groups,
    ingredients,
    instructions,
  })
}

function pageNotice(page: OcrPageReport): PhotoDraftNotice | null {
  const index = Number.isInteger(page.index) ? page.index + 1 : null
  const reference = index ? `Seite ${index}` : 'Seite'
  if (page.kind === 'unclear') {
    return {
      id: `page-${page.index}`,
      tone: 'danger',
      reference,
      text: page.note.trim() || 'Diese Seite ist unleserlich. Bitte das Foto prüfen.',
    }
  }
  if (page.kind === 'not-a-recipe') {
    return {
      id: `page-${page.index}`,
      tone: 'warning',
      reference,
      text:
        page.note.trim() ||
        'Auf dieser Seite wurde kein Rezept erkannt. Bitte prüfen, ob die richtige Seite ausgewählt ist.',
    }
  }
  if (page.kind === 'continuation' && page.note.trim()) {
    return {
      id: `page-${page.index}`,
      tone: 'warning',
      reference,
      text: page.note.trim(),
    }
  }
  return null
}

/**
 * Alle Unklarheiten und Warnungen als nachvollziehbare Liste: explizite
 * Unklarheiten der KI, unsichere Zutaten/Schritte und Seitenberichte. Doppelte
 * Meldungen werden zusammengeführt, damit die Liste lesbar bleibt.
 */
export function photoDraftNotices(
  recipe: OcrRecipe,
  pages: readonly OcrPageReport[] = [],
): PhotoDraftNotice[] {
  const notices: PhotoDraftNotice[] = []
  const seen = new Set<string>()

  function push(notice: PhotoDraftNotice) {
    const key = noticeKey(notice.reference, notice.text)
    if (seen.has(key)) return
    seen.add(key)
    notices.push(notice)
  }

  for (const [index, uncertainty] of recipe.uncertainties.entries()) {
    const reference = uncertainty.reference.trim() || 'Unklare Stelle'
    const text = uncertainty.note.trim() || 'Angabe unklar.'
    push({
      id: `uncertainty-${index}`,
      tone: 'warning',
      reference,
      text,
    })
  }

  recipe.ingredients.forEach((ingredient, index) => {
    if (!ingredient.uncertain && !ingredient.uncertainty.trim()) return
    const name = ingredient.name.trim()
    push({
      id: `ingredient-${index}`,
      tone: 'warning',
      reference: `Zutat ${index + 1}${name ? ` (${name})` : ''}`,
      text: ingredient.uncertainty.trim() || 'Menge oder Bezeichnung ist unklar.',
    })
  })

  recipe.steps.forEach((step, index) => {
    if (!step.uncertain && !step.uncertainty.trim()) return
    push({
      id: `step-${index}`,
      tone: 'warning',
      reference: `Schritt ${index + 1}`,
      text: step.uncertainty.trim() || 'Dieser Schritt ist unklar.',
    })
  })

  for (const [index, warning] of recipe.warnings.entries()) {
    push({
      id: `warning-${index}`,
      tone: 'warning',
      reference: '',
      text: warning,
    })
  }

  for (const page of pages) {
    const notice = pageNotice(page)
    if (notice) push(notice)
  }

  return notices
}

/** Die KI hat zwar geantwortet, aber kein Rezept erkannt. */
export function isUnrecognizedOcrRecipe(recipe: OcrRecipe): boolean {
  return (
    !recipe.recognized &&
    recipe.ingredients.length === 0 &&
    recipe.steps.length === 0
  )
}

export interface BuildPhotoRecipeOptions {
  model: string
  pageCount: number
  /** Zeitpunkt der Erkennung, für die Rohmetadaten. */
  recognizedAt: number
  pages?: readonly OcrPageReport[]
  uncertainties?: readonly OcrUncertainty[]
  warnings?: readonly string[]
  contractVersion?: number
  /** Optional stabile Import-ID; sonst wird eine `photo-…`-ID erzeugt. */
  importId?: string
}

export function photoImportId(recognizedAt: number, random = randomId()): string {
  const suffix = random.replace(/[^A-Za-z0-9]/g, '').slice(0, 12)
  return `photo-${recognizedAt}-${suffix}`
}

/**
 * Baut das speicherbare Rezept über den bestehenden `buildRecipeFromDraft`.
 * `importSource: 'photo'` sowie Modell, Seitenzahl und Erkennungszeitpunkt
 * werden in `raw` festgehalten; der Rest bleibt das normale Rezeptmodell.
 */
export function buildPhotoRecipe(
  draft: RecipeDraft,
  options: BuildPhotoRecipeOptions,
): Recipe {
  const importId = options.importId ?? photoImportId(options.recognizedAt)
  return buildRecipeFromDraft(draft, undefined, {
    importSource: 'photo',
    importId,
    raw: {
      source: 'photo-ocr',
      contractVersion: options.contractVersion ?? PHOTO_OCR_CONTRACT_VERSION,
      model: options.model,
      pageCount: options.pageCount,
      recognizedAt: options.recognizedAt,
      pages: options.pages ?? [],
      uncertainties: options.uncertainties ?? [],
      warnings: options.warnings ?? [],
    },
  })
}
