import { renderToStaticMarkup } from 'react-dom/server'
import type { ReactElement, ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildCalendarLayout,
  buildCalendarWindow,
  type CalendarDay,
} from '../../domain/calendar'
import type {
  DayNote,
  FreeDish,
  MealPlanEntry,
  Recipe,
} from '../../types'
import {
  CalendarDayCard,
  CalendarEntryCard,
  CalendarPreviewTile,
  PlanCalendar,
  type CalendarDragHandlers,
} from './PlanCalendar'

const LONG_TITLE =
  'Ofengemüse mit gerösteten Kichererbsen und Zitronen-Joghurt'

function entry(
  id: string,
  date: string,
  overrides: Partial<MealPlanEntry> = {},
): MealPlanEntry {
  return {
    id,
    date,
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
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }
}

function recipe(id: string, title: string): Recipe {
  return {
    id,
    importId: id,
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
    updatedAt: 1,
  }
}

function freeDish(id: string, name: string): FreeDish {
  return {
    id,
    name,
    referenceServings: 2,
    ingredients: [],
    createdAt: 1,
    updatedAt: 1,
  }
}

const notes: DayNote[] = [
  { date: '2026-05-27', text: 'Einkaufen und vorbereiten', createdAt: 1, updatedAt: 1 },
]

const entries: MealPlanEntry[] = [
  entry('before-1', '2026-05-26', { recipeId: 'r2', createdAt: 1 }),
  entry('before-2', '2026-05-26', { recipeId: 'r3', createdAt: 2 }),
  entry('before-3', '2026-05-26', { recipeId: 'r4', createdAt: 3 }),
  entry('main-long', '2026-05-29', {
    recipeId: 'r1',
    servings: 4,
    cookSessionId: 'session-1',
  }),
  entry('main-group', '2026-05-30', {
    recipeId: 'r1',
    servings: 2,
    cookSessionId: 'session-1',
    position: 1,
  }),
  entry('main-soup', '2026-05-30', {
    recipeId: 'r2',
    servings: 1,
    position: 0,
  }),
  entry('main-free', '2026-05-31', {
    recipeId: null,
    freeDishId: 'free-1',
    servings: 2,
    position: 0,
  }),
  entry('after-1', '2026-06-04', { recipeId: 'r3' }),
]

const window = buildCalendarWindow('2026-05-29', 3, 2, 2)
const layout = buildCalendarLayout(window, entries)
const recipeById = new Map([
  ['r1', recipe('r1', LONG_TITLE)],
  ['r2', recipe('r2', 'Schnelle Kräutersuppe')],
  ['r3', recipe('r3', 'Frühstücksporridge')],
  ['r4', recipe('r4', 'Apfelkuchen')],
])
const freeDishById = new Map([['free-1', freeDish('free-1', 'Nudeln mit Pesto')]])
const noteByDate = new Map(notes.map((note) => [note.date, note]))

const dragHandlers: CalendarDragHandlers = {
  onPointerDown: vi.fn(),
  onPointerMove: vi.fn(),
  onPointerUp: vi.fn(),
  onPointerCancel: vi.fn(),
  onClick: vi.fn(),
}

beforeEach(() => {
  vi.clearAllMocks()
})

interface ButtonElementProps {
  className?: string
  onClick?: () => void
  children?: ReactNode
  [key: string]: unknown
}

function collectButtons(
  node: ReactNode,
  found: ReactElement<ButtonElementProps>[] = [],
): ReactElement<ButtonElementProps>[] {
  if (Array.isArray(node)) {
    for (const child of node) collectButtons(child, found)
    return found
  }
  if (!node || typeof node !== 'object') return found
  const element = node as ReactElement<ButtonElementProps>
  if (element.type === 'button') found.push(element)
  if (typeof element.type === 'function') {
    const rendered = (
      element.type as (props: Record<string, unknown>) => ReactNode
    )(element.props as Record<string, unknown>)
    collectButtons(rendered, found)
    return found
  }
  if (element.props) collectButtons(element.props.children, found)
  return found
}

function cardProps(day: CalendarDay, onAdd = vi.fn()) {
  return {
    day,
    today: '2026-05-29',
    selected: day.date === '2026-05-30',
    note: noteByDate.get(day.date),
    dropTarget: false,
    recipeById,
    freeDishById,
    groupSizeBySession: new Map([['session-1', 2]]),
    originDragKey: null,
    highlightedSessionId: null,
    dragHandlers,
    onAdd,
    onHighlightSession: vi.fn(),
  }
}

function renderCalendar(selectedDate = '2026-05-30', selectedLayout = layout) {
  return renderToStaticMarkup(
    <PlanCalendar
      layout={selectedLayout}
      today="2026-05-29"
      selectedDate={selectedDate}
      noteByDate={noteByDate}
      dropDate={null}
      recipeById={recipeById}
      freeDishById={freeDishById}
      groupSizeBySession={new Map([['session-1', 2]])}
      originDragKey={null}
      highlightedSessionId={null}
      dragHandlers={dragHandlers}
      onSelectDate={vi.fn()}
      onAdd={vi.fn()}
      onHighlightSession={vi.fn()}
    />,
  )
}

