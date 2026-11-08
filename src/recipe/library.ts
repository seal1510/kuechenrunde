import type { Recipe } from '../types'
import { effectiveDurationMinutes } from '../lib/format'

export type LibrarySort = 'az' | 'created' | 'updated' | 'duration'

export const LIBRARY_SORT_OPTIONS: Array<{ value: LibrarySort; label: string }> = [
  { value: 'az', label: 'A–Z' },
  { value: 'created', label: 'Zuletzt hinzugefügt' },
  { value: 'updated', label: 'Zuletzt bearbeitet' },
  { value: 'duration', label: 'Dauer aufsteigend' },
]

const collator = new Intl.Collator('de', { sensitivity: 'base' })
const byTitle = (a: Recipe, b: Recipe) => collator.compare(a.title, b.title)

/** Sort a filtered recipe list without mutating the input. */
export function sortRecipes(recipes: readonly Recipe[], sort: LibrarySort): Recipe[] {
  const list = [...recipes]
  switch (sort) {
    case 'created':
      return list.sort((a, b) => b.createdAt - a.createdAt || byTitle(a, b))
    case 'updated':
      return list.sort((a, b) => b.updatedAt - a.updatedAt || byTitle(a, b))
    case 'duration':
      return list.sort((a, b) => {
        const first = effectiveDurationMinutes(a)
        const second = effectiveDurationMinutes(b)
        if (first === null && second === null) return byTitle(a, b)
        if (first === null) return 1
        if (second === null) return -1
        return first - second || byTitle(a, b)
      })
    default:
      return list.sort(byTitle)
  }
}
