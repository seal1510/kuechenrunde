import Dexie from 'dexie'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { OpenCookDatabase } from './db'
import type { MealPlanEntry } from './types'
import { shoppingItemKey } from './domain/shopping'
import { standardShoppingListId } from './domain/shoppingLists'

const NAME = 'opencook-migration-test'

const recipe = {
  id: 'r1',
  importId: 'mela-r1',
  importSource: 'mela' as const,
  title: 'Migrationstest',
  description: '',
  ingredientGroups: [],
  ingredients: [],
  instructions: [],
  servingsText: '2',
  servingsNumber: 2,
  prepTime: '',
  cookTime: '',
  totalTime: '',
  categories: ['Test'],
  notes: '',
  nutrition: '',
  sourceUrl: '',
  favorite: false,
  wantToCook: false,
  melaDate: null,
  raw: {},
  createdAt: 1,
  updatedAt: 1,
}

beforeEach(async () => {
  await Dexie.delete(NAME)
})

afterAll(async () => {
  await Dexie.delete(NAME)
})

describe('Dexie migrations', () => {
  it('keeps recipes and images and adds planner data', async () => {
    const legacy = new Dexie(NAME)
    legacy.version(1).stores({
      recipes: 'id, &importId, title, updatedAt, *categories, favorite, wantToCook',
      images: 'id, recipeId, [recipeId+position]',
    })
    await legacy.open()
    await legacy.table('recipes').add(recipe)
    await legacy.table('images').add({
      id: 'img1',
      recipeId: 'r1',
      position: 0,
      mimeType: 'image/png',
      bytes: new Uint8Array([1, 2, 3]).buffer,
    })
    legacy.close()

    const upgraded = new OpenCookDatabase(NAME)
    await upgraded.open()
    expect(upgraded.verno).toBe(16)
    expect(await upgraded.recipes.count()).toBe(1)
    const upgradedRecipe = await upgraded.recipes.get('r1')
    expect(upgradedRecipe?.title).toBe('Migrationstest')
    expect(upgradedRecipe?.cuisine).toEqual([])
    expect(upgradedRecipe?.dishType).toEqual([])
    expect(upgradedRecipe?.effort).toBe('')
    expect(upgradedRecipe?.tags).toEqual([])
    expect(upgradedRecipe?.categories).toEqual(['Test'])
    expect(await upgraded.images.count()).toBe(1)
    expect(new Uint8Array((await upgraded.images.get('img1'))!.bytes)).toEqual(
      new Uint8Array([1, 2, 3]),
    )

    const entry: MealPlanEntry = {
      id: 'plan-2026-05-25-dinner',
      date: '2026-05-25',
      slot: 'dinner',
      recipeId: 'r1',
      auto: true,
      pinned: false,
      leftover: false,
      cooked: false,
      reasons: [{ code: 'LIKED', weight: 2 }],
      createdAt: 2,
      updatedAt: 2,
    }
    await upgraded.mealPlans.put(entry)
    await upgraded.mealDays.put({ date: '2026-05-25', skipped: false, createdAt: 2, updatedAt: 2 })
    await upgraded.settings.put({ key: 'householdSize', value: 2 })
    upgraded.close()

    const reopened = new OpenCookDatabase(NAME)
    await reopened.open()
    expect(await reopened.recipes.count()).toBe(1)
    expect(await reopened.images.count()).toBe(1)
    expect(await reopened.mealPlans.get(entry.id)).toEqual(entry)
    expect(await reopened.mealDays.get('2026-05-25')).toBeTruthy()
    expect((await reopened.settings.get('householdSize'))?.value).toBe(2)
    reopened.close()
  })

  it('migrates a v2 database to v4 without losing plans or settings', async () => {
    const name = `${NAME}-v2`
    await Dexie.delete(name)
    const legacy = new Dexie(name)
    legacy.version(1).stores({
      recipes: 'id, &importId, title, updatedAt, *categories, favorite, wantToCook',
      images: 'id, recipeId, [recipeId+position]',
    })
    legacy.version(2).stores({
      recipes: 'id, &importId, title, updatedAt, *categories, favorite, wantToCook',
      images: 'id, recipeId, [recipeId+position]',
      mealPlans: 'id, date, &[date+slot], recipeId, pinned, cooked',
      mealDays: 'date',
      settings: 'key',
    })
    await legacy.open()
    await legacy.table('recipes').add(recipe)
    await legacy.table('mealPlans').add({
      id: 'plan-v2',
      date: '2026-05-25',
      slot: 'dinner',
      recipeId: 'r1',
      auto: true,
      pinned: true,
      leftover: false,
      cooked: false,
      reasons: [],
      createdAt: 1,
      updatedAt: 1,
    })
    await legacy.table('settings').add({ key: 'householdSize', value: 3 })
    legacy.close()

    const upgraded = new OpenCookDatabase(name)
    await upgraded.open()
    expect(upgraded.verno).toBe(16)
    const migrated = await upgraded.recipes.get('r1')
    expect(migrated?.cuisine).toEqual([])
    expect(migrated?.dishType).toEqual([])
    expect(migrated?.effort).toBe('')
    expect(migrated?.tags).toEqual([])
    expect(migrated?.categories).toEqual(['Test'])
    expect((await upgraded.mealPlans.get('plan-v2'))?.pinned).toBe(true)
    expect((await upgraded.settings.get('householdSize'))?.value).toBe(3)
    upgraded.close()
    await Dexie.delete(name)
  })

  it('backfills ingredient note fields on a v3 database without touching raw lines', async () => {
    const name = `${NAME}-v3`
    await Dexie.delete(name)
    const legacy = new Dexie(name)
    legacy.version(3).stores({
      recipes:
        'id, &importId, title, updatedAt, *categories, *cuisine, *dishType, effort, *tags, favorite, wantToCook',
      images: 'id, recipeId, [recipeId+position]',
      mealPlans: 'id, date, &[date+slot], recipeId, pinned, cooked',
      mealDays: 'date',
      settings: 'key',
    })
    await legacy.open()
    await legacy.table('recipes').add({
      ...recipe,
      cuisine: [],
      dishType: [],
      effort: '',
      tags: [],
      ingredients: [
        {
          id: 'i1',
          groupId: null,
          position: 0,
          raw: '2 Zwiebeln (fein gewürfelt)',
          name: 'Zwiebeln (fein gewürfelt)',
          quantity: 2,
          quantityText: '2',
          unit: null,
          parseStatus: 'parsed',
          links: [],
        },
      ],
    })
    legacy.close()

    const upgraded = new OpenCookDatabase(name)
    await upgraded.open()
    expect(upgraded.verno).toBe(16)
    const migrated = await upgraded.recipes.get('r1')
    const ingredient = migrated?.ingredients[0]
    expect(ingredient?.purchaseNote).toBe('')
    expect(ingredient?.preparationNote).toBe('')
    expect(ingredient?.raw).toBe('2 Zwiebeln (fein gewürfelt)')
    expect(ingredient?.name).toBe('Zwiebeln (fein gewürfelt)')
    expect(ingredient?.quantity).toBe(2)
    expect(migrated?.raw).toEqual({})
    upgraded.close()
    await Dexie.delete(name)
  })

  it('re-parses only clearly recognisable plain imported ingredients on v4 → v5', async () => {
    const name = `${NAME}-v4`
    await Dexie.delete(name)
    const legacy = new Dexie(name)
    legacy.version(4).stores({
      recipes:
        'id, &importId, title, updatedAt, *categories, *cuisine, *dishType, effort, *tags, favorite, wantToCook',
      images: 'id, recipeId, [recipeId+position]',
      mealPlans: 'id, date, &[date+slot], recipeId, pinned, cooked',
      mealDays: 'date',
      settings: 'key',
    })
    await legacy.open()
    const plain = (
      id: string,
      position: number,
      raw: string,
      overrides: Record<string, unknown> = {},
    ) => ({
      id,
      groupId: null,
      position,
      raw,
      name: raw,
      quantity: null,
      quantityText: null,
      unit: null,
      purchaseNote: '',
      preparationNote: '',
      parseStatus: 'plain',
      links: [],
      ...overrides,
    })
    await legacy.table('recipes').add({
      ...recipe,
      cuisine: [],
      dishType: [],
      effort: '',
      tags: [],
      updatedAt: 42,
      raw: { original: true },
      ingredients: [
        plain('i1', 0, 'ca. 200 ml Rotwein (trocken, z. B. Dornfelder)'),
        plain('i2', 1, 'halbe Tasse Wasser'),
        plain('i3', 2, 'Salz und Pfeffer'),
        plain('i4', 3, '2 Zwiebeln', { purchaseNote: 'bio' }),
        plain('i5', 4, '2 Zwiebeln', { name: 'Zwiebeln (manuell)' }),
        {
          id: 'i6',
          groupId: null,
          position: 5,
          raw: '100 g Mehl',
          name: 'Mehl (manuell)',
          quantity: 100,
          quantityText: '100',
          unit: 'g',
          purchaseNote: '',
          preparationNote: '',
          parseStatus: 'parsed',
          links: [],
        },
      ],
    })
    legacy.close()

    const upgraded = new OpenCookDatabase(name)
    await upgraded.open()
    expect(upgraded.verno).toBe(16)
    const migrated = await upgraded.recipes.get('r1')
    const byId = new Map((migrated?.ingredients ?? []).map((entry) => [entry.id, entry]))

    expect(byId.get('i1')).toMatchObject({
      raw: 'ca. 200 ml Rotwein (trocken, z. B. Dornfelder)',
      name: 'Rotwein (trocken, z. B. Dornfelder)',
      quantity: 200,
      quantityText: 'ca. 200',
      unit: 'ml',
      parseStatus: 'parsed',
    })
    expect(byId.get('i2')).toMatchObject({
      name: 'Wasser',
      quantity: 0.5,
      quantityText: '½',
      unit: 'Tasse',
      parseStatus: 'parsed',
    })
    expect(byId.get('i3')).toMatchObject({
      raw: 'Salz und Pfeffer',
      name: 'Salz und Pfeffer',
      quantity: null,
      parseStatus: 'plain',
    })
    expect(byId.get('i4')).toMatchObject({
      name: '2 Zwiebeln',
      quantity: null,
      purchaseNote: 'bio',
      parseStatus: 'plain',
    })
    expect(byId.get('i5')).toMatchObject({
      name: 'Zwiebeln (manuell)',
      quantity: null,
      parseStatus: 'plain',
    })
    expect(byId.get('i6')).toMatchObject({
      name: 'Mehl (manuell)',
      quantity: 100,
      parseStatus: 'parsed',
    })
    expect(migrated?.raw).toEqual({ original: true })
    expect(migrated?.updatedAt).toBe(42)
    upgraded.close()
    await Dexie.delete(name)
  })

  it('adds the importUrl index on v5 and keeps URL import metadata', async () => {
    const name = `${NAME}-v5`
    await Dexie.delete(name)
    const legacy = new Dexie(name)
    legacy.version(5).stores({
      recipes:
        'id, &importId, title, updatedAt, *categories, *cuisine, *dishType, effort, *tags, favorite, wantToCook',
      images: 'id, recipeId, [recipeId+position]',
      mealPlans: 'id, date, &[date+slot], recipeId, pinned, cooked',
      mealDays: 'date',
      settings: 'key',
    })
    await legacy.open()
    await legacy.table('recipes').add({
      ...recipe,
      cuisine: [],
      dishType: [],
      effort: '',
      tags: [],
      updatedAt: 77,
    })
    legacy.close()

    const upgraded = new OpenCookDatabase(name)
    await upgraded.open()
    expect(upgraded.verno).toBe(16)
    const migrated = await upgraded.recipes.get('r1')
    expect(migrated?.title).toBe('Migrationstest')
    expect(migrated?.importUrl).toBe('')
    expect(migrated?.updatedAt).toBe(77)
    expect(migrated?.raw).toEqual({})

    const importMeta = {
      source: 'url' as const,
      originalUrl: 'https://example.com/rezept',
      finalUrl: 'https://example.com/rezept',
      candidateKey: 'title:test',
      fetchedAt: 123,
      imageSourceUrls: [],
      imageWarnings: [],
    }
    await upgraded.recipes.put({
      ...migrated!,
      id: 'r2',
      importId: 'url-r2',
      importSource: 'url',
      importUrl: 'https://example.com/rezept',
      importMeta,
      ingredients: [],
      instructions: [],
      ingredientGroups: [],
      title: 'URL-Rezept',
    })
    const found = await upgraded.recipes
      .where('importUrl')
      .equals('https://example.com/rezept')
      .toArray()
    expect(found.map((entry) => entry.id)).toEqual(['r2'])
    expect(found[0]?.importMeta).toEqual(importMeta)
    expect(found[0]?.importSource).toBe('url')
    upgraded.close()
    await Dexie.delete(name)
  })

  it('splits v6 plans into cooking events and meal appointments without inventing leftover origins', async () => {
    const name = `${NAME}-v6`
    await Dexie.delete(name)
    const legacy = new Dexie(name)
    legacy.version(6).stores({
      recipes:
        'id, &importId, title, updatedAt, *categories, *cuisine, *dishType, effort, *tags, favorite, wantToCook, importUrl',
      images: 'id, recipeId, [recipeId+position]',
      mealPlans: 'id, date, &[date+slot], recipeId, pinned, cooked',
      mealDays: 'date',
      settings: 'key',
    })
    await legacy.open()
    await legacy.table('recipes').add({ ...recipe, cuisine: [], dishType: [], effort: '', tags: [] })
    await legacy.table('settings').add({ key: 'householdSize', value: 3 })
    await legacy.table('mealPlans').bulkAdd([
      {
        id: 'plan-normal',
        date: '2026-05-25',
        slot: 'dinner',
        recipeId: 'r1',
        auto: true,
        pinned: true,
        leftover: false,
        cooked: true,
        reasons: [{ code: 'LIKED', weight: 2 }],
        createdAt: 1,
        updatedAt: 2,
      },
      {
        id: 'plan-leftover',
        date: '2026-05-26',
        slot: 'dinner',
        recipeId: 'r1',
        auto: true,
        pinned: false,
        leftover: true,
        cooked: false,
        reasons: [{ code: 'BIG_BATCH_LEFTOVER', weight: 0 }],
        createdAt: 1,
        updatedAt: 1,
      },
    ])
    legacy.close()

    const upgraded = new OpenCookDatabase(name)
    await upgraded.open()
    expect(upgraded.verno).toBe(16)
    expect(await upgraded.recipes.count()).toBe(1)
    const normal = (await upgraded.mealPlans.get('plan-normal'))!
    expect(normal.pinned).toBe(true)
    expect(normal.servings).toBe(3)
    expect(normal.status).toBe('eaten')
    expect(normal.reasons).toEqual([{ code: 'LIKED', weight: 2 }])
    expect(normal.cookSessionId).toBe('cook-migrated-plan-normal')
    const session = (await upgraded.cookSessions.get(normal.cookSessionId!))!
    expect(session.status).toBe('cooked')
    expect(session.servings).toBe(3)
    expect(session.recipeId).toBe('r1')

    const leftover = (await upgraded.mealPlans.get('plan-leftover'))!
    expect(leftover.leftover).toBe(true)
    expect(leftover.cookSessionId).toBeNull()
    expect(leftover.status).toBe('planned')
    expect(leftover.reasons).toEqual([{ code: 'BIG_BATCH_LEFTOVER', weight: 0 }])
    expect(await upgraded.cookSessions.count()).toBe(1)

    // The old unique [date+slot] index is gone: several dishes can share a slot.
    await upgraded.mealPlans.bulkAdd([
      {
        id: 'plan-extra-a',
        date: '2026-05-27',
        slot: 'dinner',
        recipeId: 'r1',
        servings: 2,
        position: 0,
        cookSessionId: null,
        status: 'planned',
        auto: false,
        pinned: false,
        leftover: false,
        cooked: false,
        reasons: [],
        createdAt: 3,
        updatedAt: 3,
      },
      {
        id: 'plan-extra-b',
        date: '2026-05-27',
        slot: 'dinner',
        recipeId: 'r1',
        servings: 1,
        position: 1,
        cookSessionId: null,
        status: 'planned',
        auto: false,
        pinned: false,
        leftover: false,
        cooked: false,
        reasons: [],
        createdAt: 4,
        updatedAt: 4,
      },
    ])
    expect(await upgraded.mealPlans.where('[date+slot]').equals(['2026-05-27', 'dinner']).count()).toBe(2)
    upgraded.close()
    await Dexie.delete(name)
  })

  it('adds day notes on v7 → v8 without changing recipes, plans or settings', async () => {
    const name = `${NAME}-v7`
    await Dexie.delete(name)
    const legacy = new Dexie(name)
    legacy.version(7).stores({
      recipes:
        'id, &importId, title, updatedAt, *categories, *cuisine, *dishType, effort, *tags, favorite, wantToCook, importUrl',
      images: 'id, recipeId, [recipeId+position]',
      mealPlans: 'id, date, [date+slot], recipeId, pinned, cooked, cookSessionId, status',
      mealDays: 'date',
      settings: 'key',
      cookSessions: 'id, recipeId, date, status, [recipeId+date]',
    })
    await legacy.open()
    await legacy.table('recipes').add({
      ...recipe,
      cuisine: [],
      dishType: [],
      effort: '',
      tags: [],
    })
    await legacy.table('settings').add({ key: 'householdSize', value: 3 })
    await legacy.table('cookSessions').add({
      id: 'cook-v7',
      recipeId: 'r1',
      date: '2026-05-25',
      servings: 4,
      status: 'planned',
      auto: false,
      createdAt: 1,
      updatedAt: 1,
    })
    await legacy.table('mealPlans').add({
      id: 'plan-v7',
      date: '2026-05-25',
      slot: 'dinner',
      recipeId: 'r1',
      servings: 2,
      position: 0,
      cookSessionId: 'cook-v7',
      status: 'planned',
      auto: false,
      pinned: false,
      leftover: false,
      cooked: false,
      reasons: [],
      createdAt: 1,
      updatedAt: 1,
    })
    legacy.close()

    const upgraded = new OpenCookDatabase(name)
    await upgraded.open()
    expect(upgraded.verno).toBe(16)
    expect(await upgraded.recipes.count()).toBe(1)
    expect(await upgraded.cookSessions.count()).toBe(1)
    expect((await upgraded.mealPlans.get('plan-v7'))?.cookSessionId).toBe('cook-v7')
    expect((await upgraded.settings.get('householdSize'))?.value).toBe(3)
    expect(await upgraded.dayNotes.count()).toBe(0)

    await upgraded.dayNotes.put({
      date: '2026-05-25',
      text: 'Essen gehen',
      createdAt: 10,
      updatedAt: 10,
    })
    upgraded.close()

    const reopened = new OpenCookDatabase(name)
    await reopened.open()
    expect((await reopened.dayNotes.get('2026-05-25'))?.text).toBe('Essen gehen')
    expect((await reopened.mealPlans.get('plan-v7'))?.cookSessionId).toBe('cook-v7')
    reopened.close()
    await Dexie.delete(name)
  })

  it('adds the free-dish table on v8 → v9 without changing recipe plans', async () => {
    const name = `${NAME}-v8`
    await Dexie.delete(name)
    const legacy = new Dexie(name)
    legacy.version(8).stores({
      recipes:
        'id, &importId, title, updatedAt, *categories, *cuisine, *dishType, effort, *tags, favorite, wantToCook, importUrl',
      images: 'id, recipeId, [recipeId+position]',
      mealPlans: 'id, date, [date+slot], recipeId, pinned, cooked, cookSessionId, status',
      mealDays: 'date',
      settings: 'key',
      cookSessions: 'id, recipeId, date, status, [recipeId+date]',
      dayNotes: 'date, updatedAt',
    })
    await legacy.open()
    await legacy.table('recipes').add({
      ...recipe,
      cuisine: [],
      dishType: [],
      effort: '',
      tags: [],
    })
    await legacy.table('cookSessions').add({
      id: 'cook-v8',
      recipeId: 'r1',
      date: '2026-05-28',
      servings: 4,
      status: 'planned',
      auto: false,
      createdAt: 1,
      updatedAt: 1,
    })
    await legacy.table('mealPlans').add({
      id: 'plan-v8',
      date: '2026-05-28',
      slot: 'dinner',
      recipeId: 'r1',
      servings: 2,
      position: 0,
      cookSessionId: 'cook-v8',
      status: 'planned',
      auto: false,
      pinned: false,
      leftover: false,
      cooked: false,
      reasons: [],
      createdAt: 1,
      updatedAt: 1,
    })
    legacy.close()

    const upgraded = new OpenCookDatabase(name)
    await upgraded.open()
    expect(upgraded.verno).toBe(16)
    expect(await upgraded.recipes.count()).toBe(1)
    expect(await upgraded.cookSessions.count()).toBe(1)
    expect((await upgraded.mealPlans.get('plan-v8'))?.recipeId).toBe('r1')
    expect((await upgraded.cookSessions.get('cook-v8'))?.recipeId).toBe('r1')
    expect(await upgraded.freeDishes.count()).toBe(0)

    await upgraded.freeDishes.put({
      id: 'free-v9',
      name: 'Brotzeit',
      referenceServings: 2,
      ingredients: [
        {
          id: 'free-ing-1',
          groupId: null,
          position: 0,
          raw: '1 Brot',
          name: 'Brot',
          quantity: 1,
          quantityText: '1',
          unit: 'Brot',
          purchaseNote: 'beim Bäcker',
          preparationNote: '',
          parseStatus: 'parsed',
          links: [],
        },
      ],
      createdAt: 2,
      updatedAt: 2,
    })
    upgraded.close()

    const reopened = new OpenCookDatabase(name)
    await reopened.open()
    expect((await reopened.freeDishes.get('free-v9'))?.referenceServings).toBe(2)
    expect((await reopened.freeDishes.get('free-v9'))?.ingredients[0]?.purchaseNote).toBe(
      'beim Bäcker',
    )
    expect((await reopened.mealPlans.get('plan-v8'))?.cookSessionId).toBe('cook-v8')
    expect((await reopened.recipes.get('r1'))?.title).toBe('Migrationstest')
    reopened.close()
    await Dexie.delete(name)
  })
})

  it('adds the shopping tables on v9 → v12 without changing existing data', async () => {
    const name = `${NAME}-v9`
    await Dexie.delete(name)
    const legacy = new Dexie(name)
    legacy.version(9).stores({
      recipes:
        'id, &importId, title, updatedAt, *categories, *cuisine, *dishType, effort, *tags, favorite, wantToCook, importUrl',
      images: 'id, recipeId, [recipeId+position]',
      mealPlans:
        'id, date, [date+slot], recipeId, freeDishId, pinned, cooked, cookSessionId, status',
      mealDays: 'date',
      settings: 'key',
      cookSessions: 'id, recipeId, freeDishId, date, status, [recipeId+date]',
      dayNotes: 'date, updatedAt',
      freeDishes: 'id, updatedAt',
    })
    await legacy.open()
    await legacy.table('recipes').add({ ...recipe, cuisine: [], dishType: [], effort: '', tags: [] })
    await legacy.table('cookSessions').add({
      id: 'cook-v9',
      recipeId: 'r1',
      date: '2026-05-28',
      servings: 4,
      status: 'planned',
      auto: false,
      createdAt: 1,
      updatedAt: 1,
    })
    await legacy.table('mealPlans').add({
      id: 'plan-v9',
      date: '2026-05-28',
      slot: 'dinner',
      recipeId: 'r1',
      servings: 2,
      position: 0,
      cookSessionId: 'cook-v9',
      status: 'planned',
      auto: false,
      pinned: false,
      leftover: false,
      cooked: false,
      reasons: [],
      createdAt: 1,
      updatedAt: 1,
    })
    legacy.close()

    const upgraded = new OpenCookDatabase(name)
    await upgraded.open()
    expect(upgraded.verno).toBe(16)
    expect(await upgraded.shoppingManualItems.count()).toBe(0)
    expect(await upgraded.shoppingChecks.count()).toBe(0)
    expect(await upgraded.shoppingItemRules.count()).toBe(0)
        expect((await upgraded.recipes.get('r1'))?.title).toBe('Migrationstest')
    expect((await upgraded.mealPlans.get('plan-v9'))?.cookSessionId).toBe('cook-v9')
    expect((await upgraded.cookSessions.get('cook-v9'))?.servings).toBe(4)

    await upgraded.shoppingManualItems.put({
      id: 'manual-v10',
      shoppingDate: '2026-05-28',
      weekStart: '2026-05-28',
      name: 'Milch',
      quantityText: '1',
      unit: 'l',
      purchaseNote: '',
      categoryId: 'dairy',
      createdAt: 1,
      updatedAt: 1,
    })
    await upgraded.shoppingPurchases.put({
      id: 'purchase-v11',
      shoppingDate: '2026-05-28',
      itemKey: 'zwiebel',
      amounts: [{ dimension: 'count', lower: 2, upper: 2 }],
      snapshot: [],
      qualitative: false,
      createdAt: 1,
      updatedAt: 1,
    })
    await upgraded.shoppingItemRules.put({
      key: 'zwiebel',
      canonicalKey: 'zwiebel',
      displayName: 'Gemüsezwiebeln',
      categoryId: 'produce',
      purchaseNote: '',
      purchaseNoteOverride: false,
      hiddenPurchaseNotes: [],
      updatedAt: 1,
    })
    upgraded.close()

    const reopened = new OpenCookDatabase(name)
    await reopened.open()
    expect(await reopened.shoppingManualItems.count()).toBe(1)
    expect((await reopened.shoppingPurchases.get('purchase-v11'))?.amounts.length).toBe(1)
    expect((await reopened.shoppingItemRules.get('zwiebel'))?.displayName).toBe('Gemüsezwiebeln')
    expect((await reopened.mealPlans.get('plan-v9'))?.recipeId).toBe('r1')
    reopened.close()
    await Dexie.delete(name)
  })

  it('converts v10 checks into one historical purchase and dates existing rows', async () => {
    const name = `${NAME}-v10-shopping`
    await Dexie.delete(name)
    const legacy = new Dexie(name)
    legacy.version(10).stores({
      recipes:
        'id, &importId, title, updatedAt, *categories, *cuisine, *dishType, effort, *tags, favorite, wantToCook, importUrl',
      images: 'id, recipeId, [recipeId+position]',
      mealPlans:
        'id, date, [date+slot], recipeId, freeDishId, pinned, cooked, cookSessionId, status',
      mealDays: 'date',
      settings: 'key',
      cookSessions: 'id, recipeId, freeDishId, date, status, [recipeId+date]',
      dayNotes: 'date, updatedAt',
      freeDishes: 'id, updatedAt',
      shoppingManualItems: 'id, weekStart',
      shoppingChecks: 'id, weekStart, [weekStart+itemKey], itemKey',
      shoppingItemRules: 'key, updatedAt',
      pantryItems: 'id, itemKey, updatedAt',
    })
    await legacy.open()
    await legacy.table('shoppingManualItems').put({
      id: 'manual-old',
      weekStart: '2026-11-05',
      name: 'Milch',
      quantityText: '1',
      unit: 'l',
      purchaseNote: '',
      categoryId: 'dairy',
      createdAt: 1,
      updatedAt: 1,
    })
    await legacy.table('shoppingChecks').put({
      id: '2026-11-05|zwiebel',
      weekStart: '2026-11-05',
      itemKey: 'zwiebel',
      checked: true,
      purchased: [{ dimension: 'count', lower: 2, upper: 2 }],
      updatedAt: 5,
    })
    await legacy.table('shoppingItemRules').put({
      key: 'zwiebel',
      displayName: 'Zwiebeln',
      categoryId: 'produce',
      purchaseNote: 'bevorzugt rot',
      updatedAt: 1,
    })
    legacy.close()

    const upgraded = new OpenCookDatabase(name)
    await upgraded.open()
    expect(upgraded.verno).toBe(16)
    expect((await upgraded.shoppingManualItems.get('manual-old'))?.shoppingDate).toBe(
      '2026-11-05',
    )
    expect((await upgraded.shoppingItemRules.get('zwiebel'))?.canonicalKey).toBe('zwiebel')
    expect((await upgraded.shoppingItemRules.get('zwiebel'))?.hiddenPurchaseNotes).toEqual([])
    expect(await upgraded.shoppingChecks.count()).toBe(0)
    const purchase = await upgraded.shoppingPurchases.get('legacy-2026-11-05|zwiebel')
    expect(purchase?.amounts).toEqual([{ dimension: 'count', lower: 2, upper: 2 }])
    expect(purchase?.qualitative).toBe(false)
    expect(purchase?.shoppingDate).toBe('2026-11-05')
    upgraded.close()

    const reopened = new OpenCookDatabase(name)
    await reopened.open()
    expect(await reopened.shoppingPurchases.count()).toBe(1)
    expect((await reopened.shoppingManualItems.get('manual-old'))?.shoppingDate).toBe(
      '2026-11-05',
    )
    reopened.close()
    await Dexie.delete(name)
  })

