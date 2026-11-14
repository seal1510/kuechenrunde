/*
 * Küchenrunde – etablierte Zutaten-Schreibweisen aus dem Zutatenkatalog
 * Copyright (C) 2026 openCook Web contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Der Zutatenkatalog (`ingredientCatalog.ts`) ist die einzige Quelle für
 * bekannte Lebensmittelnamen. Dieses Modul stellt seine Schreibweisen als
 * kompaktes Wörterbuch für die deterministische Sprachkorrektur des
 * Foto-Imports bereit. Es werden ausschließlich Namen und Aliasse geliefert –
 * keine Kategorien, Produktformen oder Übersetzungen, damit die Korrektur
 * keine Produkte umdeutet.
 */

import { catalogFamilies } from './ingredientCatalog'

let cachedLabels: readonly string[] | null = null

/** Alle etablierten Schreibweisen des Zutatenkatalogs (gecacht). */
export function catalogSpellingLabels(): readonly string[] {
  if (cachedLabels) return cachedLabels
  const labels: string[] = []
  for (const family of catalogFamilies()) {
    labels.push(...family.names)
    for (const product of family.products) {
      labels.push(product.label)
      if (product.aliases) labels.push(...product.aliases)
    }
  }
  cachedLabels = labels
  return cachedLabels
}
