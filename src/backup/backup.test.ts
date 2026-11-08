import { beforeEach, describe, expect, it } from 'vitest'
import { strToU8, zipSync } from 'fflate'
import { db } from '../db'
import { saveDishPlan } from '../mealplan/dishService'
import { saveFreeDishPlan } from '../mealplan/freeDishService'
import { getCalendarSettings } from '../settings/calendar'
import type { CookSession, MealPlanEntry, Recipe } from '../types'
import { BACKUP_FORMAT, exportBackup, inspectBackup, restoreBackup } from './backup'

const recipe: Recipe = {
  id: 'r1',
  importId: 'url-r1',
  importSource: 'url',
  title: 'Backup-Rezept',
  description: 'Beschreibung',
  ingredientGroups: [],
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
      purchaseNote: 'bevorzugt Mutti',
      preparationNote: 'fein gewürfelt',
      parseStatus: 'parsed',
      links: [],
    },
  ],
  instructions: [{ id: 's1', position: 0, raw: 'Kochen', text: 'Kochen' }],
  servingsText: '2',
  servingsNumber: 2,
  prepTime: '',
  cookTime: '',
  totalTime: '',
  categories: ['Mela'],
  cuisine: ['Indisch'],
  dishType: ['Curry'],
  effort: 'einfach',
  tags: ['schnell'],
  notes: 'Notiz',
  nutrition: '',
  sourceUrl: 'https://example.com/rezept',
  importUrl: 'https://example.com/rezept',
  importMeta: {
    source: 'url',
    originalUrl: 'https://example.com/rezept?utm=1',
    finalUrl: 'https://example.com/rezept',
    candidateKey: 'id:https://example.com/rezept#recipe',
    fetchedAt: 1234,
    imageSourceUrls: ['https://example.com/bild.jpg'],
    imageWarnings: ['Ein Bild fehlte.'],
  },
  favorite: true,
  wantToCook: false,
  melaDate: 123,
  raw: { original: true },
  createdAt: 1,
  updatedAt: 1,
}

const plan: MealPlanEntry = {
  id: 'plan-2026-05-25-dinner',
  date: '2026-05-25',
  slot: 'dinner',
  recipeId: 'r1',
  auto: true,
  pinned: true,
  leftover: false,
  cooked: false,
  reasons: [{ code: 'LIKED', weight: 2 }],
  createdAt: 1,
  updatedAt: 1,
}

function bytes(values: number[]): ArrayBuffer {
  const data = new Uint8Array(values)
  return data.buffer as ArrayBuffer
}

function toArrayBuffer(data: Uint8Array): ArrayBuffer {
  return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer
}

async function clearAll(): Promise<void> {
  await db.recipes.clear()
  await db.images.clear()
  await db.cookSessions.clear()
  await db.mealPlans.clear()
  await db.mealDays.clear()
  await db.settings.clear()
  await db.dayNotes.clear()
  await db.freeDishes.clear()
  await db.shoppingManualItems.clear()
  await db.shoppingChecks.clear()
  await db.shoppingPurchases.clear()
  await db.shoppingItemRules.clear()
  await db.shoppingQuantityCorrections.clear()
  await db.shoppingLists.clear()
  await db.shoppingDemandAllocations.clear()
}

async function seed(): Promise<void> {
  await db.recipes.put(recipe)
  await db.images.put({
    id: 'img1',
    recipeId: 'r1',
    position: 0,
    mimeType: 'image/png',
    bytes: bytes([1, 2, 3]),
  })
  await db.mealPlans.put(plan)
  await db.mealDays.put({ date: '2026-05-25', skipped: false, createdAt: 1, updatedAt: 1 })
  await db.settings.put({ key: 'householdSize', value: 3 })
}

beforeEach(async () => {
  await clearAll()
})

