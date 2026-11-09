import { db } from '../db'
import {
  checkCookServings,
  checkMealAssignment,
  cookSessionBalance,
  isProtectedEntry,
  linkedMealEntries,
  mealEntryStatus,
  sortMealEntries,
} from '../domain/mealplan'
import { todayKey } from '../domain/dates'
import { DEFAULT_PLAN_SLOT } from '../domain/dishplan'
import {
  generateWeekBest,
  weightsForSlot,
  type PickedRecipe,
  type PlannerRecipe,
  type ReasonContribution,
} from '../domain/planner'
import { randomId } from '../lib/id'
import { getShoppingSettings } from '../settings/shopping'
import { planningDatesForToday } from '../shopping/cycle'
import {
  DEFAULT_HOUSEHOLD_SIZE,
  type CookSession,
  type CookSessionStatus,
  type MealDay,
  type MealEntryStatus,
  type MealPlanEntry,
  type Recipe,
} from '../types'

/** The automatic planner keeps its single dinner slot. */
export const PRIMARY_SLOT = DEFAULT_PLAN_SLOT

/** Same cool-down the original unattended planner uses. */
export const AUTO_FILL_GAP_DAYS = 10

export class MealPlanError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MealPlanError'
  }
}

export function planEntryId(date: string, slot: string = PRIMARY_SLOT): string {
  return `plan-${date}-${slot}`
}

export function toPlannerRecipe(recipe: Recipe): PlannerRecipe {
  return {
    id: recipe.id,
    name: recipe.title,
    categories: recipe.categories,
    servings: recipe.servingsNumber,
    totalTime: recipe.totalTime,
    prepTime: recipe.prepTime,
    cookTime: recipe.cookTime,
    ingredients: recipe.ingredients.map((ingredient) => ingredient.name),
    favorite: recipe.favorite,
  }
}

export async function getHouseholdSize(): Promise<number> {
  const row = await db.settings.get('householdSize')
  const value = typeof row?.value === 'number' ? row.value : DEFAULT_HOUSEHOLD_SIZE
  return Number.isFinite(value) && value >= 1 ? Math.round(value) : DEFAULT_HOUSEHOLD_SIZE
}

export async function setHouseholdSize(size: number): Promise<void> {
  const value = Math.min(20, Math.max(1, Math.round(Number.isFinite(size) ? size : DEFAULT_HOUSEHOLD_SIZE)))
  await db.settings.put({ key: 'householdSize', value })
}

function normalizeServings(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new MealPlanError('Bitte eine Portionszahl größer als 0 angeben.')
  }
  return Math.round(value * 10) / 10
}

function now(): number {
  return Date.now()
}

async function nextPosition(date: string, slot: string): Promise<number> {
  const entries = await db.mealPlans.where('date').equals(date).toArray()
  const sameSlot = entries.filter((entry) => entry.slot === slot)
  return sameSlot.reduce((max, entry) => Math.max(max, entry.position ?? 0), -1) + 1
}

export interface MealSaveInput {
  id?: string
  date: string
  slot: string
  recipeId: string
  /** Portions eaten/planned at this appointment. */
  servings: number
  source: 'fresh' | 'leftover'
  /** Required for leftovers; reused for fresh edits of the same cooking event. */
  cookSessionId?: string | null
  /** Portions to actually cook (fresh only). */
  cookServings?: number
  cookStatus?: CookSessionStatus
  status?: MealEntryStatus
  auto?: boolean
  pinned?: boolean
  reasons?: ReasonContribution[]
}

/**
 * Create or update one meal appointment. Cooking quantities stay on the cooking
 * event; this row only records how many of its portions are eaten here.
 */