describe('pantry removal migration', () => {
  it('drops the pantry table and its snapshots while keeping shopping data', async () => {
    const name = `${NAME}-v11-pantry`
    await Dexie.delete(name)
    const legacy = new Dexie(name)
    legacy.version(11).stores({
      recipes:
        'id, &importId, title, updatedAt, *categories, *cuisine, *dishType, effort, *tags, favorite, wantToCook, importUrl',
      images: 'id, recipeId, [recipeId+position]',
      mealPlans:
        'id, date, [date+slot], recipeId, freeDishId, pinned, cooked, cookSessionId, status',
      mealDays: 'date',
      settings: 'key',
      cookSessions: 'id, recipeId, freeDishId, date, status, [recipeId+date]',
      dayNotes: 'date, updatedAt',
      freeDishes: 'id, updatedAt',
      shoppingManualItems: 'id, shoppingDate, weekStart',
      shoppingChecks: 'id, weekStart, [weekStart+itemKey], itemKey',
      shoppingPurchases: 'id, shoppingDate, itemKey, createdAt, [itemKey+shoppingDate]',
      shoppingItemRules: 'key, updatedAt',
      pantryItems: 'id, itemKey, updatedAt',
    })
    await legacy.open()
    await legacy.table('shoppingManualItems').put({
      id: 'manual-keep',
      shoppingDate: '2026-11-05',
      name: 'Milch',
      quantityText: '1',
      unit: 'l',
      purchaseNote: '',
      categoryId: 'dairy',
      createdAt: 1,
      updatedAt: 1,
    })
    await legacy.table('shoppingPurchases').put({
      id: 'purchase-keep',
      shoppingDate: '2026-11-05',
      itemKey: 'zwiebel',
      amounts: [{ dimension: 'count', lower: 2, upper: 2 }],
      snapshot: [{ dimension: 'count', lower: 2, upper: 3 }],
      pantrySnapshot: [{ dimension: 'count', lower: 1, upper: 1 }],
      qualitative: false,
      createdAt: 1,
      updatedAt: 1,
    })
    await legacy.table('shoppingItemRules').put({
      key: 'zwiebel',
      canonicalKey: 'zwiebel',
      displayName: 'Gemüsezwiebeln',
      categoryId: 'produce',
      purchaseNote: 'bevorzugt rot',
      quantityOverrideText: '3',
      unitOverride: 'Stück',
      updatedAt: 1,
    })
    await legacy.table('pantryItems').put({
      id: 'pantry-drop',
      itemKey: 'reis',
      name: 'Reis',
      quantityText: '200',
      unit: 'g',
      buyAnyway: false,
      createdAt: 1,
      updatedAt: 1,
    })
    legacy.close()

    const upgraded = new OpenCookDatabase(name)
    await upgraded.open()
    expect(upgraded.verno).toBe(16)
    expect(upgraded.tables.map((table) => table.name)).not.toContain('pantryItems')
    expect(await upgraded.shoppingManualItems.count()).toBe(1)
    expect((await upgraded.shoppingPurchases.get('purchase-keep'))?.amounts[0]?.upper).toBe(2)
    expect(
      (await upgraded.shoppingPurchases.get('purchase-keep')) as unknown as Record<string, unknown>,
    ).not.toHaveProperty('pantrySnapshot')
    const rule = await upgraded.shoppingItemRules.get('zwiebel')
    expect(rule?.displayName).toBe('Gemüsezwiebeln')
    expect(rule?.legacyQuantityText).toBe('3')
    expect(rule?.legacyUnit).toBe('Stück')
    expect(upgraded.tables.map((table) => table.name)).toContain(
      'shoppingQuantityCorrections',
    )
    upgraded.close()
    await Dexie.delete(name)
  })
})

