import { beforeEach, describe, expect, it } from 'vitest'
import { inspectBackup } from '../backup/backup'
import type { ImageStoragePort } from '../data/imageStorage'
import type { CloudRecordsStore } from '../data/cloudRecords'
import { createTestStore, TestRecordsBackend } from './recordsTestBackend'
import { exportCloudBackup, restoreCloudBackup } from './cloudBackup'
import { recipeFromParsedMela } from '../import/melaRecipe'
import type {
  CookSession,
  DayNote,
  FreeDish,
  MealDay,
  MealPlanEntry,
  ParsedMelaRecipe,
  Recipe,
  RecipeImageMeta,
  SettingRecord,
  ShoppingDemandAllocation,
  ShoppingItemRule,
  ShoppingList,
  ShoppingManualItem,
  ShoppingPurchase,
  ShoppingQuantityCorrection,
} from '../types'

class TestStorage implements ImageStoragePort {
  readonly objects = new Map<string, { bytes: Uint8Array; mimeType: string }>()
  failUpload: Error | null = null
  failDownload: Error | null = null

  async upload(path: string, bytes: ArrayBuffer, mimeType: string): Promise<void> {
    if (this.failUpload) {
      const error = this.failUpload
      this.failUpload = null
      throw error
    }
    this.objects.set(path, { bytes: new Uint8Array(bytes), mimeType })
  }

  async createSignedUrl(): Promise<string> {
    return 'https://signed.example/image'
  }

  async download(path: string): Promise<ArrayBuffer> {
    if (this.failDownload) {
      const error = this.failDownload
      this.failDownload = null
      throw error
    }
    const object = this.objects.get(path)
    if (!object) throw new Error(`Datei fehlt: ${path}`)
    return object.bytes.slice().buffer as ArrayBuffer
  }

  async remove(paths: readonly string[]): Promise<void> {
    for (const path of paths) this.objects.delete(path)
  }
}

function parsedMela(): ParsedMelaRecipe {
  return {
    importId: 'mela-r1',
    title: 'Cloud-Backup-Rezept',
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
    notes: '',
    nutrition: '',
    sourceUrl: '',
    favorite: false,
    wantToCook: false,
    melaDate: null,
    images: [],
    warnings: [],
    raw: { source: 'mela' },
  }
}

interface Fixture {
  recipe: Recipe
  imageMeta: RecipeImageMeta
  cookSession: CookSession
  plan: MealPlanEntry
  mealDay: MealDay
  dayNote: DayNote
  freeDish: FreeDish
  settings: SettingRecord[]
  shoppingList: ShoppingList
  manualItem: ShoppingManualItem
  purchase: ShoppingPurchase
  rule: ShoppingItemRule
  correction: ShoppingQuantityCorrection
  allocation: ShoppingDemandAllocation
}

