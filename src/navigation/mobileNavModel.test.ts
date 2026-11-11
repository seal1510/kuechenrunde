import { describe, expect, it } from 'vitest'
import { parseRoute, type Route } from '../routing/routes'
import {
  MOBILE_NAV_ITEMS,
  mobileAreaForRoute,
  mobileRouteKey,
  moreMenuLinks,
} from './mobileNavModel'

const areas: Array<[Route, string]> = [
  [{ name: 'library' }, 'recipes'],
  [{ name: 'recipe', id: 'r1' }, 'recipes'],
  [{ name: 'recipe-new' }, 'recipes'],
  [{ name: 'recipe-edit', id: 'r1' }, 'recipes'],
  [{ name: 'cook', recipeId: 'r1', cookSessionId: null }, 'recipes'],
  [{ name: 'plan' }, 'plan'],
  [{ name: 'shopping' }, 'shopping'],
  [{ name: 'import' }, 'more'],
  [{ name: 'import-url' }, 'more'],
  [{ name: 'backup' }, 'more'],
  [{ name: 'family' }, 'more'],
  [{ name: 'about' }, 'more'],
]

describe('mobile navigation areas', () => {
  it('maps every existing route to exactly one bottom-nav area', () => {
    for (const [route, area] of areas) {
      expect(mobileAreaForRoute(route)).toBe(area)
    }
  })

  it('keeps recipe detail, editor and cook mode in the recipe area', () => {
    expect(mobileAreaForRoute({ name: 'recipe', id: 'r1' })).toBe('recipes')
    expect(mobileAreaForRoute({ name: 'recipe-new' })).toBe('recipes')
    expect(mobileAreaForRoute({ name: 'recipe-edit', id: 'r1' })).toBe('recipes')
    expect(
      mobileAreaForRoute({ name: 'cook', recipeId: 'r1', cookSessionId: 'c1' }),
    ).toBe('recipes')
  })

  it('offers the four requested destinations', () => {
    expect(MOBILE_NAV_ITEMS.map((item) => item.label)).toEqual([
      'Rezepte',
      'Wochenplan',
      'Einkauf',
      'Mehr',
    ])
    expect(MOBILE_NAV_ITEMS.map((item) => item.href)).toEqual([
      '#/',
      '#/plan',
      '#/shopping',
      null,
    ])
  })

  it('produces distinct route keys for recipe sub-pages', () => {
    expect(mobileRouteKey({ name: 'library' })).toBe('library')
    expect(mobileRouteKey({ name: 'recipe', id: 'r1' })).not.toBe(
      mobileRouteKey({ name: 'recipe', id: 'r2' }),
    )
    expect(
      mobileRouteKey({ name: 'cook', recipeId: 'r1', cookSessionId: null }),
    ).not.toBe(
      mobileRouteKey({ name: 'cook', recipeId: 'r1', cookSessionId: 'c1' }),
    )
  })
})

describe('mobile More menu', () => {
  it('contains the secondary routes in the requested order', () => {
    expect(moreMenuLinks(true).map((link) => link.label)).toEqual([
      'URL-Rezeptimport',
      'Mela-Import',
      'Backup',
      'Familie verwalten',
      'Über Küchenrunde',
    ])
  })

  it('omits the cloud-only family page in local mode', () => {
    const labels = moreMenuLinks(false).map((link) => link.label)
    expect(labels).not.toContain('Familie verwalten')
    expect(labels).toContain('Über Küchenrunde')
  })

  it('links every menu entry to an existing parsed route', () => {
    expect(moreMenuLinks(true).map((link) => parseRoute(link.href).name)).toEqual([
      'import-url',
      'import',
      'backup',
      'family',
      'about',
    ])
  })
})