export async function saveMeal(input: MealSaveInput): Promise<MealPlanEntry> {
  const date = input.date
  const slot = input.slot.trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new MealPlanError('Ungültiges Datum.')
  if (!slot) throw new MealPlanError('Bitte eine Mahlzeit wählen.')
  const servings = normalizeServings(input.servings)

  return db.transaction('rw', [db.mealPlans, db.cookSessions, db.mealDays, db.recipes], async () => {
    const existing = input.id ? await db.mealPlans.get(input.id) : undefined
    const allEntries = await db.mealPlans.toArray()
    const nowValue = now()

    let cookSessionId: string | null = null
    let recipeId = input.recipeId

    if (input.source === 'leftover') {
      const requestedId = input.cookSessionId ?? existing?.cookSessionId ?? null
      const session = requestedId ? await db.cookSessions.get(requestedId) : undefined
      if (!session) throw new MealPlanError('Der gewählte Kochvorgang existiert nicht mehr.')
      const check = checkMealAssignment(session, allEntries, servings, existing?.id)
      if (!check.ok) throw new MealPlanError(check.message ?? 'Zu wenige Portionen verfügbar.')
      if (!session.recipeId) {
        throw new MealPlanError('Dieser Kochvorgang gehört zu einem freien Gericht.')
      }
      cookSessionId = session.id
      recipeId = session.recipeId
    } else {
      const recipe = await db.recipes.get(input.recipeId)
      if (!recipe) throw new MealPlanError('Das gewählte Rezept existiert nicht mehr.')

      let session: CookSession | undefined =
        existing?.cookSessionId && existing.recipeId === input.recipeId
          ? await db.cookSessions.get(existing.cookSessionId)
          : undefined
      if (session && session.recipeId !== input.recipeId) session = undefined

      const cookServings = normalizeServings(input.cookServings ?? session?.servings ?? servings)
      if (session) {
        const assignedOthers = linkedMealEntries(session.id, allEntries)
          .filter((entry) => entry.id !== existing?.id)
          .reduce((sum, entry) => sum + (entry.servings ?? 0), 0)
        if (assignedOthers + servings > cookServings) {
          throw new MealPlanError(
            `Die Kochmenge von ${cookServings} Portionen reicht nicht: ${assignedOthers} Portionen sind bereits ` +
              `anderen Essensterminen zugewiesen und dieser Termin braucht ${servings}. ` +
              'Erhöhe die Kochmenge oder reduziere die Portionen.',
          )
        }
        const updatedSession: CookSession = {
          ...session,
          servings: cookServings,
          status: input.cookStatus ?? session.status,
          auto: input.auto === true,
          updatedAt: nowValue,
        }
        await db.cookSessions.put(updatedSession)
        cookSessionId = updatedSession.id
      } else {
        if (cookServings < servings) {
          throw new MealPlanError(
            `Es können nicht ${servings} Portionen gegessen werden, wenn nur ${cookServings} gekocht werden.`,
          )
        }
        const created: CookSession = {
          id: `cook-${randomId()}`,
          recipeId: input.recipeId,
          date,
          servings: cookServings,
          status: input.cookStatus ?? 'planned',
          auto: input.auto === true,
          createdAt: nowValue,
          updatedAt: nowValue,
        }
        await db.cookSessions.put(created)
        cookSessionId = created.id
      }
      recipeId = input.recipeId
    }

    const status = input.status ?? (existing ? mealEntryStatus(existing) : 'planned')
    const entry: MealPlanEntry = {
      id: existing?.id ?? `meal-${randomId()}`,
      date,
      slot,
      recipeId,
      servings,
      position:
        existing && existing.date === date && existing.slot === slot
          ? (existing.position ?? 0)
          : await nextPosition(date, slot),
      cookSessionId,
      status,
      auto: input.auto ?? existing?.auto ?? false,
      pinned: input.pinned ?? existing?.pinned ?? false,
      leftover: input.source === 'leftover',
      cooked: status === 'eaten',
      reasons: input.reasons ?? existing?.reasons ?? [],
      createdAt: existing?.createdAt ?? nowValue,
      updatedAt: nowValue,
    }

    await db.mealPlans.put(entry)
    await writeDaySkipped(date, false)
    if (existing && (existing.date !== date || existing.slot !== slot)) {
      await clearDaySkippedIfEmpty(existing.date)
    }
    return entry
  })
}

