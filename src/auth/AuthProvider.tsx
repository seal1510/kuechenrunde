/*
 * Küchenrunde – AuthProvider
 * Copyright (C) 2026 openCook Web contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Dünne React-Hülle um den CloudSessionController. Die eigentliche Logik
 * (Session, Snapshot-Bootstrap, Konflikte, Logout-Cleanup) ist React-frei
 * in cloudSession.ts und dort testbar.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { CloudRecordsStore } from '../data/cloudRecords'
import { CloudNotConfiguredError, supabase } from '../supabase/client'
import { createSupabaseRecordsBackend } from '../supabase/recordsBackend'
import {
  CloudSessionController,
  type CloudSessionState,
} from './cloudSession'
import { createSupabaseAuthPort } from './supabaseAuthPort'

export interface CloudAuthApi {
  state: CloudSessionState
  /** Geladener Cloud-Store; null außerhalb des Bereitschaftszustands. */
  store: CloudRecordsStore | null
  signIn: (email: string, password: string) => Promise<void>
  logout: () => Promise<void>
  retry: () => Promise<void>
}

const CloudAuthContext = createContext<CloudAuthApi | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<CloudSessionState>({ status: 'checking' })
  const [store, setStore] = useState<CloudRecordsStore | null>(null)
  const controllerRef = useRef<CloudSessionController<CloudRecordsStore> | null>(
    null,
  )

  useEffect(() => {
    const client = supabase
    if (!client) return

    const controller = new CloudSessionController<CloudRecordsStore>({
      auth: createSupabaseAuthPort(),
      createStore: () =>
        new CloudRecordsStore(createSupabaseRecordsBackend(client)),
      onChange: setState,
      onStoreChange: setStore,
    })
    controllerRef.current = controller
    void controller.start()

    return () => {
      controller.dispose()
      if (controllerRef.current === controller) {
        controllerRef.current = null
      }
    }
  }, [])

  const signIn = useCallback(async (email: string, password: string) => {
    const controller = controllerRef.current
    if (!controller) throw new CloudNotConfiguredError()
    await controller.signIn(email, password)
  }, [])

  const logout = useCallback(async () => {
    await controllerRef.current?.logout()
  }, [])

  const retry = useCallback(async () => {
    await controllerRef.current?.retry()
  }, [])

  const value = useMemo<CloudAuthApi>(
    () => ({ state, store, signIn, logout, retry }),
    [state, store, signIn, logout, retry],
  )

  return <CloudAuthContext.Provider value={value}>{children}</CloudAuthContext.Provider>
}

export function useAuth(): CloudAuthApi {
  const value = useContext(CloudAuthContext)
  if (!value) {
    throw new Error('useAuth muss innerhalb von AuthProvider verwendet werden.')
  }
  return value
}
