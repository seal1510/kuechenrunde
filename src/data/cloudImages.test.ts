import { beforeEach, describe, expect, it } from 'vitest'
import type { Recipe } from '../types'
import type { EditorImage } from '../recipe/repository'
import {
  CloudConflictError,
  CloudImageError,
} from './cloudErrors'
import { CloudRecipeImageService, IMAGES_COLLECTION } from './cloudImages'
import {
  CloudRecordsStore,
  type ApplyOpsPayload,
  type ApplyOpsResult,
  type RecordChange,
  type RecordRow,
  type RecordsBackend,
  type RecordsSubscriptionHandlers,
} from './cloudRecords'
import type { ImageStoragePort } from './imageStorage'

function bytes(values: number[]): ArrayBuffer {
  return new Uint8Array(values).buffer as ArrayBuffer
}

function recipe(id: string, title: string, updatedAt: number): Recipe {
  return {
    id,
    importId: `manual-${id}`,
    importSource: 'manual',
    title,
    description: '',
    ingredientGroups: [],
    ingredients: [],
    instructions: [],
    servingsText: '2',
    servingsNumber: 2,
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
    updatedAt,
  }
}

function image(id: string, value: number, mimeType = 'image/png'): EditorImage {
  return {
    id,
    name: `${id}.png`,
    bytes: bytes([value, value]),
    mimeType,
  }
}

function storedImage(meta: {
  id: string
  storagePath: string
  mimeType?: string
  size?: number
}): EditorImage {
  return {
    id: meta.id,
    mimeType: meta.mimeType ?? 'image/png',
    storagePath: meta.storagePath,
    size: meta.size ?? 2,
  }
}

function rowKey(collection: string, id: string): string {
  return `${collection}\u0000${id}`
}

class TestBackend implements RecordsBackend {
  readonly rows = new Map<string, RecordRow>()
  readonly calls: ApplyOpsPayload[] = []
  failNext: Error | null = null
  dropResponseNext = false
  private handlers: RecordsSubscriptionHandlers | null = null

  async snapshot(): Promise<RecordRow[]> {
    return [...this.rows.values()].map((row) => structuredClone(row))
  }

  async fetch(collection: string, id: string): Promise<RecordRow | null> {
    const row = this.rows.get(rowKey(collection, id))
    return row ? structuredClone(row) : null
  }

  async applyOps(payload: ApplyOpsPayload): Promise<ApplyOpsResult> {
    this.calls.push(structuredClone(payload))
    if (this.failNext) {
      const error = this.failNext
      this.failNext = null
      throw error
    }

    const next = new Map(this.rows)
    const applied: ApplyOpsResult['applied'] = []
    const deleted: ApplyOpsResult['deleted'] = []

    for (const collection of payload.clear) {
      for (const [key, row] of next) {
        if (row.collection === collection) next.delete(key)
      }
    }

    for (const upsert of payload.upserts) {
      const key = rowKey(upsert.collection, upsert.id)
      const current = next.get(key)
      if (upsert.expected_rev === 0) {
        if (current) throw new CloudConflictError()
        next.set(key, {
          collection: upsert.collection,
          id: upsert.id,
          rev: 1,
          data: structuredClone(upsert.data),
        })
        applied.push({ collection: upsert.collection, id: upsert.id, rev: 1 })
        continue
      }
      if (!current || current.rev !== upsert.expected_rev) {
        throw new CloudConflictError()
      }
      const rev = current.rev + 1
      next.set(key, {
        collection: upsert.collection,
        id: upsert.id,
        rev,
        data: structuredClone(upsert.data),
      })
      applied.push({ collection: upsert.collection, id: upsert.id, rev })
    }

    for (const remove of payload.deletes) {
      const key = rowKey(remove.collection, remove.id)
      const current = next.get(key)
      if (!current) continue
      if (remove.expected_rev !== null && current.rev !== remove.expected_rev) {
        throw new CloudConflictError()
      }
      next.delete(key)
      deleted.push({ collection: remove.collection, id: remove.id })
    }

    this.rows.clear()
    for (const [key, row] of next) this.rows.set(key, row)

    if (this.dropResponseNext) {
      this.dropResponseNext = false
      throw new Error('Antwort verloren')
    }
    return { applied, deleted }
  }

