import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { CookSession, MealPlanEntry, Recipe } from '../../types'
import { DishDialog } from './DishDialog'

function recipe(): Recipe {
  return {
    id: 'r1',
    importId: 'mela-r1',
    importSource: 'mela',
    title: 'Testgericht',
    description: '',
    ingredientGroups: [],
    ingredients: [
      {
        id: 'i1',
        groupId: null,
        position: 0,
        raw: '400 g Spaghetti',
        name: 'Spaghetti',
        quantity: 400,
        quantityText: '400',
        unit: 'g',
        parseStatus: 'parsed',
        links: [],
      },
    ],
    instructions: [],
    servingsText: '4 Portionen',
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

function entry(
  id: string,
  date: string,
  servings: number,
  cookSessionId?: string,
): MealPlanEntry {
  return {
    id,
    date,
    slot: 'dinner',
    recipeId: 'r1',
    servings,
    position: 0,
    ...(cookSessionId ? { cookSessionId } : {}),
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

function cookSession(id: string): CookSession {
  return {
    id,
    recipeId: 'r1',
    date: '2026-05-29',
    servings: 5,
    status: 'planned',
    auto: false,
    createdAt: 1,
    updatedAt: 1,
  }
}

describe('planning dialog day picker', () => {
  it('renders seven clickable day fields instead of native date inputs', () => {
    const html = renderToStaticMarkup(
      <DishDialog
        mode="create"
        initialDate="2026-05-29"
        initialRecipeId="r1"
        initialEntries={[]}
        recipes={[recipe()]}
        weekStartDay={3}
        onDone={() => undefined}
        onClose={() => undefined}
      />,
    )

    expect(html.match(/dish-day-choice/g)).toHaveLength(7)
    expect(html).not.toContain('type="date"')
    expect(html).toContain('aria-pressed="true"')
    expect(html).toContain('29.05.')
    expect(html).toContain('Fr, 29.05.')
    expect(html).toContain('Vorherige Woche')
    expect(html).toContain('Nächste Woche')
  })

  it('loads every stored day of a non-consecutive plan into the same dialog', () => {
    const html = renderToStaticMarkup(
      <DishDialog
        mode="edit"
        initialDate="2026-05-29"
        initialRecipeId="r1"
        initialEntries={[
          entry('friday', '2026-05-29', 2),
          entry('tuesday', '2026-06-02', 3),
        ]}
        recipes={[recipe()]}
        weekStartDay={3}
        onDone={() => undefined}
        onClose={() => undefined}
      />,
    )

    expect(html).toContain('Fr, 29.05.')
    expect(html).toContain('Di, 02.06.')
    expect(html).toContain('5 Portionen')
    expect(html).not.toContain('type="date"')
  })

  it('offers the keyboard-accessible move action without a drag handle', () => {
    const html = renderToStaticMarkup(
      <DishDialog
        mode="edit"
        initialDate="2026-05-29"
        initialRecipeId="r1"
        initialEntries={[entry('friday', '2026-05-29', 2)]}
        recipes={[recipe()]}
        weekStartDay={3}
        onMoveRequest={() => undefined}
        onDone={() => undefined}
        onClose={() => undefined}
      />,
    )

    expect(html).toContain('Verschieben')
    expect(html).not.toContain('calendar-drag-handle')
  })

  it('offers a new-recipe route when the library is empty', () => {
    const html = renderToStaticMarkup(
      <DishDialog
        mode="create"
        initialDate="2026-05-29"
        initialEntries={[]}
        recipes={[]}
        weekStartDay={3}
        onDone={() => undefined}
        onClose={() => undefined}
      />,
    )

    expect(html).toContain('Noch keine Rezepte vorhanden.')
    expect(html).toContain('Neues Rezept')
    expect(html).toContain('#/recipe/new')
  })
})

describe('cook mode entry from the week plan', () => {
  it('links to cook mode with the planned cooking event', () => {
    const html = renderToStaticMarkup(
      <DishDialog
        mode="edit"
        initialDate="2026-05-29"
        initialRecipeId="r1"
        initialEntries={[entry('friday', '2026-05-29', 2, 'cook-1')]}
        session={cookSession('cook-1')}
        recipes={[recipe()]}
        weekStartDay={3}
        onDone={() => undefined}
        onClose={() => undefined}
      />,
    )

    expect(html).toContain('href="#/recipe/r1/cook?session=cook-1"')
    expect(html).toContain('Kochen')
  })

  it('keeps cook mode reachable when the cooking event is missing', () => {
    const html = renderToStaticMarkup(
      <DishDialog
        mode="edit"
        initialDate="2026-05-29"
        initialRecipeId="r1"
        initialEntries={[entry('friday', '2026-05-29', 2, 'cook-gone')]}
        recipes={[recipe()]}
        weekStartDay={3}
        onDone={() => undefined}
        onClose={() => undefined}
      />,
    )

    expect(html).toContain('href="#/recipe/r1/cook?session=cook-gone"')
    expect(html).toContain('Kochen')
  })

  it('keeps cook mode reachable for a legacy plan without any cooking event', () => {
    const html = renderToStaticMarkup(
      <DishDialog
        mode="edit"
        initialDate="2026-05-29"
        initialRecipeId="r1"
        initialEntries={[entry('friday', '2026-05-29', 2)]}
        recipes={[recipe()]}
        weekStartDay={3}
        onDone={() => undefined}
        onClose={() => undefined}
      />,
    )

    expect(html).toContain('href="#/recipe/r1/cook"')
    expect(html).toContain('Kochen')
  })

  it('does not offer cook mode before a new dish is planned', () => {
    const html = renderToStaticMarkup(
      <DishDialog
        mode="create"
        initialDate="2026-05-29"
        initialRecipeId="r1"
        initialEntries={[]}
        recipes={[recipe()]}
        weekStartDay={3}
        onDone={() => undefined}
        onClose={() => undefined}
      />,
    )

    expect(html).not.toContain('href="#/recipe/r1/cook')
    expect(html).not.toContain('>Kochen<')
  })
})
