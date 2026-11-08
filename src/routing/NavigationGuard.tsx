/*
 * openCook Web
 * Copyright (C) 2026 openCook Web contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * React integration for the central hash-navigation guard. The controller does
 * the history bookkeeping; this file owns the shared prompt, link interception
 * and the beforeunload fallback supported by browsers.
 */

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import {
  NavigationGuardController,
  UNSAVED_CHANGES_QUESTION,
  type NavigationPrompt,
} from './navigationGuardController'

const NavigationGuardContext = createContext<NavigationGuardController | null>(null)

export interface NavigationGuardProviderProps {
  applyRoute: (hash: string) => void
  children: ReactNode
}

export function NavigationGuardProvider({
  applyRoute,
  children,
}: NavigationGuardProviderProps) {
  const [prompt, setPrompt] = useState<NavigationPrompt | null>(null)
  const applyRouteRef = useRef(applyRoute)
  applyRouteRef.current = applyRoute

  const [controller] = useState(
    () =>
      new NavigationGuardController({
        history: window.history,
        location: window.location,
        applyRoute: (hash) => applyRouteRef.current(hash),
        onPromptChange: setPrompt,
      }),
  )

  useEffect(() => {
    const handleHashChange = () => {
      controller.handleLocationChange()
    }

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!controller.isDirty()) return
      event.preventDefault()
      // Browsers show their own generic wording; the value only opts in.
      event.returnValue = ''
    }

    const handleLinkClick = (event: MouseEvent) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return
      }
      const target = event.target
      if (!(target instanceof Element)) return
      const anchor = target.closest<HTMLAnchorElement>('a[href]')
      if (!anchor || anchor.dataset.skipUnsavedGuard === 'true') return
      if (anchor.target && anchor.target !== '_self') return
      if (anchor.hasAttribute('download')) return

      const next = new URL(anchor.href, window.location.href)
      const current = new URL(window.location.href)
      if (
        next.origin !== current.origin ||
        next.pathname !== current.pathname ||
        next.search !== current.search ||
        next.hash === current.hash
      ) {
        return
      }
      if (!controller.shouldPromptFor(next.hash)) return

      event.preventDefault()
      event.stopPropagation()
      controller.requestAction(() => {
        window.location.hash = next.hash
      }, next.hash)
    }

    window.addEventListener('hashchange', handleHashChange)
    window.addEventListener('beforeunload', handleBeforeUnload)
    document.addEventListener('click', handleLinkClick, true)
    return () => {
      window.removeEventListener('hashchange', handleHashChange)
      window.removeEventListener('beforeunload', handleBeforeUnload)
      document.removeEventListener('click', handleLinkClick, true)
    }
  }, [controller])

  useEffect(() => {
    if (!prompt) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      controller.cancelPending()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [controller, prompt])

  return (
    <NavigationGuardContext.Provider value={controller}>
      {children}
      <UnsavedChangesDialog
        open={Boolean(prompt)}
        onContinue={() => controller.cancelPending()}
        onDiscard={() => controller.confirmPending()}
      />
    </NavigationGuardContext.Provider>
  )
}

export function useNavigationGuard(): NavigationGuardController {
  const controller = useContext(NavigationGuardContext)
  if (!controller) {
    throw new Error('NavigationGuardProvider fehlt.')
  }
  return controller
}

export interface UnsavedChangesGuard {
  requestLeave: (action: () => void, hash: string) => void
  allowNextNavigation: (hash: string) => void
}

export function useUnsavedChangesGuard(
  dirty: boolean,
  enabled = true,
): UnsavedChangesGuard {
  const controller = useNavigationGuard()
  const dirtyRef = useRef(dirty)
  dirtyRef.current = dirty

  useEffect(() => {
    if (!enabled) return
    return controller.register(() => dirtyRef.current)
  }, [controller, enabled])

  return useMemo(
    () => ({
      requestLeave: (action: () => void, hash: string) =>
        controller.requestAction(action, hash),
      allowNextNavigation: (hash: string) => controller.allowNextNavigation(hash),
    }),
    [controller],
  )
}

export interface UnsavedChangesDialogProps {
  open: boolean
  onContinue: () => void
  onDiscard: () => void
}

export function UnsavedChangesDialog({
  open,
  onContinue,
  onDiscard,
}: UnsavedChangesDialogProps) {
  if (!open) return null
  return (
    <div
      className="unsaved-dialog-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget) onContinue()
      }}
    >
      <div
        className="unsaved-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="unsaved-dialog-title"
        aria-describedby="unsaved-dialog-description"
      >
        <h2 id="unsaved-dialog-title">{UNSAVED_CHANGES_QUESTION}</h2>
        <p id="unsaved-dialog-description">
          Nicht gespeicherte Eingaben gehen beim Verlassen verloren.
        </p>
        <div className="unsaved-dialog-actions">
          <button type="button" className="button" autoFocus onClick={onContinue}>
            Weiter bearbeiten
          </button>
          <button type="button" className="button danger" onClick={onDiscard}>
            Verwerfen und verlassen
          </button>
        </div>
      </div>
    </div>
  )
}
