import { readFileSync } from 'node:fs'
import { strToU8, zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import {
  inspectMelaFile,
  MELA_LIMITS,
  MelaParseError,
  parseMelaRecipe,
  stableStringify,
} from './mela'

const fixturePath = new URL('../../tests/fixtures/sample.melarecipe.json', import.meta.url)
const fixtureText = readFileSync(fixturePath, 'utf8')
const fixture = JSON.parse(fixtureText) as Record<string, unknown>

function toArrayBuffer(data: Uint8Array): ArrayBuffer {
  return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer
}

function fixtureBuffer(): ArrayBuffer {
  return toArrayBuffer(strToU8(fixtureText))
}

describe('Mela JSON import', () => {
  it('parses title, groups, ingredients, steps, categories and metadata', async () => {
    const inspection = await inspectMelaFile(fixtureBuffer(), 'sample.melarecipe')

    expect(inspection.issues).toEqual([])
    expect(inspection.recipes).toHaveLength(1)
    const recipe = inspection.recipes[0]!
    expect(recipe.title).toBe('Kartoffelsuppe')
    expect(recipe.importId).toBe('https://example.com/rezepte/kartoffelsuppe')
    expect(recipe.servingsText).toBe('4 Portionen')
    expect(recipe.servingsNumber).toBe(4)
    expect(recipe.categories).toEqual(['Suppe', 'Vegetarisch'])
    expect(recipe.favorite).toBe(true)
    expect(recipe.wantToCook).toBe(false)
    expect(recipe.melaDate).toBe(700000000)

    expect(recipe.ingredientGroups.map((group) => group.title)).toEqual(['Suppe', 'Topping'])
    expect(recipe.ingredients).toHaveLength(5)
    const potatoes = recipe.ingredients[0]!
    expect(potatoes.quantity).toBe(500)
    expect(potatoes.unit).toBe('g')
    expect(potatoes.name).toBe('Kartoffeln')
    expect(potatoes.parseStatus).toBe('parsed')

    const salt = recipe.ingredients[3]!
    expect(salt.parseStatus).toBe('plain')
    expect(salt.raw).toBe('Salz und Pfeffer')
    expect(salt.name).toBe('Salz und Pfeffer')
    expect(recipe.warnings.join(' ')).toContain('Zutatenzeile')

    expect(recipe.instructions.map((step) => step.text)).toEqual([
      '## Vorbereitung',
      'Kartoffeln schälen und würfeln.',
      '**Kochen**: Alles 30 Minuten köcheln lassen.',
      'Mit Petersilie servieren.',
    ])
  })

  it('stores multiple images as bytes and reports their count', async () => {
    const inspection = await inspectMelaFile(fixtureBuffer(), 'sample.melarecipe')
    const recipe = inspection.recipes[0]!
    expect(recipe.images).toHaveLength(2)
    expect(recipe.images[0]!.mimeType).toBe('image/png')
    expect(new Uint8Array(recipe.images[0]!.bytes).length).toBeGreaterThan(0)
    expect(new Uint8Array(recipe.images[1]!.bytes).length).toBeGreaterThan(0)
  })

  it('accepts a data-URI image as well as raw base64', async () => {
    const raw = fixture.images as string[]
    const recipe = await parseMelaRecipe({
      title: 'Data URI',
      images: [`data:image/png;base64,${raw[0]}`],
    })
    expect(recipe.images).toHaveLength(1)
    expect(recipe.images[0]!.mimeType).toBe('image/png')
  })

  it('preserves the original object and the original ingredient text', async () => {
    const inspection = await inspectMelaFile(fixtureBuffer(), 'sample.melarecipe')
    const recipe = inspection.recipes[0]!
    expect(recipe.raw.ingredients).toBe(fixture.ingredients)
    expect(recipe.raw.instructions).toBe(fixture.instructions)
    expect(recipe.raw.customField).toEqual({ keep: true })
    // Base64 payloads are not duplicated in the raw object.
    expect(Array.isArray(recipe.raw.images)).toBe(true)
    expect((recipe.raw.images as string[])[0]).toContain('Bildtabelle')
  })

  it('derives a stable id when Mela supplies none', async () => {
    const first = await parseMelaRecipe({ title: 'Ohne ID', ingredients: 'Salz' })
    const second = await parseMelaRecipe({ title: 'Ohne ID', ingredients: 'Salz' })
    expect(first.importId).toMatch(/^local-[a-f0-9]{64}$/)
    expect(first.importId).toBe(second.importId)
    expect(first.warnings.join(' ')).toContain('stabile ID')
  })

  it('rejects a recipe without a title', async () => {
    await expect(parseMelaRecipe({ ingredients: 'Salz' })).rejects.toBeInstanceOf(MelaParseError)
  })

  it('preserves HEIC image bytes and MIME type', async () => {
    const heic = Buffer.from([
      0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70,
      0x68, 0x65, 0x69, 0x63, 0x00, 0x00, 0x00, 0x00,
    ])
    const recipe = await parseMelaRecipe({
      title: 'HEIC-Foto',
      images: [heic.toString('base64')],
    })
    expect(recipe.images).toHaveLength(1)
    expect(recipe.images[0]?.mimeType).toBe('image/heic')
  })

  it('keeps unparseable image entries visible as warnings', async () => {
    const recipe = await parseMelaRecipe({
      title: 'Bildfehler',
      images: ['not-base64', 42],
    })
    expect(recipe.images).toHaveLength(0)
    expect(recipe.warnings.some((warning) => warning.includes('Bild 1'))).toBe(true)
    expect(recipe.warnings.some((warning) => warning.includes('Bild 2'))).toBe(true)
    expect(recipe.raw.images).toEqual([
      '[Bild 1: Bytes liegen in der Bildtabelle]',
      { index: 2, invalidImageValue: 42 },
    ])
  })
})

describe('Mela ZIP import', () => {
  it('reads a .melarecipes archive with multiple recipes', async () => {
    const second = { ...fixture, id: 'second-recipe', title: 'Zweites Rezept' }
    const zip = zipSync({
      'export/one.melarecipe': strToU8(JSON.stringify(fixture)),
      'export/two.melarecipe': strToU8(JSON.stringify(second)),
    })
    const inspection = await inspectMelaFile(toArrayBuffer(zip), 'export.melarecipes')
    expect(inspection.issues).toEqual([])
    expect(inspection.recipes.map((recipe) => recipe.title)).toEqual([
      'Kartoffelsuppe',
      'Zweites Rezept',
    ])
  })

  it('reads a ZIP64 .melarecipes archive (Mela export layout)', async () => {
    const data = readFileSync(new URL('../../tests/fixtures/zip64.melarecipes', import.meta.url))
    const inspection = await inspectMelaFile(toArrayBuffer(data), 'zip64.melarecipes')
    expect(inspection.issues).toEqual([])
    expect(inspection.recipes).toHaveLength(2)
    expect(inspection.recipes[0]?.title).toBe('Synthetisches ZIP64-Rezept')
    expect(inspection.recipes[0]?.categories).toEqual(['Test'])
    expect(inspection.recipes[0]?.servingsText).toBe('2 Portionen')
    expect(inspection.recipes[0]?.images).toHaveLength(1)
    expect(inspection.recipes[0]?.images[0]?.mimeType).toBe('image/png')
    expect(inspection.recipes[1]?.title).toBe('Zweites ZIP64-Rezept')
  })

  it('rejects a manipulated archive with a path traversal entry', async () => {
    const zip = zipSync({
      '../evil.melarecipe': strToU8(JSON.stringify(fixture)),
    })
    const inspection = await inspectMelaFile(toArrayBuffer(zip), 'evil.melarecipes')
    expect(inspection.recipes).toHaveLength(0)
    expect(inspection.issues[0]?.severity).toBe('error')
    expect(inspection.issues[0]?.message).toContain('Unsicherer Pfad')
  })

  it('rejects a corrupt ZIP even when it has ZIP magic bytes', async () => {
    const corrupt = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00, 0x00, 0x00])
    const inspection = await inspectMelaFile(toArrayBuffer(corrupt), 'corrupt.melarecipes')
    expect(inspection.recipes).toHaveLength(0)
    expect(inspection.issues[0]?.message).toContain('ZIP konnte nicht gelesen werden')
  })

  it('rejects an archive without .melarecipe entries', async () => {
    const zip = zipSync({ 'readme.txt': strToU8('hello') })
    const inspection = await inspectMelaFile(toArrayBuffer(zip), 'empty.melarecipes')
    expect(inspection.recipes).toHaveLength(0)
    expect(inspection.issues[0]?.message).toContain('keine .melarecipe-Datei')
  })
})

describe('validation limits', () => {
  it('rejects an empty file', async () => {
    const inspection = await inspectMelaFile(new ArrayBuffer(0), 'empty.melarecipe')
    expect(inspection.recipes).toHaveLength(0)
    expect(inspection.issues[0]?.message).toContain('leer')
  })

  it('rejects invalid JSON', async () => {
    const inspection = await inspectMelaFile(toArrayBuffer(strToU8('{invalid')), 'broken.melarecipe')
    expect(inspection.recipes).toHaveLength(0)
    expect(inspection.issues[0]?.message).toContain('Ungültiges JSON')
  })

  it('rejects a file above the size limit without parsing it', async () => {
    const fake = { byteLength: MELA_LIMITS.maxFileBytes + 1 } as ArrayBuffer
    const inspection = await inspectMelaFile(fake, 'huge.melarecipe')
    expect(inspection.recipes).toHaveLength(0)
    expect(inspection.issues[0]?.message).toContain('zu groß')
  })
})

describe('stableStringify', () => {
  it('sorts object keys recursively', () => {
    expect(stableStringify({ b: 1, a: { d: 2, c: 3 } })).toBe('{"a":{"c":3,"d":2},"b":1}')
  })
})
