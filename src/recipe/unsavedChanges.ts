/*
 * openCook Web
 * Copyright (C) 2026 openCook Web contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Local unsaved-changes guard. The editor does not own the hash router, so
 * this hook only adds standard browser protection: beforeunload for closing or
 * reloading the tab, and a capture-phase link check for the app's hash links.
 * It never changes or saves recipe data.
 */

import { useEffect, useRef } from 'react'

export const UNSAVED_CHANGES_MESSAGE =
  'Es gibt ungespeicherte Änderungen. Möchtest du den Editor wirklich verlassen?'

export function confirmDiscardChanges(dirty: boolean): boolean {
  if (!dirty) return true
  return window.confirm(UNSAVED_CHANGES_MESSAGE)
}

export function useUnsavedChangesGuard(dirty: boolean, enabled = true): void {
  const dirtyRef = useRef(dirty)
  dirtyRef.current = dirty

  useEffect(() => {
    if (!enabled) return

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirtyRef.current) return
      event.preventDefault()
      // Browsers show their own generic wording; the value only opts in.
      event.returnValue = ''
    }

    const handleLinkClick = (event: MouseEvent) => {
      if (
        !dirtyRef.current ||
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
      // beforeunload handles leaving the page. This click guard only covers
      // in-app hash links, which do not trigger beforeunload.
      if (
        next.origin !== current.origin ||
        next.pathname !== current.pathname ||
        next.search !== current.search ||
        next.hash === current.hash
      ) {
        return
      }
      if (!window.confirm(UNSAVED_CHANGES_MESSAGE)) {
        event.preventDefault()
        event.stopPropagation()
      }
    }

    window.addEventListener('beforeunload', handleBeforeUnload)
    document.addEventListener('click', handleLinkClick, true)
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload)
      document.removeEventListener('click', handleLinkClick, true)
    }
  }, [enabled])
}
