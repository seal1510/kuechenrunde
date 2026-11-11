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

function calendarDates(html: string): string[] {
  return Array.from(
    html.matchAll(/data-calendar-date="([^"]+)"/g),
    (match) => match[1]!,
  )
}

function renderCalendar(selectedLayout = layout) {
  return renderToStaticMarkup(
    <PlanCalendar
      layout={selectedLayout}
      today="2026-05-29"
      noteByDate={noteByDate}
      dropDate={null}
      recipeById={recipeById}
      freeDishById={freeDishById}
      groupSizeBySession={new Map([['session-1', 2]])}
      originDragKey={null}
      highlightedSessionId={null}
      dragHandlers={dragHandlers}
      onAdd={vi.fn()}
      onHighlightSession={vi.fn()}
    />,
  )
}

function renderMobileCalendar(
  selectedLayout = layout,
  today = '2026-05-29',
) {
  return renderToStaticMarkup(
    <PlanCalendar
      mobile
      layout={selectedLayout}
      today={today}
      noteByDate={noteByDate}
      dropDate={null}
      recipeById={recipeById}
      freeDishById={freeDishById}
      groupSizeBySession={new Map([['session-1', 2]])}
      originDragKey={null}
      highlightedSessionId={null}
      dragHandlers={dragHandlers}
      onAdd={vi.fn()}
      onHighlightSession={vi.fn()}
    />,
  )
}