  subscribe(handlers: RecordsSubscriptionHandlers): () => void {
    this.handlers = handlers
    return () => {
      this.handlers = null
    }
  }

  emit(change: RecordChange): void {
    this.handlers?.onChange(change)
  }

  writeDirect(collection: string, id: string, data: unknown): RecordRow {
    const key = rowKey(collection, id)
    const current = this.rows.get(key)
    const row: RecordRow = {
      collection,
      id,
      rev: (current?.rev ?? 0) + 1,
      data: structuredClone(data),
    }
    this.rows.set(key, row)
    return row
  }

  row(collection: string, id: string): RecordRow | undefined {
    return this.rows.get(rowKey(collection, id))
  }
}

class TestStorage implements ImageStoragePort {
  readonly objects = new Map<string, { bytes: Uint8Array; mimeType: string }>()
  readonly uploads: string[] = []
  readonly removals: string[][] = []
  readonly signedRequests: string[] = []
  failUpload: Error | null = null
  failSigned: Error | null = null
  failRemove: Error | null = null

  async upload(path: string, value: ArrayBuffer, mimeType: string): Promise<void> {
    if (this.failUpload) {
      const error = this.failUpload
      this.failUpload = null
      throw error
    }
    if (this.objects.has(path)) throw new Error(`Pfad existiert bereits: ${path}`)
    this.uploads.push(path)
    this.objects.set(path, {
      bytes: new Uint8Array(value),
      mimeType,
    })
  }

  async createSignedUrl(path: string, expiresInSeconds: number): Promise<string> {
    this.signedRequests.push(path)
    if (this.failSigned) throw this.failSigned
    if (!this.objects.has(path)) throw new Error(`Datei fehlt: ${path}`)
    return `https://signed.invalid/${encodeURIComponent(path)}?expires=${expiresInSeconds}`
  }

  async remove(paths: readonly string[]): Promise<void> {
    this.removals.push([...paths])
    if (this.failRemove) {
      const error = this.failRemove
      this.failRemove = null
      throw error
    }
    for (const path of paths) this.objects.delete(path)
  }
}

