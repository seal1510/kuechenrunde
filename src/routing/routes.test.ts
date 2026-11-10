import { describe, expect, it } from 'vitest'
import { cookHash, normalizeHash, parseRoute, URL_IMPORT_HASH } from './routes'

describe('hash normalisation', () => {
  it('accepts embedded and leading hash variants', () => {
    expect(normalizeHash('#/import/url')).toBe('import/url')
    expect(normalizeHash('#import/url')).toBe('import/url')
    expect(normalizeHash('/import/url')).toBe('import/url')
    expect(normalizeHash('  #/import/url/  ')).toBe('import/url')
    expect(normalizeHash('#/')).toBe('')
    expect(normalizeHash('')).toBe('')
  })
})

describe('route resolution', () => {
  it('maps every main route', () => {
    expect(parseRoute('')).toEqual({ name: 'library' })
    expect(parseRoute('#')).toEqual({ name: 'library' })
    expect(parseRoute('#/')).toEqual({ name: 'library' })
    expect(parseRoute('#/plan')).toEqual({ name: 'plan' })
    expect(parseRoute('#/shopping')).toEqual({ name: 'shopping' })
    expect(parseRoute('#/import')).toEqual({ name: 'import' })
    expect(parseRoute('#/import/url')).toEqual({ name: 'import-url' })
    expect(parseRoute('#/backup')).toEqual({ name: 'backup' })
    expect(parseRoute('#/about')).toEqual({ name: 'about' })
    expect(parseRoute('#/recipe/new')).toEqual({ name: 'recipe-new' })
    expect(parseRoute('#/recipe/r1')).toEqual({ name: 'recipe', id: 'r1' })
    expect(parseRoute('#/recipe/r1/edit')).toEqual({ name: 'recipe-edit', id: 'r1' })
    expect(parseRoute('#/recipe/r1/cook')).toEqual({
      name: 'cook',
      recipeId: 'r1',
      cookSessionId: null,
    })
    expect(parseRoute('#/recipe/r1/cook?session=cook-1')).toEqual({
      name: 'cook',
      recipeId: 'r1',
      cookSessionId: 'cook-1',
    })
  })

  it('does not let import swallow import/url or vice versa', () => {
    expect(parseRoute('#/import')).toEqual({ name: 'import' })
    expect(parseRoute('#/import/url')).toEqual({ name: 'import-url' })
    expect(parseRoute(URL_IMPORT_HASH)).toEqual({ name: 'import-url' })
  })

  it('normalises trailing slashes and leading hashes', () => {
    expect(parseRoute('#/import/url/')).toEqual({ name: 'import-url' })
    expect(parseRoute('import/url')).toEqual({ name: 'import-url' })
    expect(parseRoute('#/import/')).toEqual({ name: 'import' })
    expect(parseRoute('#/plan/')).toEqual({ name: 'plan' })
    expect(parseRoute('#/backup/')).toEqual({ name: 'backup' })
    expect(parseRoute('#/about/')).toEqual({ name: 'about' })
    expect(parseRoute('#/recipe/r1/cook/')).toEqual({
      name: 'cook',
      recipeId: 'r1',
      cookSessionId: null,
    })
    expect(parseRoute('#/recipe/r1/cook/?session=cook-1')).toEqual({
      name: 'cook',
      recipeId: 'r1',
      cookSessionId: 'cook-1',
    })
  })

  it('builds cook links that parse back to the same cook route', () => {
    expect(cookHash('r1')).toBe('#/recipe/r1/cook')
    expect(parseRoute(cookHash('r1'))).toEqual({
      name: 'cook',
      recipeId: 'r1',
      cookSessionId: null,
    })

    expect(cookHash('a b', 's 1')).toBe('#/recipe/a%20b/cook?session=s%201')
    expect(parseRoute(cookHash('a b', 's 1'))).toEqual({
      name: 'cook',
      recipeId: 'a b',
      cookSessionId: 's 1',
    })

    expect(cookHash('r1', null)).toBe('#/recipe/r1/cook')
    expect(cookHash('r1', '  ')).toBe('#/recipe/r1/cook')
  })

  it('falls back to the library for unknown routes', () => {
    expect(parseRoute('#/unbekannt')).toEqual({ name: 'library' })
    expect(parseRoute('#/import/unbekannt')).toEqual({ name: 'library' })
    expect(parseRoute('#/recipe')).toEqual({ name: 'library' })
    expect(parseRoute('#/recipe/')).toEqual({ name: 'library' })
  })

  it('decodes recipe ids safely and never throws on malformed escapes', () => {
    expect(parseRoute('#/recipe/a%20b')).toEqual({ name: 'recipe', id: 'a b' })
    expect(parseRoute('#/recipe/a%20b/edit')).toEqual({ name: 'recipe-edit', id: 'a b' })
    expect(parseRoute('#/recipe/a%20b/cook?session=s%201')).toEqual({
      name: 'cook',
      recipeId: 'a b',
      cookSessionId: 's 1',
    })
    expect(parseRoute('#/recipe/%E0%A4%A')).toEqual({ name: 'recipe', id: '%E0%A4%A' })
  })
})
