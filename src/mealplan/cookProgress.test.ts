import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../db'
import type { CookSession, MealPlanEntry } from '../types'
import {
  loadCookProgress,
  pruneOrphanedCookProgress,
  resetCookProgress,
  saveCookProgress,
} from './cookProgress'
import { deleteCookSession } from './service'

function session(id: string, servings = 4): CookSession {
  return {
    id,
    recipeId: 'r1',
    date: '2026-05-25',
    servings,
    status: 'planned',
    auto: false,
    createdAt: 1,
    updatedAt: 1,
  }
}

beforeEach(async () => {
  await db.cookSessions.clear()
  await db.cookProgress.clear()
  await db.mealPlans.clear()
})

describe('cook progress', () => {
  it('keeps progress separate for two cooking events of the same recipe', async () => {
    await db.cookSessions.bulkPut([session('cook-a'), session('cook-b')])
    await saveCookProgress('cook-a', 2)
    await saveCookProgress('cook-b', 0)
    expect(await loadCookProgress('cook-a')).toBe(2)
    expect(await loadCookProgress('cook-b')).toBe(0)
  })

  it('does not create progress for a missing cooking event', async () => {
    await saveCookProgress('missing', 5)
    expect(await db.cookProgress.count()).toBe(0)
  })

  it('removes progress with the deleted cooking event', async () => {
    await db.cookSessions.bulkPut([session('cook-a'), session('cook-b')])
    await saveCookProgress('cook-a', 3)
    await saveCookProgress('cook-b', 1)
    await deleteCookSession('cook-a', 'detach')
    expect(await loadCookProgress('cook-a')).toBeNull()
    expect(await loadCookProgress('cook-b')).toBe(1)
  })

  it('can reset only the intended cooking event', async () => {
    await db.cookSessions.bulkPut([session('cook-a'), session('cook-b')])
    await saveCookProgress('cook-a', 4)
    await saveCookProgress('cook-b', 2)
    await resetCookProgress('cook-a')
    expect(await loadCookProgress('cook-a')).toBeNull()
    expect(await loadCookProgress('cook-b')).toBe(2)
  })

  it('prunes orphaned rows but keeps valid progress', async () => {
    await db.cookSessions.put(session('cook-a'))
    await saveCookProgress('cook-a', 1)
    await db.cookProgress.put({ cookSessionId: 'orphan', stepIndex: 5, updatedAt: 1 })
    expect(await pruneOrphanedCookProgress()).toBe(1)
    expect(await loadCookProgress('cook-a')).toBe(1)
    expect(await db.cookProgress.get('orphan')).toBeUndefined()
  })

  it('stores only the step and never changes cooking or meal status', async () => {
    const plan: MealPlanEntry = {
      id: 'meal-a',
      date: '2026-05-25',
      slot: 'dinner',
      recipeId: 'r1',
      cookSessionId: 'cook-a',
      servings: 4,
      position: 0,
      status: 'planned',
      auto: false,
      pinned: false,
      leftover: false,
      cooked: false,
      reasons: [],
      createdAt: 1,
      updatedAt: 1,
    }
    await db.cookSessions.put(session('cook-a'))
    await db.mealPlans.put(plan)

    await saveCookProgress('cook-a', 2)

    expect(await loadCookProgress('cook-a')).toBe(2)
    expect((await db.cookSessions.get('cook-a'))?.status).toBe('planned')
    expect((await db.mealPlans.get('meal-a'))?.status).toBe('planned')
    expect((await db.mealPlans.get('meal-a'))?.cooked).toBe(false)
  })
})