describe('rule identity migration', () => {
  async function createV12(
    name: string,
    ingredientNames: string[],
    withRule = true,
  ): Promise<void> {
    await Dexie.delete(name)
    const legacy = new Dexie(name)
    legacy.version(12).stores({
      recipes:
        'id, &importId, title, updatedAt, *categories, *cuisine, *dishType, effort, *tags, favorite, wantToCook, importUrl',
      images: 'id, recipeId, [recipeId+position]',
      mealPlans:
        'id, date, [date+slot], recipeId, freeDishId, pinned, cooked, cookSessionId, status',
      mealDays: 'date',
      settings: 'key',
      cookSessions: 'id, recipeId, freeDishId, date, status, [recipeId+date]',
      dayNotes: 'date, updatedAt',
      freeDishes: 'id, updatedAt',
      shoppingManualItems: 'id, shoppingDate, weekStart',
      shoppingChecks: 'id, weekStart, [weekStart+itemKey], itemKey',
      shoppingPurchases: 'id, shoppingDate, itemKey, createdAt, [itemKey+shoppingDate]',
      shoppingItemRules: 'key, updatedAt',
    })
    await legacy.open()
    await legacy.table('recipes').put({
      ...recipe,
      ingredients: ingredientNames.map((name, index) => ({
        id: `i${index}`,
        groupId: null,
        position: index,
        raw: name,
        name,
        quantity: 1,
        quantityText: '1',
        unit: 'Stück',
        purchaseNote: '',
        preparationNote: '',
        parseStatus: 'parsed',
        links: [],
      })),
    })
    if (withRule) {
      await legacy.table('shoppingItemRules').put({
        key: 'pesto',
        canonicalKey: 'pesto',
        displayName: 'Pesto',
        categoryId: 'canned',
        purchaseNote: 'bevorzugt',
        legacyQuantityText: '1',
        legacyUnit: 'Glas',
        updatedAt: 1,
      })
    }
    legacy.close()
  }

  it('maps a unique base rule to its only variant and keeps the correction as legacy', async () => {
    const name = `${NAME}-v12-unique`
    await createV12(name, ['Pesto (grün)'])
    const upgraded = new OpenCookDatabase(name)
    await upgraded.open()
    expect(upgraded.verno).toBe(16)
    const rule = await upgraded.shoppingItemRules.get('pesto')
    expect(rule?.canonicalKey).toBe(shoppingItemKey('Pesto grün'))
    expect(rule?.displayName).toBe('Pesto')
    expect(rule?.legacyQuantityText).toBe('1')
    expect(await upgraded.shoppingQuantityCorrections.count()).toBe(0)
    upgraded.close()
    await Dexie.delete(name)
  })

  it('does not merge an ambiguous base rule into one of several variants', async () => {
    const name = `${NAME}-v12-ambiguous`
    await createV12(name, ['Pesto (grün)', 'Pesto (rot)'])
    const upgraded = new OpenCookDatabase(name)
    await upgraded.open()
    const rule = await upgraded.shoppingItemRules.get('pesto')
    expect(rule?.canonicalKey).toBe('pesto')
    expect(rule?.legacyAmbiguous).toBe(true)
    expect(rule?.displayName).toBe('Pesto')
    upgraded.close()
    await Dexie.delete(name)
  })
  it('keeps historical purchases attached through a minimal alias rule', async () => {
    const name = `${NAME}-v12-purchase-alias`
    await createV12(name, ['Pesto (grün)'], false)
    const legacy = new Dexie(name)
    await legacy.open()
    await legacy.table('shoppingPurchases').put({
      id: 'purchase-old',
      shoppingDate: '2026-11-05',
      itemKey: 'pesto',
      amounts: [{ dimension: 'count', lower: 1, upper: 1 }],
      snapshot: [],
      qualitative: false,
      createdAt: 1,
      updatedAt: 1,
    })
    legacy.close()

    const upgraded = new OpenCookDatabase(name)
    await upgraded.open()
    const alias = await upgraded.shoppingItemRules.get('pesto')
    expect(alias?.canonicalKey).toBe(shoppingItemKey('Pesto grün'))
    expect((await upgraded.shoppingPurchases.get('purchase-old'))?.amounts[0]?.upper).toBe(1)
    upgraded.close()
    await Dexie.delete(name)
  })
})

