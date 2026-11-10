/*
 * Küchenrunde – Datenschnittstelle des Kochmodus
 * Copyright (C) 2026 openCook Web contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Rezept und geplanter Kochvorgang kommen im Cloud-Modus aus dem
 * CloudRecordsStore. Der temporäre Schrittfortschritt bleibt wie bisher
 * gerätelokal; Timer und Wake Lock waren nie Teil der gemeinsamen Daten.
 */

import { createContext, useContext } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db'
import {
  loadCookProgress,
  pruneOrphanedCookProgress,
  saveCookProgress,
} from '../mealplan/cookProgress'
import type { Recipe } from '../types'

export interface CookData {
  recipe: Recipe | null
  sessionServings: number | null
  sessionId: string | null
  sessionMissing: boolean
  /** A database/loading failure must not crash the whole app. */
  loadError: string | null
}

export interface CookBackend {
  useCookData(
    recipeId: string,
    cookSessionId: string | null,
  ): CookData | undefined
  /** Device-local step progress for one planned cooking event. */
  loadProgress(cookSessionId: string): Promise<number | null>
  /** Device-local step progress; the shared session must still exist. */
  saveProgress(cookSessionId: string, stepIndex: number): Promise<void>
  /** Targeted local cleanup only; cloud returns 0 and touches no local plan table. */
  pruneOrphanedProgress(): Promise<number>
}

function emptyFailure(cause: unknown): CookData {
  return {
    recipe: null,
    sessionServings: null,
    sessionId: null,
    sessionMissing: false,
    loadError: (cause as Error)?.message || 'Unbekannter Datenbankfehler.',
  }
}

/**
 * Local adapter. It keeps the previous live query and the exact same
 * validation of a planned cooking event.
 */
export const localCookBackend: CookBackend = {
  useCookData(recipeId, cookSessionId) {
    return useLiveQuery<CookData>(async () => {
      try {
        const recipe = await db.recipes.get(recipeId)
        const session = cookSessionId
          ? await db.cookSessions.get(cookSessionId)
          : undefined
        // A session id must belong to this recipe; never borrow portions from an
        // unrelated dish just because a stale link contains the id.
        const validSession = session && session.recipeId === recipeId ? session : undefined
        return {
          recipe: recipe ?? null,
          sessionServings: validSession?.servings ?? null,
          sessionId: validSession?.id ?? null,
          sessionMissing: Boolean(cookSessionId) && !validSession,
          loadError: null,
        }
      } catch (cause) {
        return emptyFailure(cause)
      }
    }, [recipeId, cookSessionId])
  },

  loadProgress: (cookSessionId) => loadCookProgress(cookSessionId),
  saveProgress: (cookSessionId, stepIndex) =>
    saveCookProgress(cookSessionId, stepIndex),
  pruneOrphanedProgress: () => pruneOrphanedCookProgress(),
}

const CookBackendContext = createContext<CookBackend>(localCookBackend)

export const CookBackendProvider = CookBackendContext.Provider

export function useCookBackend(): CookBackend {
  return useContext(CookBackendContext)
}
