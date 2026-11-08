import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  CookSession,
  Ingredient,
  Recipe,
  ShoppingManualItem,
  ShoppingPurchase,
} from '../types'
import { ShoppingPage } from './ShoppingPage'

const live = vi.hoisted(() => {
  let call = 0
  let values: unknown[] = []
  return {
    reset: (next: unknown[]) => {
      call = 0
      values = next
    },
    next: () => {
      // recipes, freeDishes, cookSessions, manualItems, purchases, rules,
      // quantityCorrections, settings
      const index = call % 8
      call += 1
      return values[index]
    },
  }
})

vi.mock('dexie-react-hooks', () => ({
  useLiveQuery: () => live.next(),
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
    unit: 'Stück',
    purchaseNote: '',
    preparationNote: '',
    parseStatus: 'parsed',
    links: [],
    ...overrides,
  }
}

function recipe(overrides: Partial<Recipe> = {}): Recipe {
  return {
    id: 'r1',
    importId: 'mela-r1',
    importSource: 'mela',
    title: 'Bolognese',
    description: '',
    ingredientGroups: [],
    ingredients: [ingredient()],
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
    updatedAt: 1,
    ...overrides,
  }
}

function session(overrides: Partial<CookSession> = {}): CookSession {
  return {
    id: 's1',
    recipeId: 'r1',
    date: '2026-05-07',
    servings: 2,
    status: 'planned',
    auto: false,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }
}

function manual(overrides: Partial<ShoppingManualItem> = {}): ShoppingManualItem {
  return {
    id: 'm1',
    weekStart: '2026-05-07',
    name: 'Milch',
    quantityText: '1',
    unit: 'l',
    purchaseNote: '',
    categoryId: null,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }
}

function baseValues(overrides: Partial<Record<string, unknown>> = {}): unknown[] {
  return [
    overrides.recipes ?? [],
    overrides.freeDishes ?? [],
    overrides.cookSessions ?? [],
    overrides.manualItems ?? [],
    overrides.purchases ?? [],
    overrides.rules ?? [],
    overrides.quantityCorrections ?? [],
    overrides.settings ?? [],
  ]
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(2026, 4, 7, 12, 0, 0))
})

afterEach(() => {
  vi.useRealTimers()
})

