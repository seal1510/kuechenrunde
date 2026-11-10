/*
 * Küchenrunde – Signed-URL-Zugriff für React
 * Copyright (C) 2026 openCook Web contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Stellt Signed URLs für private Rezeptbilder bereit, erneuert sie vor dem
 * Ablauf und räumt Timer beim Unmount auf. Lokale Ansichten ohne Provider
 * erhalten bewusst den Zustand `idle` und bleiben unverändert.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import type { CloudImageUrlCache } from '../data/cloudImageUrls'

export type CloudImageUrlStatus = 'idle' | 'loading' | 'ready' | 'error'

export interface CloudImageUrlState {
  status: CloudImageUrlStatus
  url: string | null
  error: string
}

const IDLE_STATE: CloudImageUrlState = { status: 'idle', url: null, error: '' }

const CloudImageUrlContext = createContext<CloudImageUrlCache | null>(null)

export function CloudImageUrlProvider({
  cache,
  children,
}: {
  cache: CloudImageUrlCache
  children: ReactNode
}) {
  return (
    <CloudImageUrlContext.Provider value={cache}>
      {children}
    </CloudImageUrlContext.Provider>
  )
}

export function useCloudImageUrlCache(): CloudImageUrlCache | null {
  return useContext(CloudImageUrlContext)
}

function messageFor(cause: unknown): string {
  if (cause instanceof Error && cause.message.trim()) return cause.message
  return 'Das Bild konnte nicht geladen werden.'
}

/**
 * Signed URL für ein einzelnes Bild. Erneuert sich automatisch kurz vor dem
 * Ablauf und beim Zurückkehren in den sichtbaren Tab.
 */
export function useCloudImageUrl(path: string | null | undefined): CloudImageUrlState & {
  retry: () => void
} {
  const cache = useCloudImageUrlCache()
  const [state, setState] = useState<CloudImageUrlState>(IDLE_STATE)
  const [retryToken, setRetryToken] = useState(0)
  const retry = useCallback(() => setRetryToken((value) => value + 1), [])

  useEffect(() => {
    if (!cache || !path) {
      setState(IDLE_STATE)
      return
    }

    let active = true
    let timer: ReturnType<typeof setTimeout> | null = null

    const schedule = (refreshAt: number) => {
      if (timer) clearTimeout(timer)
      const delay = Math.max(1000, refreshAt - Date.now() + 50)
      timer = setTimeout(() => {
        void load()
      }, delay)
    }

    const load = async (): Promise<void> => {
      if (!active) return
      const known = cache.peek(path)
      if (known && Date.now() < known.refreshAt) {
        setState({ status: 'ready', url: known.url, error: '' })
      } else if (!known) {
        setState((previous) =>
          previous.status === 'ready'
            ? previous
            : { status: 'loading', url: null, error: '' },
        )
      }
      try {
        const entry = await cache.getUrl(path)
        if (!active) return
        setState({ status: 'ready', url: entry.url, error: '' })
        schedule(entry.refreshAt)
      } catch (cause) {
        if (!active) return
        setState((previous) => ({
          status: previous.url ? 'ready' : 'error',
          url: previous.url,
          error: messageFor(cause),
        }))
      }
    }

    const onVisibility = () => {
      if (document.visibilityState === 'visible') void load()
    }

    void load()
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      active = false
      if (timer) clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [cache, path, retryToken])

  return { ...state, retry }
}

/**
 * Signed URLs für eine ganze Bildliste (Galerie). Teilt den Cache mit allen
 * anderen Ansichten und erneuert jede URL unabhängig.
 */
export function useCloudImageUrls(
  paths: readonly string[],
): Record<string, CloudImageUrlState> {
  const cache = useCloudImageUrlCache()
  const key = useMemo(() => [...new Set(paths)].join('\u0000'), [paths])
  const [states, setStates] = useState<Record<string, CloudImageUrlState>>({})

  useEffect(() => {
    const unique = key ? key.split('\u0000') : []
    if (!cache || unique.length === 0) {
      setStates({})
      return
    }

    let active = true
    const timers = new Map<string, ReturnType<typeof setTimeout>>()

    const update = (path: string, next: CloudImageUrlState) => {
      if (!active) return
      setStates((previous) => {
        const current = previous[path]
        if (
          current &&
          current.status === next.status &&
          current.url === next.url &&
          current.error === next.error
        ) {
          return previous
        }
        return { ...previous, [path]: next }
      })
    }

    const schedule = (path: string, refreshAt: number) => {
      const existing = timers.get(path)
      if (existing) clearTimeout(existing)
      const delay = Math.max(1000, refreshAt - Date.now() + 50)
      timers.set(
        path,
        setTimeout(() => {
          void load(path)
        }, delay),
      )
    }

    const load = async (path: string): Promise<void> => {
      if (!active) return
      const known = cache.peek(path)
      if (known && Date.now() < known.refreshAt) {
        update(path, { status: 'ready', url: known.url, error: '' })
      } else if (!known) {
        update(path, { status: 'loading', url: null, error: '' })
      }
      try {
        const entry = await cache.getUrl(path)
        if (!active) return
        update(path, { status: 'ready', url: entry.url, error: '' })
        schedule(path, entry.refreshAt)
      } catch (cause) {
        if (!active) return
        setStates((previous) => {
          const current = previous[path]
          return {
            ...previous,
            [path]: {
              status: current?.url ? 'ready' : 'error',
              url: current?.url ?? null,
              error: messageFor(cause),
            },
          }
        })
      }
    }

    const onVisibility = () => {
      if (document.visibilityState !== 'visible') return
      for (const path of unique) void load(path)
    }

    for (const path of unique) void load(path)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      active = false
      for (const timer of timers.values()) clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [cache, key])

  return states
}
