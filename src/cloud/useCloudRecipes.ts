/*
 * Küchenrunde – Cloud-Rezeptdaten für React
 * Copyright (C) 2026 openCook Web contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Die Hooks abonnieren den CloudRecordsStore über useSyncExternalStore.
 * Dadurch reagieren Bibliothek und Detail auf eigene Schreibvorgänge und auf
 * Realtime-Ereignisse anderer Sitzungen, ohne Dexie oder useLiveQuery.
 */

import { useCallback, useMemo, useSyncExternalStore } from 'react'
import type { CloudRecordsStore, RecordRow } from '../data/cloudRecords'
import type { Recipe } from '../types'

function useStoreVersion(store: CloudRecordsStore | null): number {
  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      if (!store) return () => {}
      return store.subscribe(onStoreChange)
    },
    [store],
  )
  const getSnapshot = useCallback(() => store?.getVersion() ?? 0, [store])
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

export function useCloudRecipes(
  store: CloudRecordsStore | null,
): Recipe[] | undefined {
  const version = useStoreVersion(store)
  return useMemo(() => {
    if (!store) return undefined
    return store
      .list<Recipe>('recipes')
      .map((row) => row.data)
      .sort((a, b) => b.updatedAt - a.updatedAt)
  }, [store, version])
}

export function useCloudRecipe(
  store: CloudRecordsStore | null,
  id: string,
): RecordRow<Recipe> | null | undefined {
  const version = useStoreVersion(store)
  return useMemo(() => {
    if (!store) return undefined
    return store.get<Recipe>('recipes', id) ?? null
  }, [store, id, version])
}
