/*
 * Küchenrunde (vormals openCook Web)
 * Copyright (C) 2026 openCook Web contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Maschinenlesbarer Export des tatsächlich verwendeten Zutatenkatalogs.
 *
 * Der Export wird beim Build aus CATALOG_FAMILIES erzeugt und unter
 * /legal/ingredient-catalog.json ausgeliefert. Es gibt bewusst keine zweite,
 * manuell gepflegte Katalogdatei: Diese Datei ist nur ein Serialisierer für
 * die vorhandenen Daten aus `ingredientCatalogData.ts`.
 *
 * Der abgeleitete Datenbestand wird vorsorglich unter der Open Database
 * License (ODbL) 1.0 veröffentlicht. Der Anwendungscode bleibt unter
 * GPL-3.0-or-later. Private Familienrezepte und Einkaufsdaten sind nicht
 * Bestandteil dieses Exports.
 */

import type {
  CatalogCategory,
  CatalogFamilySpec,
  CatalogForm,
  CatalogProductSpec,
  CatalogUnitHint,
} from './ingredientCatalog'
import { CATALOG_FAMILIES } from './ingredientCatalogData'

export const INGREDIENT_CATALOG_DOWNLOAD_PATH = '/legal/ingredient-catalog.json'
export const INGREDIENT_CATALOG_LICENSE = 'ODbL-1.0'
export const INGREDIENT_CATALOG_LICENSE_URL =
  'https://opendatacommons.org/licenses/odbl/1-0/'
export const INGREDIENT_CATALOG_CODE_LICENSE = 'GPL-3.0-or-later'
export const OPEN_FOOD_FACTS_URL = 'https://world.openfoodfacts.org'
export const OPEN_FOOD_FACTS_SOURCE_FILES = [
  {
    name: 'ingredients.txt',
    url: 'https://github.com/openfoodfacts/openfoodfacts-server/blob/main/taxonomies/food/ingredients.txt',
  },
  {
    name: 'ingredients_processing.txt',
    url: 'https://github.com/openfoodfacts/openfoodfacts-server/blob/main/taxonomies/ingredients_processing.txt',
  },
] as const

export interface IngredientCatalogExport {
  title: string
  description: string
  formatVersion: number
  license: typeof INGREDIENT_CATALOG_LICENSE
  licenseUrl: string
  attribution: string
  source: {
    name: string
    url: string
    retrieved: string
    files: Array<{ name: string; url: string }>
  }
  codeLicense: string
  download: string
  counts: { families: number; products: number }
  families: Array<{
    id: string
    names: string[]
    products: Array<{
      id: string
      label: string
      category: CatalogCategory
      forms: CatalogForm[]
      aliases?: string[]
      qualifiers?: string[]
      unitHints?: CatalogUnitHint[]
      default?: true
    }>
  }>
}

function exportProduct(product: CatalogProductSpec): IngredientCatalogExport['families'][number]['products'][number] {
  return {
    id: product.id,
    label: product.label,
    category: product.category,
    forms: [...product.forms],
    ...(product.aliases ? { aliases: [...product.aliases] } : {}),
    ...(product.qualifiers ? { qualifiers: [...product.qualifiers] } : {}),
    ...(product.unitHints ? { unitHints: [...product.unitHints] } : {}),
    ...(product.default ? { default: true as const } : {}),
  }
}

/**
 * Build the public catalogue document from the same data the application
 * uses. The optional parameter exists for tests; production always passes the
 * real CATALOG_FAMILIES.
 */
export function buildIngredientCatalogExport(
  families: readonly CatalogFamilySpec[] = CATALOG_FAMILIES,
): IngredientCatalogExport {
  return {
    title: 'Küchenrunde – kuratierter Zutatenkatalog',
    description:
      'Kuratierte, stark reduzierte Auswahl deutscher Zutatennamen, Synonyme, Produktformen und Einkaufskategorien. Keine vollständige Kopie der Open-Food-Facts-Taxonomien.',
    formatVersion: 1,
    license: INGREDIENT_CATALOG_LICENSE,
    licenseUrl: INGREDIENT_CATALOG_LICENSE_URL,
    attribution: 'Open Food Facts contributors',
    source: {
      name: 'Open Food Facts',
      url: OPEN_FOOD_FACTS_URL,
      retrieved: '2026-11-10',
      files: OPEN_FOOD_FACTS_SOURCE_FILES.map((file) => ({ ...file })),
    },
    codeLicense: INGREDIENT_CATALOG_CODE_LICENSE,
    download: INGREDIENT_CATALOG_DOWNLOAD_PATH,
    counts: {
      families: families.length,
      products: families.reduce((sum, family) => sum + family.products.length, 0),
    },
    families: families.map((family) => ({
      id: family.id,
      names: [...family.names],
      products: family.products.map(exportProduct),
    })),
  }
}

/** Stable, pretty-printed JSON for the public download. */
export function serializeIngredientCatalog(
  families: readonly CatalogFamilySpec[] = CATALOG_FAMILIES,
): string {
  return `${JSON.stringify(buildIngredientCatalogExport(families), null, 2)}\n`
}