function fixture(): Fixture {
  const recipe = recipeFromParsedMela(parsedMela(), 'r1', 1)
  const imageMeta: RecipeImageMeta = {
    id: 'img1',
    recipeId: 'r1',
    position: 0,
    mimeType: 'image/png',
    size: 3,
    storagePath: 'r1/img1',
    createdAt: 1,
    updatedAt: 1,
  }
  const cookSession: CookSession = {
    id: 's1',
    recipeId: 'r1',
    date: '2026-05-25',
    servings: 2,
    status: 'planned',
    auto: false,
    createdAt: 1,
    updatedAt: 1,
  }
  const plan: MealPlanEntry = {
    id: 'plan1',
    date: '2026-05-25',
    slot: 'dinner',
    recipeId: 'r1',
    servings: 2,
    position: 0,
    cookSessionId: 's1',
    status: 'planned',
    auto: false,
    pinned: false,
    leftover: false,
    cooked: false,
    reasons: [],
    createdAt: 1,
    updatedAt: 1,
  }
  const mealDay: MealDay = {
    date: '2026-05-25',
    skipped: false,
    createdAt: 1,
    updatedAt: 1,
  }
  const dayNote: DayNote = {
    date: '2026-05-25',
    text: 'Notiz',
    createdAt: 1,
    updatedAt: 1,
  }
  const freeDish: FreeDish = {
    id: 'free1',
    name: 'Freies Gericht',
    referenceServings: 2,
    ingredients: [],
    createdAt: 1,
    updatedAt: 1,
  }
  const settings: SettingRecord[] = [
    { key: 'householdSize', value: 3 },
    { key: 'weekStartDay', value: 1 },
  ]
  const shoppingList: ShoppingList = {
    id: 'list1',
    kind: 'free',
    name: 'Testliste',
    periodStart: null,
    periodEnd: null,
    createdAt: 1,
    updatedAt: 1,
  }
  const manualItem: ShoppingManualItem = {
    id: 'm1',
    listId: 'list1',
    shoppingDate: '2026-05-25',
    name: 'Milch',
    quantityText: '1',
    unit: 'l',
    purchaseNote: '',
    categoryId: null,
    createdAt: 1,
    updatedAt: 1,
  }
  const purchase: ShoppingPurchase = {
    id: 'purchase1',
    shoppingDate: '2026-05-25',
    itemKey: 'milch',
    listId: 'list1',
    manualItemId: 'm1',
    provenance: 'recorded',
    amounts: [{ dimension: 'volume', lower: 1000, upper: 1000 }],
    snapshot: [{ dimension: 'volume', lower: 1000, upper: 1000 }],
    qualitative: false,
    createdAt: 1,
    updatedAt: 1,
  }
  const rule: ShoppingItemRule = {
    key: 'milch',
    displayName: 'Milch',
    categoryId: null,
    purchaseNote: '',
    updatedAt: 1,
  }
  const correction: ShoppingQuantityCorrection = {
    id: 'corr1',
    shoppingDate: '2026-05-25',
    itemKey: 'milch',
    dimension: 'volume',
    quantityText: '1',
    unit: 'l',
    sourceSignature: 'sig',
    createdAt: 1,
    updatedAt: 1,
  }
  const allocation: ShoppingDemandAllocation = {
    id: 'alloc1',
    periodStart: '2026-05-25',
    itemKey: 'milch',
    dimension: 'volume',
    listId: 'list1',
    mode: 'partial',
    quantityMilli: 1000,
    createdAt: 1,
    updatedAt: 1,
  }
  return {
    recipe,
    imageMeta,
    cookSession,
    plan,
    mealDay,
    dayNote,
    freeDish,
    settings,
    shoppingList,
    manualItem,
    purchase,
    rule,
    correction,
    allocation,
  }
}

let backend: TestRecordsBackend
let store: CloudRecordsStore
let storage: TestStorage

beforeEach(async () => {
  backend = new TestRecordsBackend()
  store = await createTestStore(backend)
  storage = new TestStorage()
})

async function seedFixture(): Promise<Fixture> {
  const data = fixture()
  backend.seed('recipes', data.recipe.id, data.recipe)
  backend.seed('images', data.imageMeta.id, data.imageMeta)
  backend.seed('cookSessions', data.cookSession.id, data.cookSession)
  backend.seed('mealPlans', data.plan.id, data.plan)
  backend.seed('mealDays', data.mealDay.date, data.mealDay)
  backend.seed('dayNotes', data.dayNote.date, data.dayNote)
  backend.seed('freeDishes', data.freeDish.id, data.freeDish)
  for (const setting of data.settings) backend.seed('settings', setting.key, setting)
  backend.seed('shoppingLists', data.shoppingList.id, data.shoppingList)
  backend.seed('shoppingManualItems', data.manualItem.id, data.manualItem)
  backend.seed('shoppingPurchases', data.purchase.id, data.purchase)
  backend.seed('shoppingItemRules', data.rule.key, data.rule)
  backend.seed('shoppingQuantityCorrections', data.correction.id, data.correction)
  backend.seed('shoppingDemandAllocations', data.allocation.id, data.allocation)
  storage.objects.set(data.imageMeta.storagePath, {
    bytes: new Uint8Array([1, 2, 3]),
    mimeType: data.imageMeta.mimeType,
  })
  await store.load()
  return data
}

