/*
 * Küchenrunde – gemeinsame Datenschnittstelle der Wochenplanung
 * Copyright (C) 2026 openCook Web contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Die vorhandene Planungsoberfläche und ihre Dialoge sprechen ausschließlich
 * über diese kleine Schnittstelle mit der Persistenz. Im lokalen Modus werden
 * unverändert die bestehenden Dexie-Services aufgerufen. Der Cloud-Modus
 * liefert dieselbe Schnittstelle über den CloudRecordsStore, ohne lokale
 * Dexie-Daten zu lesen oder zu schreiben.
 *
 * Bewusst keine neue Planungslogik: Die Schnittstelle bildet genau die
 * vorhandenen Operationen ab, die Kalender und Dialoge bereits verwendeten.
 */

import {
  createContext,
  useContext,
  useMemo,
  type ReactNode,
} from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db'
import type { CalendarSettings } from '../domain/calendar'
import { setCalendarSettings as saveCalendarSettings } from '../settings/calendar'
import type {
  CookSession,
  DayNote,
  FreeDish,
  MealPlanEntry,
  Recipe,
  SettingRecord,
} from '../types'
import {
  deleteDishPlan,
  moveDishPlanEntry,
  saveDishPlan,
  undoDishPlanMove,
  type DishPlanMoveSnapshot,
  type MoveDishPlanResult,
  type SaveDishPlanInput,
  type SaveDishPlanResult,
} from './dishService'
import {
  deleteDayNote,
  moveDayNote,
  saveDayNote,
  undoDayNoteMove,
  type DayNoteMoveSnapshot,
} from './dayNoteService'
import {
  saveFreeDishPlan,
  type SaveFreeDishPlanInput,
  type SaveFreeDishPlanResult,
} from './freeDishService'
import {
  removeMealEntry,
  setHouseholdSize as saveHouseholdSize,
} from './service'

/** All records the planning surface renders, loaded as one consistent view. */
export interface PlanData {
  entries: MealPlanEntry[]
  recipes: Recipe[]
  freeDishes: FreeDish[]
  sessions: CookSession[]
  settings: SettingRecord[]
  dayNotes: DayNote[]
}

/**
 * The complete persistence surface used by the existing calendar and dialogs.
 * Implementations only swap the storage; day selection, portion rules, drag
 * and undo remain in the shared components.
 */
export interface PlanBackend {
  /** Cook mode is not connected in the cloud yet and stays hidden there. */
  readonly cookModeEnabled: boolean
  /** Optional cloud image cover renderer; local mode uses the existing one. */
  readonly renderRecipeCover?: (recipe: Recipe, className?: string) => ReactNode
  usePlanData(): PlanData | undefined
  saveDishPlan(input: SaveDishPlanInput): Promise<SaveDishPlanResult>
  saveFreeDishPlan(input: SaveFreeDishPlanInput): Promise<SaveFreeDishPlanResult>
  deleteDishPlan(cookSessionId: string): Promise<{ deletedMeals: number }>
  removeMealEntry(id: string): Promise<void>
  moveDishPlanEntry(
    entryId: string,
    targetDate: string,
    options?: { allowCookedChange?: boolean },
  ): Promise<MoveDishPlanResult>
  undoDishPlanMove(input: {
    entryId: string
    originalDate: string
    expected: DishPlanMoveSnapshot
  }): Promise<MoveDishPlanResult>
  moveDayNote(date: string, targetDate: string): Promise<DayNote>
  undoDayNoteMove(input: {
    currentDate: string
    originalDate: string
    expected: DayNoteMoveSnapshot
  }): Promise<DayNote>
  saveDayNote(date: string, text: string): Promise<DayNote | null>
  deleteDayNote(date: string): Promise<void>
  setCalendarSettings(patch: Partial<CalendarSettings>): Promise<CalendarSettings>
  setHouseholdSize(size: number): Promise<void>
}

/**
 * Local adapter. It deliberately delegates one-to-one to the existing
 * services, so the local plan keeps its previous behaviour and data model.
 */
export const localPlanBackend: PlanBackend = {
  cookModeEnabled: true,

  usePlanData() {
    // Query order is part of the existing page contract (and its tests):
    // entries, recipes, free dishes, sessions, settings, day notes.
    const entries = useLiveQuery(() => db.mealPlans.toArray(), [])
    const recipes = useLiveQuery(() => db.recipes.toArray(), [])
    const freeDishes = useLiveQuery(() => db.freeDishes.toArray(), [])
    const sessions = useLiveQuery(() => db.cookSessions.toArray(), [])
    const settings = useLiveQuery(() => db.settings.toArray(), [])
    const dayNotes = useLiveQuery(() => db.dayNotes.toArray(), [])

    return useMemo(() => {
      if (
        entries === undefined ||
        recipes === undefined ||
        freeDishes === undefined ||
        sessions === undefined ||
        settings === undefined ||
        dayNotes === undefined
      ) {
        return undefined
      }
      return { entries, recipes, freeDishes, sessions, settings, dayNotes }
    }, [entries, recipes, freeDishes, sessions, settings, dayNotes])
  },

  saveDishPlan: (input) => saveDishPlan(input),
  saveFreeDishPlan: (input) => saveFreeDishPlan(input),
  deleteDishPlan: (cookSessionId) => deleteDishPlan(cookSessionId),
  removeMealEntry: (id) => removeMealEntry(id),
  moveDishPlanEntry: (entryId, targetDate, options) =>
    moveDishPlanEntry(entryId, targetDate, options),
  undoDishPlanMove: (input) => undoDishPlanMove(input),
  moveDayNote: (date, targetDate) => moveDayNote(date, targetDate),
  undoDayNoteMove: (input) => undoDayNoteMove(input),
  saveDayNote: (date, text) => saveDayNote(date, text),
  deleteDayNote: (date) => deleteDayNote(date),
  setCalendarSettings: (patch) => saveCalendarSettings(patch),
  setHouseholdSize: (size) => saveHouseholdSize(size),
}

const PlanBackendContext = createContext<PlanBackend>(localPlanBackend)

export const PlanBackendProvider = PlanBackendContext.Provider

/**
 * Uses the backend of the current shell. Without a provider the app stays on
 * the unchanged local services; the cloud shell always provides its own.
 */
export function usePlanBackend(): PlanBackend {
  return useContext(PlanBackendContext)
}