describe('instruction reference migration (v13 → v14)', () => {
  it('adds stable step structure without changing instruction text or formatting', async () => {
    const name = `${NAME}-v13-steps`
    await Dexie.delete(name)
    const legacy = new Dexie(name)
    legacy.version(13).stores({
      recipes:
        'id, &importId, title, updatedAt, *categories, *cuisine, *dishType, effort, *tags, favorite, wantToCook, importUrl',
      images: 'id, recipeId, [recipeId+position]',
      mealPlans:
        'id, date, [date+slot], recipeId, freeDishId, pinned, cooked, cookSessionId, status',
      mealDays: 'date',
      settings: 'key',
      cookSessions: 'id, recipeId, freeDishId, date, status, [recipeId+date]',
      dayNotes: 'date, updatedAt',
      freeDishes: 'id, updatedAt',
      shoppingManualItems: 'id, shoppingDate, weekStart',
      shoppingChecks: 'id, weekStart, [weekStart+itemKey], itemKey',
      shoppingPurchases: 'id, shoppingDate, itemKey, createdAt, [itemKey+shoppingDate]',
      shoppingItemRules: 'key, updatedAt',
      shoppingQuantityCorrections: 'id, shoppingDate, itemKey, [itemKey+shoppingDate]',
    })
    await legacy.open()
    const text = 'Die 2 Zwiebeln würfeln.\n\nAnschließend 400 g Hackfleisch anbraten.'
    await legacy.table('recipes').put({
      ...recipe,
      ingredients: [
        {
          id: 'i1',
          groupId: null,
          position: 0,
          raw: '2 Zwiebeln',
          name: 'Zwiebeln',
          quantity: 2,
          quantityText: '2',
          unit: null,
          purchaseNote: '',
          preparationNote: '',
          parseStatus: 'parsed',
          links: [],
        },
      ],
      instructions: [
        { id: 's1', position: 0, raw: text, text },
        { id: 's1', position: 1, raw: 'Zweiter Schritt', text: 'Zweiter Schritt' },
      ],
    })
    legacy.close()

    const upgraded = new OpenCookDatabase(name)
    await upgraded.open()
    expect(upgraded.verno).toBe(16)
    const migrated = await upgraded.recipes.get('r1')
    expect(migrated?.instructions).toHaveLength(2)
    expect(migrated?.instructions[0]?.text).toBe(text)
    expect(migrated?.instructions[0]?.raw).toBe(text)
    expect(migrated?.instructions[0]?.references).toEqual([])
    expect(migrated?.instructions[0]?.position).toBe(0)
    expect(migrated?.instructions[1]?.position).toBe(1)
    expect(migrated?.instructions[1]?.id).not.toBe('s1')
    expect(migrated?.instructions[1]?.text).toBe('Zweiter Schritt')
    expect(upgraded.tables.map((table) => table.name)).toContain('cookProgress')
    upgraded.close()
    await Dexie.delete(name)
  })

  it('migrates v14 shopping rows to deterministic Thursday standard lists', async () => {
    const name = `${NAME}-v14-shopping`
    await Dexie.delete(name)
    const legacy = new Dexie(name)
    legacy.version(14).stores({
      recipes:
        'id, &importId, title, updatedAt, *categories, *cuisine, *dishType, effort, *tags, favorite, wantToCook, importUrl',
      images: 'id, recipeId, [recipeId+position]',
      mealPlans:
        'id, date, [date+slot], recipeId, freeDishId, pinned, cooked, cookSessionId, status',
      mealDays: 'date',
      settings: 'key',
      cookSessions: 'id, recipeId, freeDishId, date, status, [recipeId+date]',
      dayNotes: 'date, updatedAt',
      freeDishes: 'id, updatedAt',
      shoppingManualItems: 'id, shoppingDate, weekStart',
      shoppingChecks: 'id, weekStart, [weekStart+itemKey], itemKey',
      shoppingPurchases: 'id, shoppingDate, itemKey, createdAt, [itemKey+shoppingDate]',
      shoppingItemRules: 'key, updatedAt',
      shoppingQuantityCorrections: 'id, shoppingDate, itemKey, [itemKey+shoppingDate]',
      cookProgress: 'cookSessionId, updatedAt',
    })
    await legacy.open()
    await legacy.table('recipes').add(recipe)
    await legacy.table('settings').add({ key: 'weekStartDay', value: 1 })
    await legacy.table('shoppingManualItems').bulkAdd([
      {
        id: 'manual-a',
        shoppingDate: '2026-11-05',
        weekStart: '2026-11-05',
        name: 'Milch',
        quantityText: '1',
        unit: 'l',
        purchaseNote: '',
        categoryId: 'dairy',
        createdAt: 1,
        updatedAt: 1,
      },
      {
        id: 'manual-b',
        shoppingDate: '2026-11-12',
        weekStart: '2026-11-12',
        name: 'Brot',
        quantityText: '1',
        unit: 'Laib',
        purchaseNote: '',
        categoryId: 'bakery',
        createdAt: 2,
        updatedAt: 2,
      },
    ])
    await legacy.table('shoppingPurchases').bulkAdd([
      {
        id: 'purchase-a',
        shoppingDate: '2026-11-09',
        itemKey: 'zwiebel',
        amounts: [{ dimension: 'count', lower: 2, upper: 2 }],
        confirmedTotal: [{ dimension: 'count', lower: 2, upper: 2 }],
        snapshot: [{ dimension: 'count', lower: 3, upper: 3 }],
        qualitative: false,
        createdAt: 1,
        updatedAt: 1,
      },
      {
        id: 'purchase-b',
        shoppingDate: '2026-11-05',
        itemKey: 'zwiebel',
        amounts: [{ dimension: 'count', lower: 1, upper: 1 }],
        snapshot: [],
        qualitative: false,
        createdAt: 2,
        updatedAt: 2,
      },
    ])
    legacy.close()

    const upgraded = new OpenCookDatabase(name)
    await upgraded.open()
    expect(upgraded.verno).toBe(16)

    const manualA = await upgraded.shoppingManualItems.get('manual-a')
    expect(manualA?.listId).toBe(standardShoppingListId('2026-11-05'))
    expect(manualA?.shoppingDate).toBe('2026-11-05')
    expect(manualA?.weekStart).toBe('2026-11-05')
    const manualB = await upgraded.shoppingManualItems.get('manual-b')
    expect(manualB?.listId).toBe(standardShoppingListId('2026-11-12'))

    const purchaseA = await upgraded.shoppingPurchases.get('purchase-a')
    expect(purchaseA?.listId).toBe(standardShoppingListId('2026-11-05'))
    expect(purchaseA?.snapshot).toEqual([{ dimension: 'count', lower: 3, upper: 3 }])
    expect((await upgraded.shoppingPurchases.get('purchase-b'))?.listId).toBe(
      standardShoppingListId('2026-11-05'),
    )
    // The configured Monday week does not equal the Thursday period, so the
    // historical rows are preserved but marked for review.
    expect(purchaseA?.legacyWeekAmbiguous).toBe(true)
    expect((await upgraded.shoppingPurchases.get('purchase-b'))?.legacyWeekAmbiguous).toBe(
      true,
    )

    expect(
      (await upgraded.shoppingLists.get(standardShoppingListId('2026-11-05')))?.periodStart,
    ).toBe('2026-11-05')
    expect(
      (await upgraded.shoppingLists.get(standardShoppingListId('2026-11-12')))?.periodStart,
    ).toBe('2026-11-12')
    expect(await upgraded.shoppingLists.count()).toBe(2)
    // The configured visual week start and all recipe/date fields stay intact.
    expect((await upgraded.settings.get('weekStartDay'))?.value).toBe(1)
    expect(await upgraded.recipes.count()).toBe(1)
    expect(await upgraded.shoppingManualItems.count()).toBe(2)
    expect(await upgraded.shoppingPurchases.count()).toBe(2)
    upgraded.close()

    // Reopening must be idempotent.
    const reopened = new OpenCookDatabase(name)
    await reopened.open()
    expect(await reopened.shoppingLists.count()).toBe(2)
    expect(await reopened.shoppingManualItems.count()).toBe(2)
    expect(await reopened.shoppingPurchases.count()).toBe(2)
    expect((await reopened.shoppingManualItems.get('manual-a'))?.listId).toBe(
      standardShoppingListId('2026-11-05'),
    )
    reopened.close()
    await Dexie.delete(name)
  })

  it('marks already v15-migrated Monday-week rows for review without rewriting them', async () => {
    const name = `${NAME}-v15-legacy`
    await Dexie.delete(name)
    const legacy = new Dexie(name)
    legacy.version(15).stores({
      recipes:
        'id, &importId, title, updatedAt, *categories, *cuisine, *dishType, effort, *tags, favorite, wantToCook, importUrl',
      images: 'id, recipeId, [recipeId+position]',
      mealPlans:
        'id, date, [date+slot], recipeId, freeDishId, pinned, cooked, cookSessionId, status',
      mealDays: 'date',
      settings: 'key',
      cookSessions: 'id, recipeId, freeDishId, date, status, [recipeId+date]',
      dayNotes: 'date, updatedAt',
      freeDishes: 'id, updatedAt',
      shoppingManualItems: 'id, shoppingDate, weekStart, listId',
      shoppingChecks: 'id, weekStart, [weekStart+itemKey], itemKey',
      shoppingPurchases:
        'id, shoppingDate, itemKey, createdAt, [itemKey+shoppingDate], listId, manualItemId',
      shoppingItemRules: 'key, updatedAt',
      shoppingQuantityCorrections: 'id, shoppingDate, itemKey, [itemKey+shoppingDate]',
      shoppingLists: 'id, kind, periodStart, createdAt',
      shoppingDemandAllocations: 'id, periodStart, itemKey, listId, [periodStart+itemKey]',
      cookProgress: 'cookSessionId, updatedAt',
    })
    await legacy.open()
    await legacy.table('settings').add({ key: 'weekStartDay', value: 1 })
    await legacy.table('shoppingLists').add({
      id: standardShoppingListId('2026-11-05'),
      kind: 'standard',
      name: 'Donnerstags-Einkauf',
      periodStart: '2026-11-05',
      periodEnd: '2026-11-11',
      createdAt: 1,
      updatedAt: 1,
    })
    await legacy.table('shoppingManualItems').add({
      id: 'manual-legacy',
      shoppingDate: '2026-11-09',
      weekStart: '2026-11-02',
      listId: standardShoppingListId('2026-11-05'),
      name: 'Milch',
      quantityText: '1',
      unit: 'l',
      purchaseNote: '',
      categoryId: 'dairy',
      createdAt: 1,
      updatedAt: 1,
    })
    await legacy.table('shoppingPurchases').add({
      id: 'purchase-legacy',
      shoppingDate: '2026-11-08',
      itemKey: 'zwiebel',
      listId: standardShoppingListId('2026-11-05'),
      amounts: [{ dimension: 'count', lower: 2, upper: 2 }],
      snapshot: [],
      qualitative: false,
      createdAt: 1,
      updatedAt: 1,
    })
    legacy.close()

    const upgraded = new OpenCookDatabase(name)
    await upgraded.open()
    expect(upgraded.verno).toBe(16)
    const manual = await upgraded.shoppingManualItems.get('manual-legacy')
    expect(manual?.legacyWeekAmbiguous).toBe(true)
    expect(manual?.shoppingDate).toBe('2026-11-09')
    expect(manual?.weekStart).toBe('2026-11-02')
    expect(manual?.listId).toBe(standardShoppingListId('2026-11-05'))
    const purchase = await upgraded.shoppingPurchases.get('purchase-legacy')
    expect(purchase?.legacyWeekAmbiguous).toBe(true)
    expect(purchase?.shoppingDate).toBe('2026-11-08')
    expect(purchase?.listId).toBe(standardShoppingListId('2026-11-05'))
    upgraded.close()

    const reopened = new OpenCookDatabase(name)
    await reopened.open()
    expect(reopened.verno).toBe(16)
    expect(await reopened.shoppingManualItems.count()).toBe(1)
    expect(await reopened.shoppingPurchases.count()).toBe(1)
    reopened.close()
    await Dexie.delete(name)
  })
})
