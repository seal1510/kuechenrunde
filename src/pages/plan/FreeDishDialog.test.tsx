import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { CookSession, FreeDish, MealPlanEntry } from '../../types'
import { FreeDishDialog } from './FreeDishDialog'

function freeDish(overrides: Partial<FreeDish> = {}): FreeDish {
  return {
    id: 'free-1',
    name: 'Nudeln mit Pesto',
    referenceServings: 3,
    ingredients: [
      {
        id: 'ing-1',
        groupId: null,
        position: 0,
        raw: '300 g Nudeln',
        name: 'Nudeln',
        quantity: 300,
        quantityText: '300',
        unit: 'g',
        purchaseNote: '',
        preparationNote: '',
        parseStatus: 'parsed',
        links: [],
      },
      {
        id: 'ing-2',
        groupId: null,
        position: 1,
        raw: '1 Glas Pesto',
        name: 'Pesto',
        quantity: 1,
        quantityText: '1',
        unit: 'Glas',
        purchaseNote: 'bevorzugt Barilla',
        preparationNote: '',
        parseStatus: 'parsed',
        links: [],
      },
      {
        id: 'ing-3',
        groupId: null,
        position: 2,
        raw: '50 g Parmesan',
        name: 'Parmesan',
        quantity: 50,
        quantityText: '50',
        unit: 'g',
        purchaseNote: '',
        preparationNote: 'frisch gerieben',
        parseStatus: 'parsed',
        links: [],
      },
    ],
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }
}

function entry(id: string, date: string, servings: number): MealPlanEntry {
  return {
    id,
    date,
    slot: 'dinner',
    recipeId: null,
    freeDishId: 'free-1',
    servings,
    position: 0,
    cookSessionId: 'cook-1',
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

function session(overrides: Partial<CookSession> = {}): CookSession {
  return {
    id: 'cook-1',
    recipeId: null,
    freeDishId: 'free-1',
    date: '2026-05-28',
    servings: 5,
    status: 'planned',
    auto: false,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }
}

describe('free dish planning dialog', () => {
  it('creates a free dish with the clicked day preselected and the planned total as reference', () => {
    const html = renderToStaticMarkup(
      <FreeDishDialog
        mode="create"
        initialDate="2026-05-29"
        initialEntries={[]}
        weekStartDay={3}
        onDone={() => undefined}
        onClose={() => undefined}
      />,
    )

    expect(html).toContain('Freies Gericht einplanen')
    expect(html).toContain('Name des Gerichts')
    expect(html.match(/dish-day-choice/g)).toHaveLength(7)
    expect(html).toContain('aria-pressed="true"')
    expect(html).toContain('29.05.')
    expect(html).toContain('Zutatenmengen für')
    expect(html).toContain('value="2"')
    expect(html).toContain('>Zutaten<')
    expect(html).toContain('Zutat hinzufügen')
    expect(html).toContain('Keine Zutaten hinterlegt.')
    expect(html).not.toContain('type="date"')
  })

  it('edits name, every stored day, the persisted reference and all ingredient notes', () => {
    const html = renderToStaticMarkup(
      <FreeDishDialog
        mode="edit"
        initialDate="2026-05-28"
        initialEntries={[entry('meal-1', '2026-05-28', 2), entry('meal-2', '2026-05-31', 3)]}
        session={session()}
        freeDish={freeDish()}
        weekStartDay={3}
        onMoveRequest={() => undefined}
        onDone={() => undefined}
        onClose={() => undefined}
      />,
    )

    expect(html).toContain('Gericht bearbeiten')
    expect(html).toContain('role="dialog"')
    expect(html).toContain('plan-panel')
    expect(html).toContain('value="Nudeln mit Pesto"')
    expect(html.match(/dish-day-choice/g)).toHaveLength(7)
    expect(html).toContain('Do, 28.05.')
    expect(html).toContain('So, 31.05.')
    expect(html).toContain('5 Portionen')
    expect(html).toContain('Zutatenmengen für')
    expect(html).toContain('value="3"')
    expect(html).toContain('value="300"')
    expect(html).toContain('value="bevorzugt Barilla"')
    expect(html).toContain('value="frisch gerieben"')
    expect(html).toContain('Zutaten für 5 Portionen')
    expect(html).toContain('500 g Nudeln')
    expect(html).toContain('Verschieben')
    expect(html).toContain('Ganze Planung entfernen')
  })

  it('offers the shared move action without a drag handle', () => {
    const html = renderToStaticMarkup(
      <FreeDishDialog
        mode="edit"
        initialDate="2026-05-28"
        initialEntries={[entry('meal-1', '2026-05-28', 2)]}
        session={session({ servings: 2 })}
        freeDish={freeDish({ referenceServings: 2 })}
        weekStartDay={3}
        onMoveRequest={() => undefined}
        onDone={() => undefined}
        onClose={() => undefined}
      />,
    )

    expect(html).toContain('Verschieben')
    expect(html).not.toContain('calendar-drag-handle')
  })
})