describe('CloudRecipeImageService', () => {
  let backend: TestBackend
  let store: CloudRecordsStore
  let storage: TestStorage
  let service: CloudRecipeImageService
  let now: number

  beforeEach(async () => {
    now = 10_000
    backend = new TestBackend()
    store = new CloudRecordsStore(backend)
    await store.load()
    storage = new TestStorage()
    service = new CloudRecipeImageService({
      records: store,
      storage,
      now: () => now++,
    })
  })

  async function save(
    nextRecipe: Recipe,
    images: EditorImage[],
    options: { isNew?: boolean; expectedRev?: number } = {},
  ) {
    const rev = store.get('recipes', nextRecipe.id)?.rev
    return service.saveRecipeImages({
      recipe: nextRecipe,
      images,
      isNew: options.isNew ?? rev === undefined,
      expectedRev: options.expectedRev ?? rev,
    })
  }

  it('legt ein Rezept mit mehreren Bildern und Metadaten an', async () => {
    const result = await save(recipe('r1', 'Curry', 20), [
      image('img-a', 1),
      image('img-b', 2, 'image/jpeg'),
    ])

    expect(result.warnings).toEqual([])
    expect([...storage.objects.keys()]).toEqual(['r1/img-a', 'r1/img-b'])
    expect(new Uint8Array(storage.objects.get('r1/img-a')!.bytes)).toEqual(
      new Uint8Array([1, 1]),
    )

    const metadata = service.listForRecipe('r1')
    expect(metadata.map((entry) => entry.id)).toEqual(['img-a', 'img-b'])
    expect(metadata.map((entry) => entry.position)).toEqual([0, 1])
    expect(metadata[0]).toMatchObject({
      recipeId: 'r1',
      storagePath: 'r1/img-a',
      mimeType: 'image/png',
      size: 2,
    })
    expect(store.get<Recipe>('recipes', 'r1')?.data.title).toBe('Curry')
    expect(store.list(IMAGES_COLLECTION)).toHaveLength(2)
  })

  it('lädt bestehende Bilder über ihre Metadaten und behält die Reihenfolge', async () => {
    await save(recipe('r1', 'Curry', 20), [image('img-a', 1), image('img-b', 2)])
    now = 20_000

    const result = await save(
      recipe('r1', 'Curry neu', 30),
      [
        storedImage({ id: 'img-b', storagePath: 'r1/img-b' }),
        storedImage({ id: 'img-a', storagePath: 'r1/img-a' }),
      ],
      { isNew: false, expectedRev: 1 },
    )

    expect(result.warnings).toEqual([])
    expect(storage.uploads).toEqual(['r1/img-a', 'r1/img-b'])
    const metadata = service.listForRecipe('r1')
    expect(metadata.map((entry) => entry.id)).toEqual(['img-b', 'img-a'])
    expect(metadata.map((entry) => entry.position)).toEqual([0, 1])
    expect(storage.removals).toEqual([])
  })

  it('entfernt beim Speichern nicht mehr gewählte Metadaten und Dateien', async () => {
    await save(recipe('r1', 'Curry', 20), [image('img-a', 1), image('img-b', 2)])
    now = 20_000

    const result = await save(
      recipe('r1', 'Curry ohne zweites Bild', 30),
      [storedImage({ id: 'img-a', storagePath: 'r1/img-a' })],
      { isNew: false, expectedRev: 1 },
    )

    expect(result.warnings).toEqual([])
    expect(service.listForRecipe('r1').map((entry) => entry.id)).toEqual(['img-a'])
    expect(storage.objects.has('r1/img-a')).toBe(true)
    expect(storage.objects.has('r1/img-b')).toBe(false)
    expect(storage.removals).toEqual([['r1/img-b']])
  })

  it('ersetzt ein Bild über einen neuen Pfad und löscht die alte Datei erst danach', async () => {
    await save(recipe('r1', 'Curry', 20), [image('img-a', 1)])
    const oldPath = service.listForRecipe('r1')[0]!.storagePath
    now = 20_000

    const result = await save(
      recipe('r1', 'Curry neu', 30),
      [
        {
          ...storedImage({ id: 'img-a', storagePath: oldPath }),
          bytes: bytes([9, 9, 9]),
          mimeType: 'image/png',
        },
      ],
      { isNew: false, expectedRev: 1 },
    )

    expect(result.warnings).toEqual([])
    const replacement = service.listForRecipe('r1')[0]!
    expect(replacement.storagePath).not.toBe(oldPath)
    expect(replacement.size).toBe(3)
    expect(storage.objects.has(oldPath)).toBe(false)
    expect(storage.objects.has(replacement.storagePath)).toBe(true)
    expect(new Uint8Array(storage.objects.get(replacement.storagePath)!.bytes)).toEqual(
      new Uint8Array([9, 9, 9]),
    )
  })

  it('lässt beim fehlgeschlagenen Ersetzen das bisherige Bild unangetastet', async () => {
    await save(recipe('r1', 'Curry', 20), [image('img-a', 1)])
    const before = service.listForRecipe('r1')[0]!
    now = 20_000
    backend.failNext = new Error('Metadaten nicht gespeichert')

    await expect(
      save(
        recipe('r1', 'Curry neu', 30),
        [
          {
            ...storedImage({ id: 'img-a', storagePath: before.storagePath }),
            bytes: bytes([9, 9, 9]),
          },
        ],
        { isNew: false, expectedRev: 1 },
      ),
    ).rejects.toThrow()

    const after = service.listForRecipe('r1')[0]!
    expect(after).toEqual(before)
    expect(storage.objects.has(before.storagePath)).toBe(true)
    expect(storage.objects.size).toBe(1)
    expect(storage.uploads).toHaveLength(2)
    expect(storage.removals).toEqual([[storage.uploads[1]!]])
  })

  it('entfernt neu hochgeladene Dateien, wenn die Metadaten-Transaktion scheitert', async () => {
    backend.failNext = new Error('Metadaten nicht gespeichert')

    await expect(
      save(recipe('r1', 'Curry', 20), [image('img-a', 1)], { isNew: true }),
    ).rejects.toThrow()

    expect(store.get<Recipe>('recipes', 'r1')).toBeUndefined()
    expect(service.listForRecipe('r1')).toEqual([])
    expect(storage.objects.size).toBe(0)
    expect(storage.removals).toEqual([['r1/img-a']])
  })

  it('meldet einen fehlgeschlagenen Upload ohne Rezept- oder Metadatenänderung', async () => {
    await save(recipe('r1', 'Curry', 20), [image('img-a', 1)])
    storage.failUpload = new Error('Storage nicht erreichbar')
    now = 20_000

    await expect(
      save(
        recipe('r1', 'Curry neu', 30),
        [
          storedImage({ id: 'img-a', storagePath: 'r1/img-a' }),
          image('img-b', 2),
        ],
        { isNew: false, expectedRev: 1 },
      ),
    ).rejects.toThrow(/Storage nicht erreichbar/)

    expect(store.get<Recipe>('recipes', 'r1')?.data.title).toBe('Curry')
    expect(service.listForRecipe('r1').map((entry) => entry.id)).toEqual(['img-a'])
    expect(storage.objects.has('r1/img-b')).toBe(false)
  })

  it('meldet fehlgeschlagenes Storage-Löschen als Warnung, ohne Metadaten zu verlieren', async () => {
    await save(recipe('r1', 'Curry', 20), [image('img-a', 1), image('img-b', 2)])
    storage.failRemove = new Error('Löschen verweigert')
    now = 20_000

    const result = await save(
      recipe('r1', 'Curry neu', 30),
      [storedImage({ id: 'img-a', storagePath: 'r1/img-a' })],
      { isNew: false, expectedRev: 1 },
    )

    expect(result.warnings.length).toBeGreaterThan(0)
    expect(result.warnings.join(' ')).toMatch(/konnte nicht aus dem Speicher entfernt werden/)
    expect(service.listForRecipe('r1').map((entry) => entry.id)).toEqual(['img-a'])
    expect(storage.objects.has('r1/img-b')).toBe(true)
  })

  it('löscht Rezept, Bildmetadaten und Dateien gemeinsam', async () => {
    await save(recipe('r1', 'Curry', 20), [image('img-a', 1), image('img-b', 2)])

    const result = await service.deleteRecipe('r1', 1)

    expect(result.warnings).toEqual([])
    expect(store.get<Recipe>('recipes', 'r1')).toBeUndefined()
    expect(service.listForRecipe('r1')).toEqual([])
    expect(storage.objects.size).toBe(0)
    expect(storage.removals.at(-1)?.sort()).toEqual(['r1/img-a', 'r1/img-b'])
  })

  it('meldet beim Rezeptlöschen ein fehlgeschlagenes Dateilöschen sichtbar', async () => {
    await save(recipe('r1', 'Curry', 20), [image('img-a', 1), image('img-b', 2)])
    storage.failRemove = new Error('Löschen verweigert')

    const result = await service.deleteRecipe('r1', 1)

    expect(result.warnings.length).toBeGreaterThan(0)
    expect(store.get<Recipe>('recipes', 'r1')).toBeUndefined()
    expect(service.listForRecipe('r1')).toEqual([])
    expect(storage.objects.size).toBe(2)
  })

  it('bricht bei einer parallelen Rezeptänderung ab und räumt neue Dateien auf', async () => {
    await save(recipe('r1', 'Curry', 20), [image('img-a', 1)])
    const before = service.listForRecipe('r1')[0]!
    now = 20_000

    const changed = recipe('r1', 'Von jemand anderem', 25)
    const row = backend.writeDirect('recipes', 'r1', changed)
    backend.emit({ type: 'upsert', row })

    await expect(
      save(
        recipe('r1', 'Meine Änderung', 30),
        [
          storedImage({ id: 'img-a', storagePath: before.storagePath }),
          image('img-b', 2),
        ],
        { isNew: false, expectedRev: 1 },
      ),
    ).rejects.toThrow(/zwischenzeitlich/)

    expect(service.listForRecipe('r1').map((entry) => entry.id)).toEqual(['img-a'])
    expect(storage.objects.has('r1/img-b')).toBe(false)
    expect(storage.objects.has(before.storagePath)).toBe(true)
    expect(store.get<Recipe>('recipes', 'r1')?.data.title).toBe('Von jemand anderem')
  })

  it('übernimmt Realtime-Änderungen an Bildmetadaten', async () => {
    await save(recipe('r1', 'Curry', 20), [image('img-a', 1), image('img-b', 2)])
    const metaA = service.listForRecipe('r1')[0]!
    const row = backend.writeDirect(IMAGES_COLLECTION, 'img-a', {
      ...metaA,
      position: 2,
      updatedAt: 99,
    })
    backend.emit({ type: 'upsert', row })

    expect(service.listForRecipe('r1').map((entry) => entry.id)).toEqual([
      'img-b',
      'img-a',
    ])
    expect(service.listForRecipe('r1')[1]?.position).toBe(2)

    backend.rows.delete(rowKey(IMAGES_COLLECTION, 'img-a'))
    backend.emit({
      type: 'delete',
      collection: IMAGES_COLLECTION,
      id: 'img-a',
      rev: row.rev,
    })
    expect(service.listForRecipe('r1').map((entry) => entry.id)).toEqual(['img-b'])
  })

  it('verweigert ungültige MIME-Typen und zu große Dateien vor dem Upload', async () => {
    await expect(
      save(recipe('r1', 'Curry', 20), [
        { ...image('img-a', 1), mimeType: 'image/svg+xml' },
      ]),
    ).rejects.toBeInstanceOf(CloudImageError)
    expect(storage.uploads).toEqual([])

    const tooLarge = new ArrayBuffer(10 * 1024 * 1024 + 1)
    await expect(
      save(recipe('r2', 'Groß', 20), [
        { id: 'img-gross', bytes: tooLarge, mimeType: 'image/png' },
      ]),
    ).rejects.toThrow(/10 MB/)
    expect(storage.uploads).toEqual([])
  })

  it('entfernt bereits hochgeladene Dateien, wenn ein späteres Bild ungültig ist', async () => {
    await expect(
      save(recipe('r1', 'Curry', 20), [
        image('img-a', 1),
        { ...image('img-b', 2), mimeType: 'image/svg+xml' },
      ]),
    ).rejects.toBeInstanceOf(CloudImageError)

    expect(storage.uploads).toEqual(['r1/img-a'])
    expect(storage.removals).toEqual([['r1/img-a']])
    expect(storage.objects.size).toBe(0)
    expect(store.get<Recipe>('recipes', 'r1')).toBeUndefined()
  })

  it('erkennt eine trotz verlorener Antwort gespeicherte Metadaten-Transaktion', async () => {
    backend.dropResponseNext = true

    const result = await save(recipe('r1', 'Curry', 20), [image('img-a', 1)], {
      isNew: true,
    })

    expect(result.warnings).toEqual([])
    expect(store.get<Recipe>('recipes', 'r1')?.data.title).toBe('Curry')
    expect(service.listForRecipe('r1')).toHaveLength(1)
    expect(storage.objects.has('r1/img-a')).toBe(true)
    expect(storage.removals).toEqual([])
  })
})
