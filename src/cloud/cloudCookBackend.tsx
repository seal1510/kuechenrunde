/*
 * Küchenrunde – Kochmodus im Cloud-Modus
 * Copyright (C) 2026 openCook Web contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Rezept und geplanter Kochvorgang werden aus dem CloudRecordsStore gelesen.
 * Der Schrittfortschritt bleibt gerätelokal in der bestehenden `cookProgress`-
 * Tabelle; beim Speichern wird lediglich geprüft, ob der gemeinsame
 * Kochvorgang noch existiert. Timer und Wake Lock waren nie Cloud-Daten.
 */

import { useCallback, useMemo, useSyncExternalStore } from 'react'
import { CloudRecordsStore } from '../data/cloudRecords'
import {
  loadCookProgress,
  saveCookProgress,
} from '../mealplan/cookProgress'
import type { CookBackend, CookData } from '../cook/cookBackend'
import type { CookSession, Recipe } from '../types'

/**
 * Pure read model used by the hook and by tests. A session id is only valid
 * when it belongs to the requested recipe; a stale link never borrows portions
 * from another dish.
 */
export function readCookData(
  store: CloudRecordsStore,
  recipeId: string,
  cookSessionId: string | null,
): CookData | undefined {
  if (!store.isLoaded()) return undefined
  const recipeRow = store.get<Recipe>('recipes', recipeId)
  const sessionRow = cookSessionId
    ? store.get<CookSession>('cookSessions', cookSessionId)
    : undefined
  const session = sessionRow?.data
  const validSession =
    session && session.recipeId === recipeId ? session : undefined
  return {
    recipe: recipeRow?.data ?? null,
    sessionServings: validSession?.servings ?? null,
    sessionId: validSession?.id ?? null,
    sessionMissing: Boolean(cookSessionId) && !validSession,
    loadError: null,
  }
}

function useStoreVersion(store: CloudRecordsStore): number {
  const subscribe = useCallback(
    (onStoreChange: () => void) => store.subscribe(onStoreChange),
    [store],
  )
  const getSnapshot = useCallback(() => store.getVersion(), [store])
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

export function createCloudCookBackend(store: CloudRecordsStore): CookBackend {
  return {
    useCookData(recipeId, cookSessionId) {
      const version = useStoreVersion(store)
      return useMemo(
        () => readCookData(store, recipeId, cookSessionId),
        [store, version, recipeId, cookSessionId],
      )
    },

    loadProgress: (cookSessionId) => loadCookProgress(cookSessionId),

    saveProgress: (cookSessionId, stepIndex) =>
      saveCookProgress(cookSessionId, stepIndex, {
        sessionExists: () =>
          store.isLoaded() &&
          Boolean(store.get<CookSession>('cookSessions', cookSessionId)),
      }),

    // Local progress is pruned only after consulting the local plan table.
    // Cloud mode deliberately does not read that table; stale local rows are
    // harmless and can be pruned the next time local mode is used.
    pruneOrphanedProgress: async () => 0,
  }
}
