import { describe, expect, it } from 'vitest'
import type { Recipe } from '../types'
import { sortRecipes } from './library'

function recipe(overrides: Partial<Recipe>): Recipe {
  return {
    id: 'r',
    importId: 'mela-r',
    importSource: 'mela',
    title: 'Rezept',
    description: '',
    ingredientGroups: [],
    ingredients: [],
    instructions: [],
    servingsText: '',
    servingsNumber: null,
    prepTime: '',
    cookTime: '',
    totalTime: '',
    categories: [],
    cuisine: [],
    dishType: [],
    effort: '',
    tags: [],
    notes: '',
    nutrition: '',
    sourceUrl: '',
    favorite: false,
    wantToCook: false,
    melaDate: null,
    raw: {},
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }
}

describe('library sorting', () => {
  const recipes = [
    recipe({ id: 'b', title: 'Braten', totalTime: '90', createdAt: 2, updatedAt: 5 }),
    recipe({ id: 'a', title: 'Apfelkuchen', totalTime: '45', createdAt: 3, updatedAt: 1 }),
    recipe({ id: 'c', title: 'Curry', totalTime: '25', createdAt: 1, updatedAt: 3 }),
    recipe({ id: 'u', title: 'Unbekannt', totalTime: 'über Nacht', createdAt: 4, updatedAt: 4 }),
  ]

  it('defaults to alphabetical order', () => {
    expect(sortRecipes(recipes, 'az').map((entry) => entry.id)).toEqual(['a', 'b', 'c', 'u'])
  })

  it('sorts by creation and edit time descending', () => {
    expect(sortRecipes(recipes, 'created').map((entry) => entry.id)).toEqual(['u', 'a', 'b', 'c'])
    expect(sortRecipes(recipes, 'updated').map((entry) => entry.id)).toEqual(['b', 'u', 'c', 'a'])
  })

  it('sorts known durations first and unknown durations last', () => {
    expect(sortRecipes(recipes, 'duration').map((entry) => entry.id)).toEqual(['c', 'a', 'b', 'u'])
  })

  it('does not mutate the filtered input list', () => {
    const original = [...recipes]
    sortRecipes(recipes, 'duration')
    expect(recipes).toEqual(original)
  })
})
