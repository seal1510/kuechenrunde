/*
 * Küchenrunde (vormals openCook Web)
 * Copyright (C) 2026 openCook Web contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Hash-route resolution shared by the app shell and navigation links.
 *
 * The parser is deliberately small but strict: static routes are matched
 * before dynamic recipe routes, leading hashes/slashes and trailing slashes are
 * normalised, and anything unknown falls back to the library. Keeping this in
 * one module makes the mapping testable without React or a browser.
 */

export type Route =
  | { name: 'library' }
  | { name: 'recipe'; id: string }
  | { name: 'recipe-new' }
  | { name: 'recipe-edit'; id: string }
  | { name: 'cook'; recipeId: string; cookSessionId: string | null }
  | { name: 'plan' }
  | { name: 'shopping' }
  | { name: 'import' }
  | { name: 'import-url' }
  | { name: 'backup' }
  | { name: 'family' }
  | { name: 'about' }

/** Single source of truth for the URL-import link target. */
export const URL_IMPORT_HASH = '#/import/url'

/**
 * Single source of truth for cook-mode links. Recipe and session ids are
 * encoded exactly once; an absent session deliberately produces the plain
 * recipe cook route that `CookPage` already supports.
 */
export function cookHash(recipeId: string, cookSessionId?: string | null): string {
  const base = `#/recipe/${encodeURIComponent(recipeId)}/cook`
  const session = cookSessionId?.trim()
  return session ? `${base}?session=${encodeURIComponent(session)}` : base
}

/** Remove a leading "#", leading slashes and trailing slashes. */
export function normalizeHash(hash: string): string {
  let clean = String(hash ?? '').trim()
  if (clean.startsWith('#')) clean = clean.slice(1)
  clean = clean.replace(/^\/+/, '')
  clean = clean.replace(/\/+$/, '')
  return clean
}

function decodeId(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    // A malformed percent sequence must not crash the whole app.
    return value
  }
}

export function parseRoute(hash: string): Route {
  const clean = normalizeHash(hash)
  if (!clean) return { name: 'library' }

  // The cook mode carries an optional session id so a planned cooking event
  // and a library recipe remain distinguishable without a second route table.
  // Split the query at the first "?" and normalise trailing slashes on the
  // path only. This keeps a copied link like
  // "#/recipe/r1/cook/?session=s1" valid instead of treating "cook/" as part
  // of the recipe id.
  const queryIndex = clean.indexOf('?')
  const pathPart = queryIndex === -1 ? clean : clean.slice(0, queryIndex)
  const queryPart = queryIndex === -1 ? '' : clean.slice(queryIndex + 1)
  const path = pathPart.replace(/\/+$/, '')
  const query = new URLSearchParams(queryPart)

  // Static routes are checked first. In particular "import/url" must never be
  // swallowed by a broader prefix or by the "import" route.
  if (path === 'plan') return { name: 'plan' }
  if (path === 'shopping') return { name: 'shopping' }
  if (path === 'import') return { name: 'import' }
  if (path === 'import/url') return { name: 'import-url' }
  if (path === 'backup') return { name: 'backup' }
  if (path === 'family') return { name: 'family' }
  if (path === 'about') return { name: 'about' }
  if (path === 'recipe/new') return { name: 'recipe-new' }

  if (path.startsWith('recipe/') && path.endsWith('/cook')) {
    const id = decodeId(path.slice('recipe/'.length, -'/cook'.length))
    if (!id) return { name: 'library' }
    const session = query.get('session')?.trim() || null
    return { name: 'cook', recipeId: id, cookSessionId: session }
  }
  if (path.startsWith('recipe/') && path.endsWith('/edit')) {
    const id = decodeId(path.slice('recipe/'.length, -'/edit'.length))
    return id ? { name: 'recipe-edit', id } : { name: 'library' }
  }
  if (path.startsWith('recipe/')) {
    const id = decodeId(path.slice('recipe/'.length))
    return id ? { name: 'recipe', id } : { name: 'library' }
  }

  return { name: 'library' }
}
