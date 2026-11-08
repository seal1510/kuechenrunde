import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Ingredient, Recipe } from '../types'
import {
  resolveOriginalServings,
  scaleRecipeIngredients,
  scaledIngredientAmount,
} from '../domain/scaling'
import { renderRecipeInstructions } from '../recipe/references'
import {
  CookOverview,
  CookPage,
  CookStepView,
  cookServingsAfterDelta,
  cookUiReducer,
  initialCookUiState,
  MIN_COOK_SERVINGS,
} from './CookPage'

const live = vi.hoisted(() => {
  let value: unknown
  return {
    reset: (next: unknown) => {
      value = next
    },
    next: () => value,
  }
})

vi.mock('dexie-react-hooks', () => ({
  useLiveQuery: () => live.next(),
}))

vi.mock('../components/Markdown', () => ({
  Markdown: ({ text }: { text: string }) => <div data-markdown>{text}</div>,
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

const ingredients: Ingredient[] = [
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
  ingredient({
    id: 'i3',
    position: 2,
    raw: '500 ml passierte Tomaten',
    name: 'passierte Tomaten',
    quantity: 500,
    quantityText: '500',
    unit: 'ml',
  }),
]

const recipe: Recipe = {
  id: 'r1',
  importId: 'mela-r1',
  importSource: 'mela',
  title: 'Bolognese',
  description: '',
  ingredientGroups: [],
  ingredients,
  instructions: [
    {
      id: 's1',
      position: 0,
      raw: 'Die 2 Zwiebeln fein würfeln.',
      text: 'Die 2 Zwiebeln fein würfeln.',
      references: [
        { id: 'r1', ingredientId: 'i1', anchor: '2', anchorOffset: 4, quantity: { kind: 'full' } },
      ],
    },
    {
      id: 's2',
      position: 1,
      raw: '400 g Hackfleisch kräftig anbraten.',
      text: '400 g Hackfleisch kräftig anbraten.',
      references: [
        {
          id: 'r2',
          ingredientId: 'i2',
          anchor: '400',
          anchorOffset: 0,
          quantity: { kind: 'full' },
        },
      ],
    },
  ],
  servingsText: '4 Portionen',
  servingsNumber: 4,
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
}

function cookData(sessionServings: number | null, sessionMissing = false) {
  return {
    recipe,
    sessionServings,
    sessionId: sessionServings === null ? null : 'cook-1',
    sessionMissing,
    loadError: null,
  }
}

function sortedSteps(value: Recipe) {
  return [...value.instructions].sort((a, b) => a.position - b.position)
}

function overviewMarkup(value: Recipe = recipe, targetServings = 6, currentIndex = 1) {
  const steps = sortedSteps(value)
  const originalServings = resolveOriginalServings(value)
  const rendered = renderRecipeInstructions(steps, value.ingredients, {
    originalServings,
    targetServings,
    autoScale: true,
  })
  const scaled = scaleRecipeIngredients(value.ingredients, originalServings, targetServings)
  const amounts = new Map(
    scaled.items.map((item) => [item.ingredient.id, scaledIngredientAmount(item)]),
  )
  const amountFor = (entry: Ingredient) => amounts.get(entry.id) ?? ''

  return renderToStaticMarkup(
    <CookOverview
      recipe={value}
      steps={steps}
      rendered={rendered}
      currentIndex={currentIndex}
      originalServings={originalServings}
      targetServings={targetServings}
      amountFor={amountFor}
      onSelectStep={() => undefined}
    />,
  )
}

function stepMarkup(value: Recipe = recipe, currentIndex = 0) {
  const steps = sortedSteps(value)
  const originalServings = resolveOriginalServings(value)
  const rendered = renderRecipeInstructions(steps, value.ingredients, {
    originalServings,
    targetServings: 6,
  })
  return renderToStaticMarkup(
    <CookStepView
      steps={steps}
      rendered={rendered}
      currentIndex={currentIndex}
      onPrevious={() => undefined}
      onNext={() => undefined}
      onSelectStep={() => undefined}
    />,
  )
}

beforeEach(() => {
  live.reset(cookData(null))
})

describe('cook mode entry and display', () => {
  it('starts from the library with the original portions and one clear exit', () => {
    const html = renderToStaticMarkup(<CookPage recipeId="r1" cookSessionId={null} />)
    expect(html).toContain('Bolognese')
    expect(html).toContain('Schritt 1 von 2')
    expect(html).toContain('Die 2 Zwiebeln fein würfeln.')
    expect(html).toContain('Original 4 Portionen')
    expect(html).toContain('4 Portionen')
    expect(html).toContain('Zum Rezept')
    expect(html.match(/Zum Rezept/g)).toHaveLength(1)
    expect(html).not.toContain('Kochmodus verlassen')
  })

  it('uses the planned cooking event total portions and scales the step text', () => {
    live.reset(cookData(6))
    const html = renderToStaticMarkup(<CookPage recipeId="r1" cookSessionId="cook-1" />)
    expect(html).toContain('Schritt 1 von 2')
    expect(html).toContain('Die 3 Zwiebeln fein würfeln.')
    expect(html).toContain('In diesem Schritt')
    expect(html).toContain('3 Zwiebeln')
    expect(html).toContain('6 Portionen')
  })

  it('uses the multi-day total, not the portions of one single day', () => {
    live.reset(cookData(10))
    const html = renderToStaticMarkup(<CookPage recipeId="r1" cookSessionId="cook-1" />)
    expect(html).toContain('10 Portionen')
    expect(html).toContain('Die 5 Zwiebeln fein würfeln.')
  })

  it('makes the complete ingredient list available without references', () => {
    const withoutReferences: Recipe = {
      ...recipe,
      instructions: recipe.instructions.map((step) => ({ ...step, references: [] })),
    }
    live.reset({ ...cookData(null), recipe: withoutReferences })
    const html = renderToStaticMarkup(<CookPage recipeId="r1" cookSessionId={null} />)
    expect(html).not.toContain('In diesem Schritt')
    expect(html).toContain('Zutaten anzeigen')
    expect(html).toContain('Die 2 Zwiebeln fein würfeln.')
  })

  it('renders a recipe without instructions without crashing', () => {
    live.reset({ ...cookData(null), recipe: { ...recipe, instructions: [] } })
    const html = renderToStaticMarkup(<CookPage recipeId="r1" cookSessionId={null} />)
    expect(html).toContain('Keine Schritte hinterlegt')
    expect(html).toContain('keine Zubereitungsschritte hinterlegt')
  })

  it('falls back to the recipe when the planned cooking event no longer exists', () => {
    live.reset(cookData(null, true))
    const html = renderToStaticMarkup(<CookPage recipeId="r1" cookSessionId="gone" />)
    expect(html).toContain('Der geplante Kochvorgang wurde nicht gefunden')
    expect(html).toContain('Die 2 Zwiebeln fein würfeln.')
    expect(html).not.toContain('automatisch als gekocht')
  })

  it('shows a recoverable error instead of crashing when loading fails', () => {
    live.reset({
      ...cookData(null),
      recipe: null,
      loadError: 'Datenbank gesperrt',
    })
    const html = renderToStaticMarkup(<CookPage recipeId="r1" cookSessionId={null} />)
    expect(html).toContain('Der Kochmodus konnte nicht geladen werden.')
    expect(html).toContain('Datenbank gesperrt')
    expect(html).toContain('Zur Bibliothek')
  })

  it('shows a not-found state for a missing recipe', () => {
    live.reset({ ...cookData(null), recipe: null })
    const html = renderToStaticMarkup(<CookPage recipeId="missing" cookSessionId={null} />)
    expect(html).toContain('Rezept nicht gefunden.')
    expect(html).toContain('Zur Bibliothek')
  })

  it('keeps a step usable when a linked ingredient no longer exists', () => {
    live.reset({
      ...cookData(null),
      recipe: {
        ...recipe,
        instructions: [
          {
            ...recipe.instructions[0]!,
            references: [
              {
                id: 'ref-missing',
                ingredientId: 'i-gone',
                anchor: '2',
                anchorOffset: 4,
                quantity: { kind: 'full' },
              },
            ],
          },
        ],
      },
    })
    const html = renderToStaticMarkup(<CookPage recipeId="r1" cookSessionId={null} />)
    expect(html).toContain('Schritt 1 von 1')
    expect(html).toContain('Die 2 Zwiebeln fein würfeln.')
    expect(html).not.toContain('In diesem Schritt')
  })
})

describe('cook mode views', () => {
  it('renders every step in order, marks the current step and scales the full ingredient list', () => {
    const html = overviewMarkup()
    const firstStep = html.indexOf('Die 3 Zwiebeln fein würfeln.')
    const secondStep = html.indexOf('600 g Hackfleisch kräftig anbraten.')

    expect(html).toContain('Zubereitung')
    expect(html).toContain('Schritt 1')
    expect(html).toContain('Schritt 2')
    expect(html).toContain('Aktuell')
    expect(html).toContain('cook-overview-step is-current')
    expect(html).toContain('Zutaten für 6 Portionen')
    expect(html).toContain('600 g')
    expect(html).toContain('750 ml')
    expect(firstStep).toBeGreaterThan(-1)
    expect(secondStep).toBeGreaterThan(firstStep)
  })

  it('scales step amounts and shows the complete ingredient list without references', () => {
    const withoutReferences: Recipe = {
      ...recipe,
      instructions: recipe.instructions.map((step) => ({ ...step, references: [] })),
    }
    const html = overviewMarkup(withoutReferences)

    expect(html).toContain('Zutaten für 6 Portionen')
    expect(html).toContain('600 g')
    expect(html).toContain('750 ml')
    expect(html).toContain('Die 3 Zwiebeln fein würfeln.')
    expect(html).toContain('600 g Hackfleisch kräftig anbraten.')
    expect(html).not.toContain('400 g Hackfleisch kräftig anbraten.')
  })

  it('scales step amounts without references in the focused step view', () => {
    const withoutReferences: Recipe = {
      ...recipe,
      instructions: recipe.instructions.map((step) => ({ ...step, references: [] })),
    }
    live.reset({ ...cookData(6), recipe: withoutReferences })
    const html = renderToStaticMarkup(<CookPage recipeId="r1" cookSessionId="cook-1" />)

    expect(html).toContain('Die 3 Zwiebeln fein würfeln.')
    expect(html).not.toContain('Die 2 Zwiebeln fein würfeln.')
    expect(html).toContain('Zutaten anzeigen')
    // Auto-detected amounts are not added to the explicit "In diesem Schritt"
    // relation list, which stays reserved for manual references.
    expect(html).not.toContain('In diesem Schritt')
  })

  it('keeps step position and servings when switching views', () => {
    const state = { ...initialCookUiState, stepIndex: 1, servings: 6 }
    const overview = cookUiReducer(state, { type: 'changeView', view: 'overview' })
    expect(overview).toEqual({ view: 'overview', stepIndex: 1, servings: 6 })

    const step = cookUiReducer(overview, { type: 'changeView', view: 'step' })
    expect(step).toEqual({ view: 'step', stepIndex: 1, servings: 6 })
  })

  it('opens the selected overview step in the step view without resetting portions', () => {
    const state = { ...initialCookUiState, view: 'overview' as const, stepIndex: 0, servings: 6 }
    const next = cookUiReducer(state, { type: 'openStep', index: 1, stepCount: 2 })
    expect(next).toEqual({ view: 'step', stepIndex: 1, servings: 6 })
  })

  it('clamps steps and never drops below half a portion', () => {
    const state = { ...initialCookUiState, stepIndex: 8 }
    expect(cookUiReducer(state, { type: 'goToStep', index: 99, stepCount: 3 }).stepIndex).toBe(2)
    expect(cookUiReducer(state, { type: 'clampStep', stepCount: 2 }).stepIndex).toBe(1)
    expect(cookServingsAfterDelta(4, 0.5)).toBe(4.5)
    expect(cookServingsAfterDelta(1, -5)).toBe(MIN_COOK_SERVINGS)
  })

  it('uses meaningful navigation states on the first and last step', () => {
    const first = stepMarkup(recipe, 0)
    expect(first).toMatch(/<button[^>]*disabled[^>]*>← Zurück<\/button>/)
    expect(first).not.toMatch(/<button[^>]*disabled[^>]*>Weiter →<\/button>/)

    const last = stepMarkup(recipe, recipe.instructions.length - 1)
    expect(last).toContain('Letzter Schritt')
    expect(last).not.toMatch(/<button[^>]*disabled[^>]*>← Zurück<\/button>/)
    expect(last).toMatch(/<button[^>]*disabled[^>]*>Weiter →<\/button>/)
  })

  it('does not mutate the recipe while rendering both views', () => {
    const before = recipe.ingredients.map((entry) => entry.quantityText)
    renderToStaticMarkup(<CookPage recipeId="r1" cookSessionId={null} />)
    overviewMarkup()
    expect(recipe.ingredients.map((entry) => entry.quantityText)).toEqual(before)
  })
})