export async function removeMealEntry(id: string): Promise<void> {
  await db.transaction('rw', [db.mealPlans, db.cookSessions, db.freeDishes], async () => {
    const entry = await db.mealPlans.get(id)
    await db.mealPlans.delete(id)
    if (!entry?.freeDishId) return
    const remainingMeals = await db.mealPlans
      .where('freeDishId')
      .equals(entry.freeDishId)
      .count()
    const remainingSessions = await db.cookSessions
      .where('freeDishId')
      .equals(entry.freeDishId)
      .count()
    // Never leave a plan-only ingredient snapshot without any reference.
    if (remainingMeals === 0 && remainingSessions === 0) {
      await db.freeDishes.delete(entry.freeDishId)
    }
  })
}

export async function setMealPinned(id: string, pinned: boolean): Promise<void> {
  const existing = await db.mealPlans.get(id)
  if (!existing) return
  await db.mealPlans.put({ ...existing, pinned, updatedAt: now() })
}

export async function setMealStatus(id: string, status: MealEntryStatus): Promise<void> {
  const existing = await db.mealPlans.get(id)
  if (!existing) return
  await db.mealPlans.put({
    ...existing,
    status,
    cooked: status === 'eaten',
    updatedAt: now(),
  })
}

export async function moveMealEntry(id: string, date: string, slot: string): Promise<MealPlanEntry> {
  const existing = await db.mealPlans.get(id)
  if (!existing) throw new MealPlanError('Dieser Essenstermin existiert nicht mehr.')
  if (!existing.recipeId) {
    throw new MealPlanError('Freie Gerichte werden als ganze Gruppe verschoben.')
  }
  const session = existing.cookSessionId ? await db.cookSessions.get(existing.cookSessionId) : undefined
  return saveMeal({
    id,
    date,
    slot,
    recipeId: existing.recipeId,
    servings: existing.servings ?? 1,
    source: existing.cookSessionId ? 'leftover' : 'fresh',
    cookSessionId: existing.cookSessionId ?? null,
    cookServings: session?.servings ?? existing.servings ?? 1,
    cookStatus: session?.status ?? 'planned',
    status: mealEntryStatus(existing),
    auto: existing.auto,
    pinned: existing.pinned,
    reasons: existing.reasons,
  })
}

export async function updateCookSession(
  id: string,
  patch: { servings?: number; status?: CookSessionStatus; date?: string },
): Promise<CookSession> {
  return db.transaction('rw', [db.cookSessions, db.mealPlans], async () => {
    const session = await db.cookSessions.get(id)
    if (!session) throw new MealPlanError('Dieser Kochvorgang existiert nicht mehr.')
    const entries = await db.mealPlans.toArray()
    const servings =
      patch.servings === undefined ? session.servings : normalizeServings(patch.servings)
    if (patch.servings !== undefined) {
      const check = checkCookServings(session, entries, servings)
      if (!check.ok) throw new MealPlanError(check.message ?? 'Die Kochmenge ist zu klein.')
    }
    const updated: CookSession = {
      ...session,
      servings,
      status: patch.status ?? session.status,
      date: patch.date ?? session.date,
      // A user edit makes the cooking event manual so automatic cleanup never
      // discards it as an unattended proposal.
      auto: false,
      updatedAt: now(),
    }
    await db.cookSessions.put(updated)
    return updated
  })
}

export async function setCookSessionStatus(
  id: string,
  status: CookSessionStatus,
): Promise<void> {
  await updateCookSession(id, { status })
}

export type CookSessionDeleteMode = 'detach' | 'delete-meals'

/**
 * Delete a cooking event. Linked appointments are never removed silently: the
 * caller must choose between detaching them (meals stay) and deleting them too.
 */