describe('backup roundtrip', () => {
  it('exports recipes, images, tags, raw data, plan and settings', async () => {
    await seed()
    const { bytes: archive, manifest } = await exportBackup()
    expect(manifest.counts).toEqual({
      recipes: 1,
      images: 1,
      mealPlans: 1,
      mealDays: 1,
      settings: 1,
      dayNotes: 0,
      freeDishes: 0,
      shoppingManualItems: 0,
      shoppingChecks: 0,
      shoppingPurchases: 0,
      shoppingItemRules: 0,
      shoppingQuantityCorrections: 0,
      shoppingLists: 0,
      shoppingDemandAllocations: 0,
    })
    expect(archive.byteLength).toBeGreaterThan(0)

    await clearAll()
    const inspection = await inspectBackup(toArrayBuffer(archive))
    expect(inspection.conflicts.recipes).toBe(0)
    expect(inspection.recipes[0]?.title).toBe('Backup-Rezept')
    expect(inspection.recipes[0]?.tags).toEqual(['schnell'])
    expect(inspection.recipes[0]?.raw).toEqual({ original: true })
    expect(inspection.recipes[0]?.ingredients[0]?.purchaseNote).toBe('bevorzugt Mutti')
    expect(inspection.recipes[0]?.ingredients[0]?.preparationNote).toBe('fein gewürfelt')
    expect(inspection.recipes[0]?.importUrl).toBe('https://example.com/rezept')
    expect(inspection.recipes[0]?.importSource).toBe('url')
    expect(inspection.recipes[0]?.importMeta).toEqual(recipe.importMeta)

    const result = await restoreBackup(inspection, 'merge')
    expect(result.addedRecipes).toBe(1)
    expect(result.addedImages).toBe(1)
    expect(result.addedMealPlans).toBe(1)
    expect(result.addedMealDays).toBe(1)
    expect(result.addedSettings).toBe(1)

    expect((await db.recipes.get('r1'))?.cuisine).toEqual(['Indisch'])
    expect((await db.recipes.get('r1'))?.ingredients[0]?.purchaseNote).toBe('bevorzugt Mutti')
    expect((await db.recipes.get('r1'))?.ingredients[0]?.preparationNote).toBe('fein gewürfelt')
    expect(new Uint8Array((await db.images.get('img1'))!.bytes)).toEqual(new Uint8Array([1, 2, 3]))
    expect((await db.mealPlans.get(plan.id))?.reasons).toEqual([{ code: 'LIKED', weight: 2 }])
    expect((await db.mealDays.get('2026-05-25'))?.skipped).toBe(false)
    expect((await db.settings.get('householdSize'))?.value).toBe(3)
  })

  it('roundtrips structured instructions and explicit ingredient references', async () => {
    const structured: Recipe = {
      ...recipe,
      id: 'r-ref',
      importId: 'mela-r-ref',
      title: 'Referenzrezept',
      instructions: [
        {
          id: 'step-a',
          position: 0,
          raw: 'Die 2 Zwiebeln würfeln.',
          text: 'Die 2 Zwiebeln würfeln.',
          references: [
            {
              id: 'ref-a',
              ingredientId: 'i1',
              anchor: '2',
              anchorOffset: 4,
              quantity: { kind: 'full' },
            },
          ],
        },
        {
          id: 'step-b',
          position: 1,
          raw: 'Die übrigen 60 g Butter dazugeben.',
          text: 'Die übrigen 60 g Butter dazugeben.',
          references: [
            {
              id: 'ref-b',
              ingredientId: 'i2',
              anchor: '60',
              anchorOffset: 12,
              quantity: { kind: 'remainder' },
            },
          ],
        },
      ],
    }
    await db.recipes.put(structured)

    const { bytes: archive } = await exportBackup()
    await clearAll()
    const inspection = await inspectBackup(toArrayBuffer(archive))
    expect(inspection.recipes[0]?.instructions[0]?.references?.[0]).toMatchObject({
      id: 'ref-a',
      ingredientId: 'i1',
      anchor: '2',
      anchorOffset: 4,
      quantity: { kind: 'full' },
    })
    expect(inspection.recipes[0]?.instructions[1]?.references?.[0]?.quantity).toEqual({
      kind: 'remainder',
    })

    await restoreBackup(inspection, 'merge')
    const restored = await db.recipes.get('r-ref')
    expect(restored?.instructions.map((step) => step.text)).toEqual([
      'Die 2 Zwiebeln würfeln.',
      'Die übrigen 60 g Butter dazugeben.',
    ])
    expect(restored?.instructions[0]?.references?.[0]?.ingredientId).toBe('i1')
    expect(restored?.instructions[1]?.references?.[0]?.anchor).toBe('60')

    // A merge conflict keeps the local original instructions untouched.
    await db.recipes.put({
      ...structured,
      instructions: [
        { id: 'local-step', position: 0, raw: 'Lokal', text: 'Lokal', references: [] },
      ],
    })
    const merge = await restoreBackup(inspection, 'merge')
    expect(merge.skippedRecipes).toBe(1)
    expect((await db.recipes.get('r-ref'))?.instructions[0]?.text).toBe('Lokal')
  })

  it('preserves calendar settings through the backup', async () => {
    await db.settings.bulkPut([
      { key: 'weekStartDay', value: 3 },
      { key: 'overlapBefore', value: 2 },
      { key: 'overlapAfter', value: 2 },
    ])

    const { bytes: archive } = await exportBackup()
    await clearAll()
    const inspection = await inspectBackup(toArrayBuffer(archive))
    expect(inspection.settings.map((setting) => setting.key).sort()).toEqual([
      'overlapAfter',
      'overlapBefore',
      'weekStartDay',
    ])

    await restoreBackup(inspection, 'replace')
    expect(await getCalendarSettings()).toEqual({
      weekStartDay: 3,
      overlapBefore: 2,
      overlapAfter: 2,
    })
  })

  it('roundtrips day notes and keeps local notes on merge', async () => {
    await db.dayNotes.bulkPut([
      { date: '2026-05-25', text: 'Essen gehen', createdAt: 1, updatedAt: 1 },
      { date: '2026-05-26', text: 'Bei Freunden eingeladen', createdAt: 2, updatedAt: 2 },
    ])

    const { bytes: archive, manifest } = await exportBackup()
    expect(manifest.counts.dayNotes).toBe(2)
    expect(manifest.includes).toContain('dayNotes')

    await clearAll()
    const inspection = await inspectBackup(toArrayBuffer(archive))
    expect(inspection.dayNotes.map((note) => note.text).sort()).toEqual([
      'Bei Freunden eingeladen',
      'Essen gehen',
    ])
    expect(inspection.conflicts.dayNotes).toBe(0)

    const merged = await restoreBackup(inspection, 'merge')
    expect(merged.addedDayNotes).toBe(2)
    expect(merged.skippedDayNotes).toBe(0)
    expect((await db.dayNotes.get('2026-05-25'))?.text).toBe('Essen gehen')
    const conflictInspection = await inspectBackup(toArrayBuffer(archive))
    expect(conflictInspection.conflicts.dayNotes).toBe(2)

    await db.dayNotes.put({
      date: '2026-05-25',
      text: 'Lokal geändert',
      createdAt: 1,
      updatedAt: 5,
    })
    const mergedAgain = await restoreBackup(inspection, 'merge')
    expect(mergedAgain.skippedDayNotes).toBe(2)
    expect((await db.dayNotes.get('2026-05-25'))?.text).toBe('Lokal geändert')

    const replaced = await restoreBackup(inspection, 'replace')
    expect(replaced.addedDayNotes).toBe(2)
    expect((await db.dayNotes.get('2026-05-25'))?.text).toBe('Essen gehen')
    expect(await db.dayNotes.count()).toBe(2)
  })

  it('imports an older recipe shape and adds empty ingredient note fields', async () => {
    const legacyIngredient = { ...recipe.ingredients[0]!, id: 'i2' }
    delete legacyIngredient.purchaseNote
    delete legacyIngredient.preparationNote
    const legacyRecipe: Recipe = {
      ...recipe,
      id: 'r2',
      importId: 'mela-r2',
      importSource: 'mela',
      title: 'Altbestand',
      ingredients: [legacyIngredient],
    }
    delete legacyRecipe.importUrl
    delete legacyRecipe.importMeta
    await db.recipes.put(legacyRecipe)

    const { bytes: archive } = await exportBackup()
    await clearAll()
    const inspection = await inspectBackup(toArrayBuffer(archive))
    const imported = inspection.recipes.find((entry) => entry.id === 'r2')!
    expect(imported.ingredients[0]?.raw).toBe('2 Zwiebeln')
    expect(imported.ingredients[0]?.purchaseNote).toBe('')
    expect(imported.ingredients[0]?.preparationNote).toBe('')
    expect(imported.importUrl).toBe('')
    expect(imported.importMeta).toBeUndefined()

    await restoreBackup(inspection, 'merge')
    expect((await db.recipes.get('r2'))?.ingredients[0]?.raw).toBe('2 Zwiebeln')
    expect((await db.recipes.get('r2'))?.ingredients[0]?.purchaseNote).toBe('')
    expect((await db.recipes.get('r2'))?.ingredients[0]?.preparationNote).toBe('')
  })

  it('keeps local data on merge and overwrites only on explicit replace', async () => {
    await seed()
    const { bytes: archive } = await exportBackup()
    await db.recipes.put({ ...recipe, title: 'Lokal geändert', updatedAt: 2, tags: ['lokal'] })

    const inspection = await inspectBackup(toArrayBuffer(archive))
    expect(inspection.conflicts.recipes).toBe(1)

    const merged = await restoreBackup(inspection, 'merge')
    expect(merged.skippedRecipes).toBe(1)
    expect((await db.recipes.get('r1'))?.title).toBe('Lokal geändert')
    expect((await db.recipes.get('r1'))?.tags).toEqual(['lokal'])

    const replaced = await restoreBackup(inspection, 'replace')
    expect(replaced.addedRecipes).toBe(1)
    expect((await db.recipes.get('r1'))?.title).toBe('Backup-Rezept')
    expect((await db.recipes.get('r1'))?.tags).toEqual(['schnell'])
  })

  it('rejects a manipulated ZIP path', async () => {
    const zip = zipSync({ '../evil.json': strToU8('{}') })
    await expect(inspectBackup(toArrayBuffer(zip))).rejects.toThrow('Unsicherer Pfad')
  })

  it('roundtrips cooking events and the meal appointments that consume them', async () => {
    await seed()
    const session: CookSession = {
      id: 'cook-1',
      recipeId: 'r1',
      date: '2026-05-25',
      servings: 6,
      status: 'cooked',
      auto: false,
      createdAt: 5,
      updatedAt: 6,
    }
    await db.cookSessions.put(session)
    const linked: MealPlanEntry[] = [
      {
        ...plan,
        id: 'meal-breakfast',
        slot: 'breakfast',
        servings: 2,
        position: 0,
        cookSessionId: session.id,
        status: 'eaten',
        leftover: true,
      },
      {
        ...plan,
        id: 'meal-lunch',
        slot: 'lunch',
        servings: 2,
        position: 0,
        cookSessionId: session.id,
        status: 'planned',
        leftover: true,
      },
    ]
    await db.mealPlans.bulkPut(linked)

    const { bytes: archive, manifest } = await exportBackup()
    expect(manifest.version).toBe(12)
    expect(manifest.includes).toContain('cookSessions')
    expect(manifest.includes).toContain('dayNotes')
    expect(manifest.includes).toContain('freeDishes')

    await clearAll()
    const inspection = await inspectBackup(toArrayBuffer(archive))
    expect(inspection.cookSessions).toEqual([session])
    expect(inspection.warnings).toEqual([])
    expect(
      inspection.mealPlans.find((entry) => entry.id === 'meal-breakfast')?.cookSessionId,
    ).toBe(session.id)
    expect(inspection.conflicts.cookSessions).toBe(0)

    const restored = await restoreBackup(inspection, 'replace')
    expect(restored.addedCookSessions).toBe(1)
    expect(restored.detachedMealLinks).toBe(0)
    expect(await db.cookSessions.get(session.id)).toEqual(session)
    const stored = await db.mealPlans.where('cookSessionId').equals(session.id).toArray()
    expect(stored.map((entry) => entry.id).sort()).toEqual(['meal-breakfast', 'meal-lunch'])
    expect(stored.find((entry) => entry.id === 'meal-breakfast')?.status).toBe('eaten')
  })

  it('roundtrips a multi-day dish with individual daily portions', async () => {
    await db.recipes.put(recipe)
    const created = await saveDishPlan({
      recipeId: 'r1',
      days: [
        { date: '2026-05-25', servings: 2 },
        { date: '2026-05-26', servings: 1 },
        { date: '2026-05-27', servings: 3 },
      ],
    })

    const { bytes: archive } = await exportBackup()
    await clearAll()

    const inspection = await inspectBackup(toArrayBuffer(archive))
    const restored = await restoreBackup(inspection, 'replace')
    expect(restored.addedCookSessions).toBe(1)
    expect(restored.detachedMealLinks).toBe(0)

    const session = await db.cookSessions.get(created.session.id)
    expect(session?.servings).toBe(6)
    const stored = await db.mealPlans
      .where('cookSessionId')
      .equals(created.session.id)
      .toArray()
    expect(stored).toHaveLength(3)
    expect(stored.map((entry) => entry.servings).sort()).toEqual([1, 2, 3])
    expect(stored.every((entry) => entry.slot === created.entries[0]?.slot)).toBe(true)
    expect(await db.recipes.get('r1')).toBeTruthy()
  })

  it('imports an old version 1 backup and adds safe defaults to its plans', async () => {
    const legacyPlan = {
      id: 'legacy-plan',
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
    }
    const legacyManifest = {
      format: BACKUP_FORMAT,
      version: 1,
      createdAt: '2026-05-25T10:00:00.000Z',
      appVersion: '0.3.0',
      counts: { recipes: 1, images: 0, mealPlans: 1, mealDays: 0, settings: 1 },
      includes: ['recipes', 'mealPlans'],
    }
    const zip = zipSync({
      'manifest.json': strToU8(JSON.stringify(legacyManifest)),
      'recipes.json': strToU8(JSON.stringify({ version: 1, recipes: [recipe] })),
      'images.json': strToU8(JSON.stringify({ version: 1, images: [] })),
      'mealplan.json': strToU8(
        JSON.stringify({
          version: 1,
          mealPlans: [legacyPlan],
          mealDays: [],
          settings: [{ key: 'householdSize', value: 4 }],
        }),
      ),
    })

    const inspection = await inspectBackup(toArrayBuffer(zip))
    expect(inspection.manifest.version).toBe(1)
    expect(inspection.cookSessions).toEqual([])
    expect(inspection.dayNotes).toEqual([])
    const migrated = inspection.mealPlans[0]!
    expect(migrated.servings).toBe(4)
    expect(migrated.status).toBe('eaten')
    expect(migrated.cookSessionId).toBeNull()
    expect(migrated.reasons).toEqual([{ code: 'LIKED', weight: 2 }])

    const restored = await restoreBackup(inspection, 'replace')
    expect(restored.addedMealPlans).toBe(1)
    expect((await db.mealPlans.get('legacy-plan'))?.cookSessionId).toBeNull()
    expect((await db.mealPlans.get('legacy-plan'))?.pinned).toBe(true)
    expect(await db.cookSessions.count()).toBe(0)
  })

  it('detaches a broken cooking-event link instead of losing the meal', async () => {
    const brokenPlan = {
      id: 'broken-plan',
      date: '2026-05-25',
      slot: 'dinner',
      recipeId: 'r1',
      servings: 2,
      cookSessionId: 'missing-session',
      leftover: true,
      auto: false,
      pinned: false,
      cooked: false,
      reasons: [],
      createdAt: 1,
      updatedAt: 1,
    }
    const zip = zipSync({
      'manifest.json': strToU8(
        JSON.stringify({
          format: BACKUP_FORMAT,
          version: 2,
          createdAt: '2026-05-25T10:00:00.000Z',
          appVersion: '0.4.0',
          counts: { recipes: 1, images: 0, mealPlans: 1, mealDays: 0, settings: 0 },
          includes: ['recipes', 'mealPlans', 'cookSessions'],
        }),
      ),
      'recipes.json': strToU8(JSON.stringify({ version: 2, recipes: [recipe] })),
      'images.json': strToU8(JSON.stringify({ version: 2, images: [] })),
      'mealplan.json': strToU8(
        JSON.stringify({
          version: 2,
          mealPlans: [brokenPlan],
          mealDays: [],
          settings: [],
          cookSessions: [],
        }),
      ),
    })

    const inspection = await inspectBackup(toArrayBuffer(zip))
    expect(inspection.warnings).toHaveLength(1)
    expect(inspection.warnings[0]).toContain('Verknüpfung')
    expect(inspection.mealPlans[0]?.cookSessionId).toBeNull()
    expect(inspection.mealPlans[0]?.leftover).toBe(false)
    await restoreBackup(inspection, 'replace')
    expect((await db.mealPlans.get('broken-plan'))?.id).toBe('broken-plan')
  })

  it('roundtrips a free dish with reference portions, ingredients, notes and links', async () => {
    const created = await saveFreeDishPlan({
      name: 'Nudeln mit Pesto',
      days: [
        { date: '2026-05-28', servings: 2 },
        { date: '2026-05-31', servings: 1 },
      ],
      referenceServings: 3,
      ingredients: [
        { quantity: '300', unit: 'g', name: 'Nudeln' },
        {
          quantity: '1',
          unit: 'Glas',
          name: 'Pesto',
          purchaseNote: 'bevorzugt Barilla',
        },
        {
          quantity: '50',
          unit: 'g',
          name: 'Parmesan',
          preparationNote: 'frisch gerieben',
        },
      ],
    })

    const { bytes: archive, manifest } = await exportBackup()
    expect(manifest.counts.freeDishes).toBe(1)
    expect(manifest.includes).toContain('freeDishes')

    await clearAll()
    const inspection = await inspectBackup(toArrayBuffer(archive))
    expect(inspection.warnings).toEqual([])
    expect(inspection.conflicts.freeDishes).toBe(0)
    expect(inspection.freeDishes).toHaveLength(1)
    expect(inspection.freeDishes[0]?.name).toBe('Nudeln mit Pesto')
    expect(inspection.freeDishes[0]?.referenceServings).toBe(3)
    expect(inspection.freeDishes[0]?.ingredients[1]?.purchaseNote).toBe(
      'bevorzugt Barilla',
    )
    expect(inspection.freeDishes[0]?.ingredients[2]?.preparationNote).toBe(
      'frisch gerieben',
    )
    expect(inspection.cookSessions[0]?.freeDishId).toBe(created.freeDish.id)
    expect(inspection.mealPlans.map((entry) => entry.freeDishId)).toEqual([
      created.freeDish.id,
      created.freeDish.id,
    ])

    const merged = await restoreBackup(inspection, 'merge')
    expect(merged.addedFreeDishes).toBe(1)
    expect(merged.skippedFreeDishes).toBe(0)
    expect(merged.addedCookSessions).toBe(1)
    expect(merged.addedMealPlans).toBe(2)
    expect(merged.detachedMealLinks).toBe(0)
    expect((await db.freeDishes.get(created.freeDish.id))?.referenceServings).toBe(3)
    expect((await db.cookSessions.get(created.session.id))?.recipeId).toBeNull()

    await clearAll()
    const replaced = await restoreBackup(inspection, 'replace')
    expect(replaced.addedFreeDishes).toBe(1)
    expect(await db.freeDishes.count()).toBe(1)
    expect(await db.cookSessions.count()).toBe(1)
    expect(await db.mealPlans.count()).toBe(2)
    expect(await db.recipes.count()).toBe(0)
  })

  it('keeps a locally edited free dish on merge and restores the backup on replace', async () => {
    const created = await saveFreeDishPlan({
      name: 'Brotzeit',
      days: [{ date: '2026-05-28', servings: 2 }],
      referenceServings: 2,
      ingredients: [{ quantity: '1', unit: 'Brot', name: 'Bauernbrot' }],
    })
    const { bytes: archive } = await exportBackup()

    await saveFreeDishPlan({
      cookSessionId: created.session.id,
      freeDishId: created.freeDish.id,
      name: 'Lokal geändert',
      days: created.entries.map((entry) => ({
        entryId: entry.id,
        date: entry.date,
        servings: entry.servings ?? 1,
      })),
      referenceServings: 2,
      ingredients: [{ quantity: '2', unit: 'Brot', name: 'Bauernbrot' }],
    })

    const inspection = await inspectBackup(toArrayBuffer(archive))
    expect(inspection.conflicts.freeDishes).toBe(1)
    expect(inspection.conflicts.cookSessions).toBe(1)
    expect(inspection.conflicts.mealPlans).toBe(1)

    const merged = await restoreBackup(inspection, 'merge')
    expect(merged.skippedFreeDishes).toBe(1)
    expect(merged.skippedCookSessions).toBe(1)
    expect(merged.skippedMealPlans).toBe(1)
    expect((await db.freeDishes.get(created.freeDish.id))?.name).toBe('Lokal geändert')
    expect((await db.freeDishes.get(created.freeDish.id))?.ingredients[0]?.quantityText).toBe(
      '2',
    )

    const replaced = await restoreBackup(inspection, 'replace')
    expect(replaced.addedFreeDishes).toBe(1)
    expect((await db.freeDishes.get(created.freeDish.id))?.name).toBe('Brotzeit')
    expect((await db.freeDishes.get(created.freeDish.id))?.ingredients[0]?.quantityText).toBe(
      '1',
    )
  })

  it('imports a version 3 backup without free dishes and keeps it compatible', async () => {
    const legacyManifest = {
      format: BACKUP_FORMAT,
      version: 3,
      createdAt: '2026-05-25T10:00:00.000Z',
      appVersion: '0.4.0',
      counts: { recipes: 1, images: 0, mealPlans: 0, mealDays: 0, settings: 0, dayNotes: 1 },
      includes: ['recipes', 'mealPlans', 'cookSessions', 'dayNotes'],
    }
    const zip = zipSync({
      'manifest.json': strToU8(JSON.stringify(legacyManifest)),
      'recipes.json': strToU8(JSON.stringify({ version: 3, recipes: [recipe] })),
      'images.json': strToU8(JSON.stringify({ version: 3, images: [] })),
      'mealplan.json': strToU8(
        JSON.stringify({
          version: 3,
          mealPlans: [],
          mealDays: [],
          settings: [],
          cookSessions: [],
          dayNotes: [],
        }),
      ),
    })

    const inspection = await inspectBackup(toArrayBuffer(zip))
    expect(inspection.manifest.version).toBe(3)
    expect(inspection.freeDishes).toEqual([])
    expect(inspection.conflicts.freeDishes).toBe(0)
    const restored = await restoreBackup(inspection, 'replace')
    expect(restored.addedFreeDishes).toBe(0)
    expect(await db.recipes.count()).toBe(1)
    expect(await db.freeDishes.count()).toBe(0)
  })
})