describe('responsive plan calendar', () => {
  it('renders seven core days and two preview days on both sides', () => {
    const html = renderCalendar()

    expect(html.match(/data-calendar-date="/g)).toHaveLength(11)
    expect(html.match(/data-calendar-select-date="/g)).toHaveLength(7)
    expect(html.match(/calendar-preview-tile/g)).toHaveLength(4)
    expect(html).toContain('calendar-preview-row--before')
    expect(html).toContain('calendar-preview-row--after')
    expect(html).toContain('Davor')
    expect(html).toContain('Danach')
  })

  it('marks exactly one mobile date as selected and one day as today', () => {
    const html = renderCalendar('2026-05-30', layout)

    expect(html.match(/aria-pressed="true"/g)).toHaveLength(1)
    expect(html).toMatch(
      /aria-pressed="true"[^>]*data-calendar-select-date="2026-05-30"/,
    )
    expect(html).toMatch(
      /class="calendar-day is-selected[^"]*" data-calendar-date="2026-05-30"/,
    )
    expect(html).toContain('calendar-today">Heute</span>')
    expect(html).toContain('calendar-day-chip is-selected has-dishes')
    expect(html).toContain('calendar-day-chip is-today has-dishes')
  })

  it('shows long dish names, portions and several dishes without hiding any', () => {
    const html = renderCalendar()

    expect(html).toContain(LONG_TITLE)
    expect(html).toContain('4 Portionen')
    expect(html).toContain('2 Portionen')
    expect(html).toContain('1 Portion')
    expect(html).toContain('Schnelle Kräutersuppe')
    expect(html).toContain('Nudeln mit Pesto')
    expect(html).toContain(
      `aria-label="${LONG_TITLE} bearbeiten, Fr, 29.05."`,
    )
  })

  it('shows the shared cook session and the free dish marker', () => {
    const html = renderCalendar()

    expect(html).toContain('calendar-entry--group group-color-')
    expect(html).toContain('calendar-entry-session')
    expect(html.match(/2 Tage/g)).toHaveLength(2)
    expect(html).toContain('calendar-entry--free')
    expect(html).toContain('>frei</span>')
  })

  it('keeps empty days and overlap days directly editable', () => {
    const html = renderCalendar()

    expect(html).toContain('calendar-add-day is-empty')
    expect(html).toContain(
      'aria-label="Eintrag am Do, 28.05. hinzufügen"',
    )
    expect(html).toContain(
      'aria-label="Eintrag am Di, 26.05. hinzufügen"',
    )
    expect(html).toContain('Einkaufen und vorbereiten')
    expect(html).toContain('+1 weitere')
  })

  it('does not touch planning data while the selected mobile day changes', () => {
    const before = JSON.stringify(layout)
    const first = renderCalendar('2026-05-28', layout)
    const second = renderCalendar('2026-06-03', layout)

    expect(JSON.stringify(layout)).toBe(before)
    expect(first).toContain('data-calendar-select-date="2026-05-28"')
    expect(second).toContain('data-calendar-select-date="2026-06-03"')
    expect(dragHandlers.onClick).not.toHaveBeenCalled()
  })

  it('routes every core and overlap add control through the existing onAdd callback', () => {
    for (const day of layout.main) {
      const onAdd = vi.fn()
      const addButton = collectButtons(
        CalendarDayCard(cardProps(day, onAdd)),
      ).find((button) =>
        String(button.props.className).includes('calendar-add-day'),
      )

      expect(addButton).toBeTruthy()
      addButton!.props.onClick?.()
      expect(onAdd).toHaveBeenCalledWith(day.date)
    }

    const onAdd = vi.fn()
    const previewAdd = collectButtons(
      CalendarPreviewTile(cardProps(layout.before[0]!, onAdd)),
    ).find((button) =>
      String(button.props.className).includes('calendar-preview-add'),
    )

    expect(previewAdd).toBeTruthy()
    previewAdd!.props.onClick?.()
    expect(onAdd).toHaveBeenCalledWith('2026-05-26')
  })

  it('routes a mobile date tap through the existing selection callback', () => {
    const onSelectDate = vi.fn()
    const tree = PlanCalendar({
      layout,
      today: '2026-05-29',
      selectedDate: '2026-05-30',
      noteByDate,
      dropDate: null,
      recipeById,
      freeDishById,
      groupSizeBySession: new Map([['session-1', 2]]),
      originDragKey: null,
      highlightedSessionId: null,
      dragHandlers,
      onSelectDate,
      onAdd: vi.fn(),
      onHighlightSession: vi.fn(),
    })
    const chip = collectButtons(tree).find(
      (button) =>
        (button.props as Record<string, unknown>)['data-calendar-select-date'] ===
        '2026-06-01',
    )

    expect(chip).toBeTruthy()
    ;(chip!.props as { onClick: () => void }).onClick()
    expect(onSelectDate).toHaveBeenCalledWith('2026-06-01')
  })

  it('keeps dish clicks and drag gestures on the same callbacks', () => {
    const longEntry = entries.find((item) => item.id === 'main-long')!
    const card = CalendarEntryCard({
      entry: longEntry,
      recipeById,
      freeDishById,
      groupSizeBySession: new Map([['session-1', 2]]),
      originDragKey: null,
      highlightedSessionId: null,
      dragHandlers,
      onHighlightSession: vi.fn(),
    }) as ReactElement<{
      onClick: () => void
      onPointerDown: (event: unknown) => void
    }>
    const pointerEvent = {}

    card.props.onPointerDown(pointerEvent)
    card.props.onClick()

    expect(dragHandlers.onPointerDown).toHaveBeenCalledWith(
      { kind: 'entry', entry: longEntry },
      pointerEvent,
    )
    expect(dragHandlers.onClick).toHaveBeenCalledWith({
      kind: 'entry',
      entry: longEntry,
    })
  })
})