export async function deleteCookSession(
  id: string,
  mode: CookSessionDeleteMode,
): Promise<{ detached: number; deletedMeals: number }> {
  return db.transaction(
    'rw',
    [db.cookSessions, db.mealPlans, db.freeDishes, db.cookProgress],
    async () => {
    const session = await db.cookSessions.get(id)
    const entries = await db.mealPlans.where('cookSessionId').equals(id).toArray()
    if (mode === 'delete-meals') {
      if (entries.length > 0) await db.mealPlans.bulkDelete(entries.map((entry) => entry.id))
      await db.cookSessions.delete(id)
      await db.cookProgress.delete(id)
      // Detaching keeps the snapshot because the meals still reference it;
      // deleting the meals removes the last reference and the free dish too.
      if (session?.freeDishId) await db.freeDishes.delete(session.freeDishId)
      return { detached: 0, deletedMeals: entries.length }
    }
    for (const entry of entries) {
      await db.mealPlans.put({
        ...entry,
        cookSessionId: null,
        leftover: false,
        updatedAt: now(),
      })
    }
    await db.cookSessions.delete(id)
    await db.cookProgress.delete(id)
    return { detached: entries.length, deletedMeals: 0 }
  })
}

async function writeDaySkipped(date: string, skipped: boolean): Promise<MealDay> {
  const existing = await db.mealDays.get(date)
  const nowValue = now()
  const row: MealDay = {
    date,
    skipped,
    createdAt: existing?.createdAt ?? nowValue,
    updatedAt: nowValue,
  }
  await db.mealDays.put(row)
  return row
}

async function clearDaySkippedIfEmpty(date: string): Promise<void> {
  if ((await db.mealPlans.where('date').equals(date).count()) > 0) return
  const day = await db.mealDays.get(date)
  if (day?.skipped) await writeDaySkipped(date, false)
}

async function entriesForDateSlot(date: string, slot: string): Promise<MealPlanEntry[]> {
  const entries = await db.mealPlans.where('[date+slot]').equals([date, slot]).toArray()
  return sortMealEntries(entries)
}

/** Legacy single-dish helper retained for older links and tests. */
export async function setMealRecipe(
  date: string,
  recipeId: string,
  slot: string = PRIMARY_SLOT,
): Promise<void> {
  const existing = (await entriesForDateSlot(date, slot))[0]
  const householdSize = await getHouseholdSize()
  await saveMeal({
    id: existing?.id,
    date,
    slot,
    recipeId,
    servings: existing?.servings ?? householdSize,
    source: 'fresh',
    cookServings: existing?.servings ?? householdSize,
    auto: false,
    pinned: existing?.pinned ?? false,
    reasons: [],
  })
}

/** Legacy: pin every dish in the slot so a replan cannot replace any of them. */
export async function setPinned(
  date: string,
  pinned: boolean,
  slot: string = PRIMARY_SLOT,
): Promise<void> {
  const entries = await entriesForDateSlot(date, slot)
  await db.transaction('rw', [db.mealPlans, db.mealDays], async () => {
    for (const entry of entries) {
      await db.mealPlans.put({ ...entry, pinned, updatedAt: now() })
    }
    if (pinned) await writeDaySkipped(date, false)
  })
}

/** Legacy: mark the slot's meals as eaten/cooked and keep linked sessions in sync. */
export async function setCooked(
  date: string,
  cooked: boolean,
  slot: string = PRIMARY_SLOT,
): Promise<void> {
  const entries = await entriesForDateSlot(date, slot)
  await db.transaction('rw', [db.mealPlans, db.cookSessions], async () => {
    for (const entry of entries) {
      await db.mealPlans.put({
        ...entry,
        cooked,
        status: cooked ? 'eaten' : 'planned',
        updatedAt: now(),
      })
      if (entry.cookSessionId) {
        const session = await db.cookSessions.get(entry.cookSessionId)
        if (session) {
          await db.cookSessions.put({
            ...session,
            status: cooked ? 'cooked' : 'planned',
            updatedAt: now(),
          })
        }
      }
    }
  })
}