describe('responsive plan calendar', () => {
  it('renders all eleven days in chronological order and groups them', () => {
    const html = renderCalendar()

    expect(calendarDates(html)).toEqual(window.visibleDays)
    expect(calendarDates(html)).toHaveLength(11)
    expect(html.match(/class="calendar-day /g)).toHaveLength(7)
    expect(html.match(/class="calendar-preview-tile/g)).toHaveLength(4)
    expect(html).toContain('Davor')
    expect(html).toContain('Diese Woche')
    expect(html).toContain('Danach')
    expect(html).toContain('calendar-preview-row--before')
    expect(html).toContain('calendar-preview-row--after')
  })

  it('keeps every day directly visible without a day-selection control', () => {
    const html = renderCalendar()

    expect(html).not.toContain('calendar-day-strip')
    expect(html).not.toContain('data-calendar-select-date')
    expect(html).not.toContain('is-selected')
    expect(html.match(/aria-pressed=/g)).toBeNull()
    expect(html).toContain('calendar-today">Heute</span>')
    expect(html).toContain('class="calendar-day is-today')
  })

  it('shows every dish of a day, including more than two overlap dishes', () => {
    const html = renderCalendar()

    expect(html).toContain('Apfelkuchen')
    expect(html).toContain('Frühstücksporridge')
    expect(html).toContain('Schnelle Kräutersuppe')
    expect(html).toContain('Nudeln mit Pesto')
    expect(html.match(/is-preview-extra/g)).toHaveLength(1)
    expect(html).toContain('calendar-preview-more')
  })

  it('shows a compact empty hint on every empty day', () => {
    const html = renderCalendar()

    expect(html.match(/calendar-empty-hint/g)).toHaveLength(5)
    expect(html).toContain('aria-hidden="true">—</span>')
  })

  it('shows long dish names, portions and several dishes without truncation', () => {
    const html = renderCalendar()

    expect(html).toContain(LONG_TITLE)
    expect(html).toContain('4 Portionen')
    expect(html).toContain('2 Portionen')
    expect(html).toContain('1 Portion')
    expect(html).toContain(
      `aria-label="${LONG_TITLE} bearbeiten, Fr, 29.05."`,
    )
  })

  it('shows the shared cook session and keeps comments and free dishes', () => {
    const html = renderCalendar()

    expect(html).toContain('calendar-entry--group group-color-')
    expect(html).toContain('calendar-entry-session')
    expect(html.match(/2 Tage/g)).toHaveLength(2)
    expect(html).toContain('calendar-entry--free')
    expect(html).toContain('calendar-note-entry')
    expect(html).toContain('Einkaufen und vorbereiten')
    expect(html).toContain('>frei</span>')
  })

  it('gives every day its own add action', () => {
    const html = renderCalendar()
    expect(html.match(/class="calendar-add-day /g)).toHaveLength(7)
    expect(html.match(/class="calendar-preview-add"/g)).toHaveLength(4)
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

    for (const day of [...layout.before, ...layout.after]) {
      const onAdd = vi.fn()
      const previewAdd = collectButtons(
        CalendarPreviewTile(cardProps(day, onAdd)),
      ).find((button) =>
        String(button.props.className).includes('calendar-preview-add'),
      )

      expect(previewAdd).toBeTruthy()
      previewAdd!.props.onClick?.()
      expect(onAdd).toHaveBeenCalledWith(day.date)
    }
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

  it('keeps eleven days in order for every week start across a year boundary', () => {
    for (let weekStartDay = 0; weekStartDay < 7; weekStartDay += 1) {
      const week = buildCalendarWindow('2026-12-31', weekStartDay, 2, 2)
      const weekLayout = buildCalendarLayout(week, entries)
      const html = renderCalendar(weekLayout)

      expect(calendarDates(html)).toEqual(week.visibleDays)
      expect(calendarDates(html)).toHaveLength(11)
    }
  })

  it('does not touch planning data when the visible period changes', () => {
    const otherWindow = buildCalendarWindow('2026-06-05', 3, 2, 2)
    const otherLayout = buildCalendarLayout(otherWindow, entries)
    const before = JSON.stringify(layout)
    const first = renderCalendar(layout)
    const second = renderCalendar(otherLayout)

    expect(JSON.stringify(layout)).toBe(before)
    expect(first).toContain('data-calendar-date="2026-05-29"')
    expect(second).toContain('data-calendar-date="2026-06-05"')
    expect(dragHandlers.onClick).not.toHaveBeenCalled()
  })
})

describe('mobile plan hierarchy', () => {
  it('puts today directly behind a collapsed past-day group', () => {
    const html = renderMobileCalendar()

    expect(html).toContain('calendar-shell is-mobile')
    expect(html).toContain('<details class="calendar-past-group">')
    expect(html).toContain('Vergangene Tage')
    expect(html).toContain('26.05. – 28.05.')
    expect(html).toContain('calendar-past-count')
    expect(html).toContain('Heute und danach')

    const pastGroupEnd = html.indexOf('</details>')
    const todayIndex = html.indexOf('calendar-day is-today')
    expect(pastGroupEnd).toBeGreaterThan(0)
    expect(todayIndex).toBeGreaterThan(pastGroupEnd)
    expect(calendarDates(html)[3]).toBe('2026-05-29')
  })

  it('keeps every past dish, comment and add action inside the group', () => {
    const html = renderMobileCalendar()

    expect(html).toContain('Apfelkuchen')
    expect(html).toContain('Frühstücksporridge')
    expect(html).toContain('Einkaufen und vorbereiten')
    expect(html).toContain('Eintrag am Di, 26.05. hinzufügen')
    expect(html.match(/class="calendar-add-day /g)).toHaveLength(11)
    expect(calendarDates(html)).toEqual(window.visibleDays)
  })

  it('renders empty days as compact rows without a reserved empty block', () => {
    const html = renderMobileCalendar()

    expect(html.match(/is-compact-empty/g)).toHaveLength(5)
    expect(html).not.toContain('calendar-empty-hint')
    expect(html).toContain('class="calendar-add-day is-empty"')
    expect(html).toContain('Hinzufügen')
  })

  it('keeps planned dishes, portions and shared cook sessions reachable', () => {
    const html = renderMobileCalendar()

    expect(html).toContain(LONG_TITLE)
    expect(html).toContain('4 Portionen')
    expect(html).toContain('2 Portionen')
    expect(html).toContain('Nudeln mit Pesto')
    expect(html).toContain('calendar-entry-session')
    expect(html).toContain('calendar-entry--group group-color-')
  })

  it('shows other periods in their normal chronological order', () => {
    const otherWindow = buildCalendarWindow('2026-06-05', 3, 2, 2)
    const otherLayout = buildCalendarLayout(otherWindow, entries)
    const html = renderMobileCalendar(otherLayout)

    expect(html).not.toContain('calendar-past-group')
    expect(html).toContain('Davor')
    expect(html).toContain('Diese Woche')
    expect(html).toContain('Danach')
    expect(html).toContain('data-calendar-date="2026-06-05"')
    expect(calendarDates(html)).toEqual(otherWindow.visibleDays)
    expect(calendarDates(html)).toHaveLength(11)
  })
})
