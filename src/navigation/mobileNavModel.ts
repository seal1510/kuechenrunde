/*
 * Küchenrunde – mobile navigation model
 * Copyright (C) 2026 openCook Web contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The mobile shell deliberately reuses the existing hash routes. This module
 * only maps a parsed route to one of the three bottom-navigation areas and
 * describes the secondary entries of the "Mehr" sheet. Keeping the mapping
 * free of React makes the active-state rules directly testable.
 */

import { PHOTO_IMPORT_HASH, URL_IMPORT_HASH, type Route } from '../routing/routes'

export type MobileArea = 'recipes' | 'plan' | 'shopping'

export interface MobileNavItem {
  area: MobileArea
  label: string
  href: string | null
}

/** The three permanent destinations of the phone navigation. */
export const MOBILE_NAV_ITEMS: readonly MobileNavItem[] = [
  { area: 'recipes', label: 'Rezepte', href: '#/' },
  { area: 'plan', label: 'Wochenplan', href: '#/plan' },
  { area: 'shopping', label: 'Einkauf', href: '#/shopping' },
] as const

/**
 * Recipe details, the editor and cook mode all belong to the recipe area, so
 * "Rezepte" stays highlighted while the user is inside that flow.
 */
export function isLibraryArea(route: Route): boolean {
  return (
    route.name === 'library' ||
    route.name === 'recipe' ||
    route.name === 'recipe-new' ||
    route.name === 'recipe-edit' ||
    route.name === 'cook'
  )
}

/**
 * Secondary pages keep the three main destinations visible but none of them
 * is the current page, so no bottom item receives the active highlight.
 */
export function mobileAreaForRoute(route: Route): MobileArea | null {
  if (isLibraryArea(route)) return 'recipes'
  if (route.name === 'plan') return 'plan'
  if (route.name === 'shopping') return 'shopping'
  return null
}

export interface MoreMenuLink {
  href: string
  label: string
  icon: 'url' | 'photo' | 'mela' | 'backup' | 'family' | 'about'
}

const BASE_MORE_LINKS: readonly MoreMenuLink[] = [
  { href: URL_IMPORT_HASH, label: 'URL-Rezeptimport', icon: 'url' },
  { href: '#/import', label: 'Mela-Import', icon: 'mela' },
  { href: '#/backup', label: 'Backup', icon: 'backup' },
]

/**
 * Foto-/Scan-Import ist ein Cloud-Dienst. Der Eintrag erscheint deshalb nur,
 * wenn auch die Cloud-Familienverwaltung sichtbar ist.
 */
const PHOTO_LINK: MoreMenuLink = {
  href: PHOTO_IMPORT_HASH,
  label: 'Foto / Scan',
  icon: 'photo',
}

const FAMILY_LINK: MoreMenuLink = {
  href: '#/family',
  label: 'Familie verwalten',
  icon: 'family',
}

const ABOUT_LINK: MoreMenuLink = {
  href: '#/about',
  label: 'Über Küchenrunde',
  icon: 'about',
}

/**
 * Secondary entries shown in the "Mehr" sheet. The family entry only exists in
 * cloud mode; local mode keeps import, backup and the about page.
 */
export function moreMenuLinks(includeFamily: boolean): MoreMenuLink[] {
  const links = [...BASE_MORE_LINKS]
  if (includeFamily) links.push(PHOTO_LINK)
  if (includeFamily) links.push(FAMILY_LINK)
  links.push(ABOUT_LINK)
  return links
}

/** Stable key used to close the sheet whenever the visible route changes. */
export function mobileRouteKey(route: Route): string {
  switch (route.name) {
    case 'recipe':
      return `recipe:${route.id}`
    case 'recipe-edit':
      return `recipe-edit:${route.id}`
    case 'cook':
      return `cook:${route.recipeId}:${route.cookSessionId ?? ''}`
    default:
      return route.name
  }
}