/** Leave a day free: remove its dishes and set the day flag (explicit user action). */
export async function setDaySkipped(date: string, skipped: boolean): Promise<void> {
  await db.transaction('rw', db.mealPlans, db.mealDays, async () => {
    if (skipped) {
      const entries = await db.mealPlans.where('date').equals(date).toArray()
      if (entries.length > 0) await db.mealPlans.bulkDelete(entries.map((entry) => entry.id))
    }
    await writeDaySkipped(date, skipped)
  })
}

export interface GenerateOptions {
  today?: string
  seed?: number
  restarts?: number
}

export interface GenerateOutcome {
  dates: string[]
  plan: Record<string, PickedRecipe>
  householdSize: number
  emptyDates: string[]
  pinnedDates: string[]
  skippedDates: string[]
  protectedMeals: number
}

/**
 * Fill only free automatic dinner positions. Manual, pinned, eaten and cooked
 * entries are never replaced. Each new automatic dinner gets a real cooking
 * event; a suggested leftover day consumes that same event instead of cooking
 * again. No call happens on app start.
 */
export async function generatePlan(options: GenerateOptions = {}): Promise<GenerateOutcome> {
  const today = options.today ?? todayKey()
  const [settings, lists] = await Promise.all([
    getShoppingSettings(),
    db.shoppingLists.toArray(),
  ])
  const dates = planningDatesForToday(today, settings, lists)
  const recipes = await db.recipes.toArray()
  if (recipes.length === 0) {
    throw new Error('Keine Rezepte in der Bibliothek. Bitte zuerst Rezepte importieren.')
  }

  const candidates = recipes.map(toPlannerRecipe)
  const knownIds = new Set(recipes.map((recipe) => recipe.id))
  const householdSize = await getHouseholdSize()
  const existing = await db.mealPlans.where('date').anyOf(dates).toArray()
  const dayRows = await db.mealDays.where('date').anyOf(dates).toArray()
  const skipped = new Set(dayRows.filter((day) => day.skipped).map((day) => day.date))
  const allEntries = await db.mealPlans.toArray()
  const sessions = await db.cookSessions.toArray()
  const sessionById = new Map(sessions.map((session) => [session.id, session]))

  // The automatic planner owns dinner only. Anything in another slot, and any
  // protected dinner, is never a replaceable proposal.
  const replaceableIds = new Set(
    existing
      .filter(
        (entry) =>
          entry.slot === PRIMARY_SLOT &&
          !isProtectedEntry(
            entry,
            entry.cookSessionId ? sessionById.get(entry.cookSessionId) : undefined,
          ),
      )
      .map((entry) => entry.id),
  )
  const replaceable = existing.filter((entry) => replaceableIds.has(entry.id))
  const protectedEntries = existing.filter((entry) => !replaceableIds.has(entry.id))

  // Any protected dish occupies its whole day for the automatic planner. The
  // calendar shows one surface per day, so a manual lunch or a multi-day group
  // must not receive an additional automatic dinner.
  const occupiedDates = new Set(protectedEntries.map((entry) => entry.date))
  const pinned: Record<string, string> = {}
  for (const entry of protectedEntries) {
    if (entry.slot !== PRIMARY_SLOT) continue
    if (!entry.recipeId || !knownIds.has(entry.recipeId)) continue
    if (entry.date in pinned) continue
    pinned[entry.date] = entry.recipeId
  }
  for (const date of occupiedDates) skipped.add(date)

  const recentlyPlanned: Record<string, string> = {}
  const lastCookedAt: Record<string, string> = {}
  const keepLatest = (map: Record<string, string>, recipeId: string, date: string) => {
    if (!map[recipeId] || date > map[recipeId]!) map[recipeId] = date
  }
  for (const entry of allEntries) {
    // Entries being replaced must not count as recently planned. Free dishes
    // have no recipe id and therefore never influence recipe rotation.
    if (replaceableIds.has(entry.id) || !entry.recipeId) continue
    keepLatest(recentlyPlanned, entry.recipeId, entry.date)
    if (entry.cooked || mealEntryStatus(entry) === 'eaten') {
      keepLatest(lastCookedAt, entry.recipeId, entry.date)
    }
  }

  const plan = generateWeekBest({
    dates,
    skipped,
    pinned,
    candidates,
    recentlyPlanned,
    householdSize,
    today,
    seed: options.seed ?? Date.now(),
    liked: new Set(recipes.filter((recipe) => recipe.favorite).map((recipe) => recipe.id)),
    lastCookedAt,
    weights: weightsForSlot(PRIMARY_SLOT),
    minRepeatGapDays: AUTO_FILL_GAP_DAYS,
    restarts: options.restarts ?? 4,
  })

  const replacedSessionIds = new Set(
    replaceable.map((entry) => entry.cookSessionId).filter((value): value is string => Boolean(value)),
  )
  const pickedDates = Object.keys(plan).sort()
  const leftoverRecipes = new Set(
    pickedDates.filter((date) => plan[date]?.leftover).map((date) => plan[date]!.recipeId),
  )

  const nowValue = now()
  await db.transaction(
    'rw',
    [db.mealPlans, db.mealDays, db.cookSessions, db.cookProgress],
    async () => {
      if (replaceable.length > 0) {
        await db.mealPlans.bulkDelete(replaceable.map((entry) => entry.id))
      }
      for (const sessionId of replacedSessionIds) {
        const session = await db.cookSessions.get(sessionId)
        if (!session?.auto) continue
        const stillUsed = await db.mealPlans.where('cookSessionId').equals(sessionId).count()
        if (stillUsed === 0) {
          await db.cookSessions.delete(sessionId)
          await db.cookProgress.delete(sessionId)
        }
      }

      const sessionByRecipe = new Map<string, CookSession>()
      const autoSessions: CookSession[] = []
      const newEntries: MealPlanEntry[] = []

      for (const date of pickedDates) {
        if (skipped.has(date) || date in pinned) continue
        const pick = plan[date]
        if (!pick) continue

        let session: CookSession | undefined
        if (pick.leftover) {
          const source = sessionByRecipe.get(pick.recipeId)
          if (source) {
            const balance = cookSessionBalance(source, [
              ...newEntries.filter((entry) => entry.cookSessionId === source.id),
            ])
            if (balance.remaining >= householdSize) session = source
          }
        }

        if (!session) {
          const cookServings = leftoverRecipes.has(pick.recipeId) ? householdSize * 2 : householdSize
          session = {
            id: `cook-${randomId()}`,
            recipeId: pick.recipeId,
            date,
            servings: cookServings,
            status: 'planned',
            auto: true,
            createdAt: nowValue,
            updatedAt: nowValue,
          }
          autoSessions.push(session)
          if (!pick.leftover) sessionByRecipe.set(pick.recipeId, session)
        }

        newEntries.push({
          id: `meal-${randomId()}`,
          date,
          slot: PRIMARY_SLOT,
          recipeId: pick.recipeId,
          servings: householdSize,
          position: 0,
          cookSessionId: session.id,
          status: 'planned',
          auto: true,
          pinned: false,
          leftover: pick.leftover,
          cooked: false,
          reasons: pick.reasons,
          createdAt: nowValue,
          updatedAt: nowValue,
        })
      }

      if (autoSessions.length > 0) await db.cookSessions.bulkPut(autoSessions)
      if (newEntries.length > 0) await db.mealPlans.bulkPut(newEntries)
    },
  )

  const emptyDates = dates.filter(
    (date) => !skipped.has(date) && !(date in pinned) && !plan[date],
  )

  return {
    dates,
    plan,
    householdSize,
    emptyDates,
    pinnedDates: Object.keys(pinned),
    skippedDates: Array.from(skipped),
    protectedMeals: protectedEntries.length,
  }
}