describe('cloud backup', () => {
  it('exports all shared collections and image bytes as a normal ZIP', async () => {
    const data = await seedFixture()
    const { bytes, manifest } = await exportCloudBackup(store, storage)
    expect(bytes.byteLength).toBeGreaterThan(0)
    expect(manifest.counts.recipes).toBe(1)
    expect(manifest.counts.images).toBe(1)
    expect(manifest.counts.mealPlans).toBe(1)
    expect(manifest.counts.shoppingLists).toBe(1)
    expect(manifest.counts.shoppingPurchases).toBe(1)
    expect(manifest.counts.shoppingDemandAllocations).toBe(1)
    expect(manifest.counts.settings).toBe(2)

    const inspection = await inspectBackup(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
      { compareLocal: false },
    )
    expect(inspection.conflicts.recipes).toBe(0)
    expect(inspection.recipes[0]?.id).toBe(data.recipe.id)
    expect(inspection.recipes[0]?.importId).toBe('mela-r1')
    expect(inspection.recipes[0]?.ingredients[0]?.quantity).toBe(2)
    expect(inspection.images[0]?.meta.id).toBe('img1')
    expect(new Uint8Array(inspection.images[0]!.bytes)).toEqual(new Uint8Array([1, 2, 3]))
    expect(inspection.mealPlans[0]?.cookSessionId).toBe('s1')
    expect(inspection.cookSessions[0]?.recipeId).toBe('r1')
    expect(inspection.freeDishes[0]?.id).toBe('free1')
    expect(inspection.settings).toHaveLength(2)
    expect(inspection.shoppingLists[0]?.id).toBe('list1')
    expect(inspection.shoppingPurchases[0]?.manualItemId).toBe('m1')
    expect(inspection.shoppingItemRules[0]?.key).toBe('milch')
    expect(inspection.shoppingQuantityCorrections).toHaveLength(1)
    expect(inspection.shoppingQuantityCorrections[0]?.itemKey).toBe('milch')
    expect(inspection.shoppingDemandAllocations[0]?.listId).toBe('list1')
    expect(inspection.dayNotes[0]?.date).toBe('2026-05-25')
    expect(inspection.mealDays[0]?.date).toBe('2026-05-25')
  })

  it('fails the export when an image cannot be downloaded', async () => {
    await seedFixture()
    storage.failDownload = new Error('Storage nicht erreichbar')
    await expect(exportCloudBackup(store, storage)).rejects.toThrow(/Storage nicht erreichbar/)
  })

  it('restores a backup into an empty cloud dataset and preserves references', async () => {
    const data = await seedFixture()
    const { bytes } = await exportCloudBackup(store, storage)
    const inspection = await inspectBackup(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
      { compareLocal: false },
    )

    backend = new TestRecordsBackend()
    store = await createTestStore(backend)
    storage = new TestStorage()
    const result = await restoreCloudBackup(inspection, store, storage)

    expect(result.mode).toBe('replace')
    expect(result.addedRecipes).toBe(1)
    expect(result.addedImages).toBe(1)
    expect(result.addedMealPlans).toBe(1)
    expect(result.addedCookSessions).toBe(1)
    expect(result.addedShoppingLists).toBe(1)
    expect(result.addedShoppingPurchases).toBe(1)
    expect(store.get<Recipe>('recipes', data.recipe.id)?.data.importId).toBe('mela-r1')
    expect(store.get<MealPlanEntry>('mealPlans', data.plan.id)?.data.cookSessionId).toBe('s1')
    expect(store.get<CookSession>('cookSessions', 's1')?.data.recipeId).toBe('r1')
    expect(store.get<RecipeImageMeta>('images', 'img1')?.data.storagePath).toBe('r1/img1')
    expect(store.get<SettingRecord>('settings', 'householdSize')?.data.value).toBe(3)
    expect(store.get<ShoppingPurchase>('shoppingPurchases', 'purchase1')?.data.manualItemId).toBe(
      'm1',
    )
    expect(new Uint8Array(await storage.download('r1/img1'))).toEqual(new Uint8Array([1, 2, 3]))
  })

  it('rejects an inconsistent backup before writing anything', async () => {
    const data = await seedFixture()
    const { bytes } = await exportCloudBackup(store, storage)
    const inspection = await inspectBackup(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
      { compareLocal: false },
    )
    inspection.mealPlans[0]!.recipeId = 'fehlt'

    backend = new TestRecordsBackend()
    store = await createTestStore(backend)
    storage = new TestStorage()
    await expect(restoreCloudBackup(inspection, store, storage)).rejects.toThrow(
      /verweist auf ein Rezept/,
    )
    expect(store.collections()).toEqual([])
    expect(storage.objects.size).toBe(0)
    expect(data.recipe.id).toBe('r1')
  })

  it('refuses to restore into a non-empty cloud dataset', async () => {
    const data = await seedFixture()
    const { bytes } = await exportCloudBackup(store, storage)
    const inspection = await inspectBackup(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
      { compareLocal: false },
    )

    const before = store.list('recipes').length
    await expect(restoreCloudBackup(inspection, store, storage)).rejects.toThrow(
      /enthält bereits Daten/,
    )
    expect(store.list('recipes')).toHaveLength(before)
    expect(store.get<Recipe>('recipes', data.recipe.id)?.data.importId).toBe('mela-r1')
  })

  it('cleans up images when the metadata transaction fails', async () => {
    const data = await seedFixture()
    const { bytes } = await exportCloudBackup(store, storage)
    const inspection = await inspectBackup(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
      { compareLocal: false },
    )

    backend = new TestRecordsBackend()
    store = await createTestStore(backend)
    storage = new TestStorage()
    backend.failNext = new Error('Metadaten-Transaktion fehlgeschlagen')

    await expect(restoreCloudBackup(inspection, store, storage)).rejects.toThrow(
      /Metadaten-Transaktion/,
    )
    expect(store.collections()).toEqual([])
    expect(storage.objects.size).toBe(0)
    expect(data.recipe.id).toBe('r1')
  })

  it('cleans up images when an upload fails', async () => {
    const data = await seedFixture()
    const { bytes } = await exportCloudBackup(store, storage)
    const inspection = await inspectBackup(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
      { compareLocal: false },
    )

    backend = new TestRecordsBackend()
    store = await createTestStore(backend)
    storage = new TestStorage()
    storage.failUpload = new Error('Upload fehlgeschlagen')

    await expect(restoreCloudBackup(inspection, store, storage)).rejects.toThrow(
      /beim Hochladen/,
    )
    expect(store.collections()).toEqual([])
    expect(storage.objects.size).toBe(0)
    expect(data.recipe.id).toBe('r1')
  })

  it('removes leftovers from an interrupted earlier attempt before retrying', async () => {
    const data = await seedFixture()
    const { bytes } = await exportCloudBackup(store, storage)
    const inspection = await inspectBackup(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
      { compareLocal: false },
    )

    backend = new TestRecordsBackend()
    store = await createTestStore(backend)
    storage = new TestStorage()
    storage.objects.set('r1/img1', {
      bytes: new Uint8Array([9, 9, 9]),
      mimeType: 'image/png',
    })

    await restoreCloudBackup(inspection, store, storage)
    expect(new Uint8Array(await storage.download('r1/img1'))).toEqual(new Uint8Array([1, 2, 3]))
    expect(store.get('recipes', data.recipe.id)).toBeTruthy()
  })
})
