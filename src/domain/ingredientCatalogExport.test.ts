import { describe, expect, it } from 'vitest'
import { catalogFamilies } from './ingredientCatalog'
import {
  INGREDIENT_CATALOG_DOWNLOAD_PATH,
  buildIngredientCatalogExport,
  serializeIngredientCatalog,
} from './ingredientCatalogExport'

describe('public ingredient catalogue export', () => {
  it('uses exactly the families and products the application uses', () => {
    const families = catalogFamilies()
    const exported = buildIngredientCatalogExport()

    expect(exported.counts.families).toBe(families.length)
    expect(exported.counts.products).toBe(
      families.reduce((sum, family) => sum + family.products.length, 0),
    )
    expect(exported.families).toHaveLength(families.length)

    for (const [index, family] of families.entries()) {
      const entry = exported.families[index]!
      expect(entry.id).toBe(family.id)
      expect(entry.names).toEqual([...family.names])
      expect(entry.products.map((product) => product.id)).toEqual(
        family.products.map((product) => product.id),
      )
      for (const [productIndex, product] of family.products.entries()) {
        expect(entry.products[productIndex]).toEqual({
          id: product.id,
          label: product.label,
          category: product.category,
          forms: [...product.forms],
          ...(product.aliases ? { aliases: [...product.aliases] } : {}),
          ...(product.qualifiers ? { qualifiers: [...product.qualifiers] } : {}),
          ...(product.unitHints ? { unitHints: [...product.unitHints] } : {}),
          ...(product.default ? { default: true } : {}),
        })
      }
    }
  })

  it('marks the data as ODbL 1.0 and names the original OFF sources', () => {
    const exported = buildIngredientCatalogExport()

    expect(exported.license).toBe('ODbL-1.0')
    expect(exported.licenseUrl).toBe(
      'https://opendatacommons.org/licenses/odbl/1-0/',
    )
    expect(exported.attribution).toContain('Open Food Facts contributors')
    expect(exported.source.url).toBe('https://world.openfoodfacts.org')
    expect(exported.source.files.map((file) => file.name)).toEqual([
      'ingredients.txt',
      'ingredients_processing.txt',
    ])
    expect(exported.source.files[0]?.url).toContain(
      '/taxonomies/food/ingredients.txt',
    )
    expect(exported.source.files[1]?.url).toContain(
      '/taxonomies/ingredients_processing.txt',
    )
    expect(exported.codeLicense).toBe('GPL-3.0-or-later')
    expect(exported.download).toBe(INGREDIENT_CATALOG_DOWNLOAD_PATH)
  })

  it('serializes to stable, parseable JSON without user data', () => {
    const json = serializeIngredientCatalog()
    const parsed = JSON.parse(json) as ReturnType<typeof buildIngredientCatalogExport>

    expect(json.endsWith('\n')).toBe(true)
    expect(parsed).toEqual(buildIngredientCatalogExport())
    expect(json).not.toMatch(/service_role|sb_secret_|SUPABASE_/)
    expect(json).not.toMatch(/einkaufsliste|recipe|rezept/i)
  })
})
