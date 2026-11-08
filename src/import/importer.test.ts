import { readFileSync } from 'node:fs'
import { strToU8 } from 'fflate'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../db'
import { inspectMelaFile } from './mela'
import { deleteAllData, deleteRecipe, existingImportIds, importMelaRecipes } from './importer'
import type { ParsedMelaRecipe } from '../types'

const fixtureText = readFileSync(
  new URL('../../tests/fixtures/sample.melarecipe.json', import.meta.url),
  'utf8',
)

function fixtureBuffer(): ArrayBuffer {
  const data = strToU8(fixtureText)
  return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer
}

async function parsedFixture(): Promise<ParsedMelaRecipe> {
  const inspection = await inspectMelaFile(fixtureBuffer(), 'sample.melarecipe')
  expect(inspection.issues).toEqual([])
  return inspection.recipes[0]!
}

beforeEach(async () => {
  await deleteAllData()
})

afterAll(async () => {
  await deleteAllData()
  db.close()
})

describe('database import', () => {
  it('imports a recipe with all images', async () => {
    const parsed = await parsedFixture()
    const result = await importMelaRecipes([parsed])

    expect(result.imported).toBe(1)
    expect(result.duplicates).toBe(0)
    expect(result.images).toBe(2)
    expect(await db.recipes.count()).toBe(1)
    expect(await db.images.count()).toBe(2)

    const stored = await db.recipes.where('importId').equals(parsed.importId).first()
    expect(stored?.title).toBe('Kartoffelsuppe')
    expect(stored?.raw.customField).toEqual({ keep: true })
    expect(stored?.ingredientGroups).toHaveLength(2)
    const images = await db.images.where('recipeId').equals(stored!.id).toArray()
    expect(images.map((image) => image.position).sort()).toEqual([0, 1])
    expect(new Uint8Array(images[0]!.bytes).length).toBeGreaterThan(0)
  })

  it('does not create duplicates when the same file is imported twice', async () => {
    const parsed = await parsedFixture()
    const first = await importMelaRecipes([parsed])
    const second = await importMelaRecipes([parsed])

    expect(first.imported).toBe(1)
    expect(second.imported).toBe(0)
    expect(second.duplicates).toBe(1)
    expect(await db.recipes.count()).toBe(1)
    expect(await db.images.count()).toBe(2)
    expect(await existingImportIds([parsed.importId])).toEqual(new Set([parsed.importId]))
  })

  it('deduplicates repeated ids inside one batch', async () => {
    const parsed = await parsedFixture()
    const result = await importMelaRecipes([parsed, { ...parsed }])
    expect(result.imported).toBe(1)
    expect(result.duplicates).toBe(1)
    expect(await db.recipes.count()).toBe(1)
  })

  it('does not overwrite manual edits when the same Mela file is imported again', async () => {
    const parsed = await parsedFixture()
    await importMelaRecipes([parsed])
    const stored = await db.recipes.toCollection().first()
    await db.recipes.put({
      ...stored!,
      title: 'Manuell bearbeitet',
      cuisine: ['Indisch'],
      tags: ['meins'],
      updatedAt: 99,
    })

    const second = await importMelaRecipes([parsed])
    expect(second.imported).toBe(0)
    expect(second.duplicates).toBe(1)

    const after = await db.recipes.get(stored!.id)
    expect(after?.title).toBe('Manuell bearbeitet')
    expect(after?.cuisine).toEqual(['Indisch'])
    expect(after?.tags).toEqual(['meins'])
    expect(after?.importId).toBe(parsed.importId)
    expect(after?.raw).toEqual(stored?.raw)
  })

  it('deletes one recipe and its images', async () => {
    const parsed = await parsedFixture()
    await importMelaRecipes([parsed])
    const stored = await db.recipes.toCollection().first()
    await deleteRecipe(stored!.id)
    expect(await db.recipes.count()).toBe(0)
    expect(await db.images.count()).toBe(0)
  })

  it('deletes all local test data', async () => {
    const parsed = await parsedFixture()
    await importMelaRecipes([parsed])
    await deleteAllData()
    expect(await db.recipes.count()).toBe(0)
    expect(await db.images.count()).toBe(0)
  })
})
