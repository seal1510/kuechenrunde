/*
 * Küchenrunde – Tests des Cloud-Kochmodus
 * Copyright (C) 2026 openCook Web contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../db'
import { CookBackendProvider } from '../cook/cookBackend'
import { PlanBackendProvider } from '../mealplan/planBackend'
import { CookPage } from '../pages/CookPage'
import { DishDialog } from '../pages/plan/DishDialog'
import { loadCookProgress } from '../mealplan/cookProgress'
import type { CookSession, Ingredient, MealPlanEntry, Recipe } from '../types'
import { createCloudPlanBackend } from './cloudPlanBackend'
import { createCloudCookBackend, readCookData } from './cloudCookBackend'
import { createTestStore, TestRecordsBackend } from './recordsTestBackend'

vi.mock('../components/Markdown', () => ({
  Markdown: ({ text }: { text: string }) => {
    const plain = text
      .replace(/<span class="cook-ingredient-mention">/g, '')
      .replace(/<\/span>/g, '')
    return (
      <div data-markdown data-annotated={text}>
        {plain}
      </div>
    )
  },
}))

function ingredient(overrides: Partial<Ingredient> = {}): Ingredient {
  return {
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
    ...overrides,
  }
}

function recipe(): Recipe {
  return {
    id: 'r1',
    importId: 'manual-r1',
    importSource: 'manual',
    title: 'Cloud-Bolognese',
    description: '',
    ingredientGroups: [],
    ingredients: [
      ingredient(),
      ingredient({
        id: 'i2',
        position: 1,
        raw: '400 g Hackfleisch',
        name: 'Hackfleisch',
        quantity: 400,
        quantityText: '400',
        unit: 'g',
      }),
    ],
    instructions: [
      {
        id: 's1',
        position: 0,
        raw: 'Die 2 Zwiebeln fein würfeln.',
        text: 'Die 2 Zwiebeln fein würfeln.',
        references: [
          {
            id: 'ref1',
            ingredientId: 'i1',
            anchor: '2',
            anchorOffset: 4,
            quantity: { kind: 'full' },
          },
        ],
      },
      {
        id: 's2',
        position: 1,
        raw: '400 g Hackfleisch anbraten.',
        text: '400 g Hackfleisch anbraten.',
        references: [
          {
            id: 'ref2',
            ingredientId: 'i2',
            anchor: '400',
            anchorOffset: 0,
            quantity: { kind: 'full' },
          },
        ],
      },
    ],
    servingsText: '4',
    servingsNumber: 4,
    prepTime: '',
    cookTime: '',
    totalTime: '30 min',
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
  }
}

function cookSession(overrides: Partial<CookSession> = {}): CookSession {
  return {
    id: 's1',
    recipeId: 'r1',
    date: '2026-05-29',
    servings: 6,
    status: 'planned',
    auto: false,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }
}

function entry(): MealPlanEntry {
  return {
    id: 'meal-1',
    date: '2026-05-29',
    slot: 'dinner',
    recipeId: 'r1',
    servings: 6,
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
}

async function setup(seedSession = true) {
  const backend = new TestRecordsBackend()
  const rows: Array<[string, string, unknown]> = [['recipes', 'r1', recipe()]]
  if (seedSession) rows.push(['cookSessions', 's1', cookSession()])
  const store = await createTestStore(backend, rows)
  return {
    backend,
    store,
    cook: createCloudCookBackend(store),
    plan: createCloudPlanBackend(store),
  }
}

beforeEach(async () => {
  await db.cookProgress.clear()
})

describe('Cloud-Kochmodus – Daten', () => {
  it('lädt Rezept und geplanten Kochvorgang aus dem Cloud-Store', async () => {
    const { store } = await setup()
    const data = readCookData(store, 'r1', 's1')
    expect(data?.recipe?.title).toBe('Cloud-Bolognese')
    expect(data?.sessionServings).toBe(6)
    expect(data?.sessionId).toBe('s1')
    expect(data?.sessionMissing).toBe(false)
    expect(data?.loadError).toBeNull()
  })

  it('fällt bei fehlendem oder fremdem Kochvorgang auf das Rezept zurück', async () => {
    const { store } = await setup()
    const missing = readCookData(store, 'r1', 'gone')
    expect(missing?.sessionMissing).toBe(true)
    expect(missing?.sessionServings).toBeNull()
    expect(missing?.recipe?.title).toBe('Cloud-Bolognese')

    const backend = new TestRecordsBackend()
    const otherStore = await createTestStore(backend, [
      ['recipes', 'r1', recipe()],
      ['recipes', 'r2', { ...recipe(), id: 'r2' }],
      [
        'cookSessions',
        'other',
        cookSession({ id: 'other', recipeId: 'r2', servings: 8 }),
      ],
    ])
    const mismatched = readCookData(otherStore, 'r1', 'other')
    expect(mismatched?.sessionMissing).toBe(true)
    expect(mismatched?.sessionId).toBeNull()
    expect(mismatched?.sessionServings).toBeNull()
    expect(mismatched?.recipe?.title).toBe('Cloud-Bolognese')
  })

  it('übernimmt Realtime-Änderungen am geplanten Kochvorgang', async () => {
    const { backend, store } = await setup()
    expect(readCookData(store, 'r1', 's1')?.sessionServings).toBe(6)

    backend.emit({
      type: 'upsert',
      row: {
        collection: 'cookSessions',
        id: 's1',
        rev: 2,
        data: cookSession({ servings: 10 }),
      },
    })

    expect(readCookData(store, 'r1', 's1')?.sessionServings).toBe(10)
  })
})

describe('Cloud-Kochmodus – gerätelokaler Fortschritt', () => {
  it('speichert den Schrittfortschritt lokal, obwohl der Kochvorgang in der Cloud liegt', async () => {
    const { cook } = await setup()
    await cook.saveProgress('s1', 1)
    expect(await loadCookProgress('s1')).toBe(1)
    expect(await db.cookProgress.get('s1')).toMatchObject({ stepIndex: 1 })
  })

  it('schreibt keinen Fortschritt für einen nicht mehr vorhandenen Cloud-Kochvorgang', async () => {
    const { cook } = await setup()
    await cook.saveProgress('gone', 2)
    expect(await db.cookProgress.get('gone')).toBeUndefined()
  })

  it('bereinigt im Cloud-Modus keine lokalen Fortschritte anhand lokaler Plandaten', async () => {
    const { cook } = await setup()
    await db.cookProgress.put({
      cookSessionId: 'cloud-only',
      stepIndex: 3,
      updatedAt: 1,
    })

    expect(await cook.pruneOrphanedProgress()).toBe(0)
    expect(await db.cookProgress.get('cloud-only')).toMatchObject({ stepIndex: 3 })
  })
})

describe('Cloud-Kochmodus – Oberfläche und Navigation', () => {
  it('rendert den vorhandenen Kochmodus mit Cloud-Daten und skalierten Mengen', async () => {
    const { cook } = await setup()
    const html = renderToStaticMarkup(
      <CookBackendProvider value={cook}>
        <CookPage recipeId="r1" cookSessionId="s1" />
      </CookBackendProvider>,
    )

    expect(html).toContain('Cloud-Bolognese')
    expect(html).toContain('6 Portionen')
    expect(html).toContain('Die 3 Zwiebeln fein würfeln.')
    expect(html).toContain('Rezeptmenge: 3')
    expect(html).toContain('Schritt 1 von 2')
    expect(html).toContain('Küchentimer, öffnen')
    expect(html).toContain('Wachhalten')
    expect(html).toContain('Zum Essensplan')
  })

  it('verlinkt aus dem Cloud-Wochenplan in den Kochmodus des geplanten Gerichts', async () => {
    const { plan } = await setup()
    const html = renderToStaticMarkup(
      <PlanBackendProvider value={plan}>
        <DishDialog
          mode="edit"
          initialDate="2026-05-29"
          initialRecipeId="r1"
          initialEntries={[entry()]}
          session={cookSession()}
          recipes={[recipe()]}
          weekStartDay={0}
          cookModeEnabled={plan.cookModeEnabled}
          renderCover={() => null}
          onDone={() => undefined}
          onClose={() => undefined}
        />
      </PlanBackendProvider>,
    )

    expect(html).toContain('href="#/recipe/r1/cook?session=s1"')
    expect(html).toContain('Kochen')
  })
})
