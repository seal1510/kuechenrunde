import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ShoppingDistributionPosition } from '../domain/shoppingLists'
import type { ShoppingPageList } from '../shopping/pageView'
import type {
  CookSession,
  Ingredient,
  Recipe,
  ShoppingList,
  ShoppingManualItem,
  ShoppingPurchase,
} from '../types'
import { DistributionDialog, RowActionsMenu, ShoppingPage } from './ShoppingPage'

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
      // quantityCorrections, settings, shoppingLists, allocations
      const index = call % 10
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

function freeList(overrides: Partial<ShoppingList> = {}): ShoppingList {
  return {
    id: 'free-drogerie',
    kind: 'free',
    name: 'Drogerie',
    periodStart: null,
    periodEnd: null,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }
}

function standardPageList(): ShoppingPageList {
  return {
    id: 'standard:2026-05-07',
    kind: 'standard',
    name: 'Wocheneinkauf · 7.–13. Mai',
    periodStart: '2026-05-07',
    periodEnd: '2026-05-13',
    createdAt: 1,
    isStandard: true,
    openCount: 1,
    doneCount: 0,
    requiresReview: false,
  }
}

function marketPageList(): ShoppingPageList {
  return {
    id: 'free-markt',
    kind: 'free',
    name: 'Markt',
    periodStart: null,
    periodEnd: null,
    createdAt: 2,
    isStandard: false,
    openCount: 1,
    doneCount: 0,
    requiresReview: false,
  }
}

function tomatoDistribution(
  standard: ShoppingPageList,
  market: ShoppingPageList,
): ShoppingDistributionPosition[] {
  return [
    {
      itemKey: 'tomate',
      name: 'Tomaten',
      dimension: 'count',
      unit: 'Stück',
      qualifier: '',
      totalLower: 8,
      totalUpper: 8,
      standardLower: 3,
      standardUpper: 3,
      amounts: [
        { listId: market.id, lower: 5, upper: 5, explicit: true },
        { listId: standard.id, lower: 3, upper: 3, explicit: false },
      ],
      allocations: [
        {
          allocation: {
            id: 'alloc-market',
            periodStart: '2026-05-07',
            itemKey: 'tomate',
            dimension: 'count',
            listId: market.id,
            mode: 'partial',
            quantityMilli: 5000,
            createdAt: 1,
            updatedAt: 1,
          },
          listId: market.id,
          requestedMilli: 5000,
          effectiveLower: 5,
          effectiveUpper: 5,
          clamped: false,
          orphaned: false,
          shadowed: false,
          blocked: false,
        },
      ],
    },
  ]
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
    overrides.shoppingLists ?? [],
    overrides.allocations ?? [],
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

  it('shows the standard list and free lists in the overview', () => {
    live.reset(baseValues({ shoppingLists: [freeList()] }))
    const html = renderToStaticMarkup(<ShoppingPage />)

    expect(html).toContain('Einkaufszettel')
    expect(html).toContain('Drogerie')
    expect(html).toContain('0 offen · 0 erledigt')
    expect(html).toContain('Woche')
    expect(html).not.toContain('Standardzettel')
  })

  it('renders a compact move/split dialog with existing shares', () => {
    const standard = standardPageList()
    const market = marketPageList()
    const html = renderToStaticMarkup(
      <DistributionDialog
        itemKey="tomate"
        name="Tomaten"
        periodStart="2026-05-07"
        standardListId={standard.id}
        currentListId={market.id}
        positions={tomatoDistribution(standard, market)}
        lists={[standard, market]}
        onDone={() => undefined}
        onClose={() => undefined}
      />,
    )

    expect(html).toContain('Tomaten verteilen')
    expect(html).toContain('Benötigt: 8 Stück')
    expect(html).toContain('Wohin?')
    expect(html).toContain('Wie viel?')
    expect(html).toContain('>Alles<')
    expect(html).toContain('>Teilmenge<')
    expect(html).toContain('Bereits verteilt')
    expect(html).toContain('Markt:')
    expect(html).toContain('5 Stück')
    expect(html).toContain('3 Stück')
    expect(html).toContain('Alles verschieben')
    expect(html).toContain('Entfernen')
    expect(html).toContain('Verteilung zurücksetzen')
    expect(html).toContain('Abbrechen')
    expect(html).not.toContain('Aktuelle Verteilung')
    expect(html).not.toContain('Eigene Zuordnungen')
    expect(html).not.toContain('Gewicht')
  })

  it('renders the partial quantity fields and a specific action label', () => {
    const standard = standardPageList()
    const market = marketPageList()
    const html = renderToStaticMarkup(
      <DistributionDialog
        itemKey="tomate"
        name="Tomaten"
        periodStart="2026-05-07"
        standardListId={standard.id}
        currentListId={market.id}
        positions={tomatoDistribution(standard, market)}
        lists={[standard, market]}
        initialMode="partial"
        onDone={() => undefined}
        onClose={() => undefined}
      />,
    )

    expect(html).toContain('shopping-distribute-quantity')
    expect(html).toContain('aria-label="Teilmenge"')
    expect(html).toContain('aria-label="Einheit der Teilmenge"')
    expect(html).toContain('Der Rest bleibt auf dem Wocheneinkauf.')
    expect(html).toContain('5 Stück zuweisen')
  })

  it('exposes distribution through an accessible row action menu', () => {
    const html = renderToStaticMarkup(
      <RowActionsMenu
        label="Tomaten weitere Aktionen"
        defaultOpen
        actions={[
          { label: 'Verschieben / aufteilen', onSelect: () => undefined },
          { label: 'Bearbeiten', onSelect: () => undefined },
        ]}
      />,
    )

    expect(html).toContain('aria-haspopup="menu"')
    expect(html).toContain('aria-expanded="true"')
    expect(html).toContain('role="menu"')
    expect(html).toContain('Verschieben / aufteilen')
    expect(html).toContain('Bearbeiten')
  })

  it('derives recipe demand from the planned cooking event', () => {
    live.reset(baseValues({ recipes: [recipe()], cookSessions: [session()] }))
    const html = renderToStaticMarkup(<ShoppingPage />)

    expect(html).toContain('Zwiebeln')
    expect(html).toContain('2 Stück')
    expect(html).toContain('Obst &amp; Gemüse')
    expect(html).not.toContain('>Verteilen<')
    expect(html).toContain('Zwiebeln weitere Aktionen')
    expect(html).toContain('aria-haspopup="menu"')
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
    expect(html).toContain('shopping-row-note">grün</span>')
    expect(html).toContain('shopping-row-note">rot</span>')
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

  it('shows a legacy week conflict instead of treating the row as certainly done', () => {
    live.reset(
      baseValues({
        manualItems: [
          manual({
            id: 'legacy-conflict',
            shoppingDate: '2026-05-07',
            weekStart: '2026-05-02',
            legacyWeekAmbiguous: true,
          }),
        ],
      }),
    )
    const html = renderToStaticMarkup(<ShoppingPage />)
    expect(html).toContain('Einkaufszuordnung unklar')
    expect(html).toContain('1 Eintrag wird nicht als gekauft gewertet')
    expect(html).toContain('Milch')
  })
})