describe('shopping page', () => {
  it('renders a compact page with a closed add form and no pantry UI', () => {
    live.reset(baseValues())
    const html = renderToStaticMarkup(<ShoppingPage />)

    expect(html).toContain('Einkaufsliste')
    expect(html).toContain('Noch nichts zu kaufen')
    expect(html).toContain('Artikel hinzufügen')
    expect(html).toContain('aria-label="Einstellungen"')
    // The manual form is closed by default and no pantry entry point exists.
    expect(html).not.toContain('placeholder="z. B. Milch"')
    expect(html).not.toContain('Vorrat')
    expect(html).not.toContain('Trotzdem kaufen')
  })

  it('derives recipe demand from the planned cooking event', () => {
    live.reset(baseValues({ recipes: [recipe()], cookSessions: [session()] }))
    const html = renderToStaticMarkup(<ShoppingPage />)

    expect(html).toContain('Zwiebeln')
    expect(html).toContain('2 Stück')
    expect(html).toContain('Obst &amp; Gemüse')
    expect(html).not.toContain('Noch nichts zu kaufen')
  })

  it('cleans an old preparation note and shows the purchase note', () => {
    live.reset(
      baseValues({
        recipes: [
          recipe({
            ingredients: [
              ingredient({
                name: 'Zwiebeln (fein gewürfelt)',
                purchaseNote: 'bevorzugt rot',
              }),
            ],
          }),
        ],
        cookSessions: [session()],
      }),
    )
    const html = renderToStaticMarkup(<ShoppingPage />)

    expect(html).toContain('Zwiebeln')
    expect(html).toContain('bevorzugt rot')
    expect(html).not.toContain('fein gewürfelt')
  })

  it('shows manual articles in their category even without recipes', () => {
    live.reset(baseValues({ manualItems: [manual({ categoryId: 'dairy' })] }))
    const html = renderToStaticMarkup(<ShoppingPage />)

    expect(html).toContain('Milch')
    expect(html).toContain('1 l')
    expect(html).toContain('Milchprodukte &amp; Eier')
  })

  it('puts checked articles into the compact done area', () => {
    const purchase: ShoppingPurchase = {
      id: 'p1',
      shoppingDate: '2026-05-07',
      itemKey: 'zwiebel',
      amounts: [{ dimension: 'count', lower: 2, upper: 2 }],
      snapshot: [{ dimension: 'count', lower: 2, upper: 2 }],
      qualitative: false,
      createdAt: 1,
      updatedAt: 1,
    }
    live.reset(
      baseValues({ recipes: [recipe()], cookSessions: [session()], purchases: [purchase] }),
    )
    const html = renderToStaticMarkup(<ShoppingPage />)

    expect(html).toContain('<details class="shopping-done">')
    expect(html).toContain('Erledigt')
    expect(html).toContain('shopping-row-amount">2 Stück</span>')
    expect(html).not.toContain('Noch nichts zu kaufen')
  })

  it('keeps a checked article in the compact done area', () => {
    const purchase: ShoppingPurchase = {
      id: 'p1',
      shoppingDate: '2026-05-07',
      itemKey: 'zwiebel',
      amounts: [{ dimension: 'count', lower: 2, upper: 2 }],
      confirmedTotal: [{ dimension: 'count', lower: 2, upper: 2 }],
      snapshot: [{ dimension: 'count', lower: 2, upper: 2 }],
      qualitative: false,
      createdAt: 1,
      updatedAt: 1,
    }
    live.reset(
      baseValues({ recipes: [recipe()], cookSessions: [session()], purchases: [purchase] }),
    )
    const html = renderToStaticMarkup(<ShoppingPage />)
    expect(html).toContain('Zwiebeln wieder auf die Liste')
    expect(html).toContain('shopping-done-list')
  })

  it('uses user-corrected purchase hints instead of hidden recipe hints', () => {
    live.reset(
      baseValues({
        recipes: [
          recipe({
            ingredients: [
              ingredient({ name: 'Zwiebeln', purchaseNote: 'bevorzugt Mutti' }),
            ],
          }),
        ],
        cookSessions: [session()],
        rules: [
          {
            key: 'zwiebel',
            canonicalKey: 'zwiebel',
            displayName: '',
            categoryId: 'produce',
            purchaseNote: 'Bio',
            purchaseNoteOverride: false,
            hiddenPurchaseNotes: ['bevorzugt Mutti'],
            updatedAt: 1,
          },
        ],
      }),
    )
    const html = renderToStaticMarkup(<ShoppingPage />)
    expect(html).toContain('shopping-row-note">Bio</span>')
    expect(html).not.toContain('bevorzugt Mutti')
  })

  it('renders calm rows with a checkbox, a right-aligned amount and an edit target', () => {
    live.reset(
      baseValues({
        recipes: [
          recipe({
            ingredients: [
              ingredient({
                name: 'Rotwein (trocken, z. B. Dornfelder)',
                quantityText: 'ca. 200',
                unit: 'ml',
                purchaseNote: '',
              }),
            ],
          }),
        ],
        cookSessions: [session()],
      }),
    )
    const html = renderToStaticMarkup(<ShoppingPage />)

    expect(html).toContain('Rotwein')
    expect(html).toContain('trocken, z. B. Dornfelder')
    expect(html).toContain('ca. 200 ml')
    expect(html).toContain('class="shopping-row-amount"')
    expect(html).toContain('aria-label="Rotwein, ca. 200 ml bearbeiten"')
    expect(html).toContain('aria-label="Rotwein abhaken"')
    expect(html).not.toContain('Menge offen')
    // The name and amount are not collapsed into one loud title line.
    expect(html).toContain('class="shopping-row-name"')
  })

  it('shows product variants as distinct rows with a secondary variant line', () => {
    live.reset(
      baseValues({
        recipes: [
          recipe({
            ingredients: [
              ingredient({ name: 'Pesto (grün)', quantityText: '1', unit: 'Glas' }),
              ingredient({ name: 'Pesto (rot)', quantityText: '1', unit: 'Glas' }),
            ],
          }),
        ],
        cookSessions: [session()],
      }),
    )
    const html = renderToStaticMarkup(<ShoppingPage />)
    expect(html.match(/>Pesto</g)?.length).toBe(2)
    expect(html).toContain('Variante: grün')
    expect(html).toContain('Variante: rot')
  })

  it('applies a week-scoped quantity correction to the visible row', () => {
    live.reset(
      baseValues({
        recipes: [
          recipe({
            ingredients: [ingredient({ name: 'Mehl', quantityText: '500', unit: 'g' })],
          }),
        ],
        cookSessions: [session()],
        quantityCorrections: [
          {
            id: 'mehl::2026-05-07::mass',
            shoppingDate: '2026-05-07',
            itemKey: 'mehl',
            dimension: 'mass',
            quantityText: '1',
            unit: 'kg',
            sourceSignature: 'mass|500|500|',
            createdAt: 1,
            updatedAt: 1,
          },
        ],
      }),
    )
    const html = renderToStaticMarkup(<ShoppingPage />)
    expect(html).toContain('Mehl')
    expect(html).toContain('1 kg')
    expect(html).not.toContain('500 g')
  })

  it('does not render cooking-purpose lines as products', () => {
    live.reset(
      baseValues({
        recipes: [
          recipe({
            ingredients: [
              ingredient({ name: 'evtl. etwas Wasser zum Nachgießen' }),
              ingredient({ name: 'Zwiebeln', quantityText: '2', unit: 'Stück' }),
            ],
          }),
        ],
        cookSessions: [session()],
      }),
    )
    const html = renderToStaticMarkup(<ShoppingPage />)

    expect(html).toContain('Zwiebeln')
    expect(html).not.toContain('Nachgießen')
    expect(html).not.toContain('Wasser')
  })

  it('omits technical wording for articles without a quantity', () => {
    live.reset(
      baseValues({
        manualItems: [
          manual({ name: 'Toilettenpapier', quantityText: null, unit: null }),
        ],
      }),
    )
    const html = renderToStaticMarkup(<ShoppingPage />)
    expect(html).toContain('Toilettenpapier')
    expect(html).not.toContain('Menge offen')
    expect(html).not.toContain('ohne Mengenangabe')
  })
})
