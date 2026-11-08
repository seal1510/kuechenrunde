import { durationMinutes, parseDuration, type ParsedDuration } from './duration'

/** 40 → "40 Min.", 70 → "1 Std. 10 Min.". */
export function formatMinutes(minutes: number): string {
  const total = Math.max(0, Math.round(minutes))
  const hours = Math.floor(total / 60)
  const rest = total % 60
  if (hours > 0 && rest > 0) return `${hours} Std. ${rest} Min.`
  if (hours > 0) return `${hours} Std.`
  return `${rest} Min.`
}

function formatRange(minMinutes: number, maxMinutes: number): string {
  if (minMinutes === maxMinutes) return formatMinutes(minMinutes)
  // Ranges on whole or half hours read best as "2–4 Std." / "6,5–7 Std.".
  if (minMinutes >= 60 && minMinutes % 30 === 0 && maxMinutes % 30 === 0) {
    const hours = (value: number) => (value / 60).toFixed(1).replace(/\.0$/, '').replace('.', ',')
    return `${hours(minMinutes)}–${hours(maxMinutes)} Std.`
  }
  return `${formatMinutes(minMinutes)}–${formatMinutes(maxMinutes)}`
}

/** Render a parsed duration. Ranges stay ranges instead of collapsing to one number. */
export function formatParsedDuration(parsed: ParsedDuration): string {
  return parsed.kind === 'single'
    ? formatMinutes(parsed.minutes)
    : formatRange(parsed.minMinutes, parsed.maxMinutes)
}

/**
 * ISO ("PT40M") or human ("40 min", "2-4 Stunden") duration to a readable
 * German value. Unclear input is returned unchanged instead of inventing a
 * number.
 */
export function formatDuration(value: string | null | undefined): string {
  if (!value?.trim()) return ''
  const parsed = parseDuration(value)
  return parsed ? formatParsedDuration(parsed) : value.trim()
}

function bounds(parsed: ParsedDuration): [number, number] {
  return parsed.kind === 'single'
    ? [parsed.minutes, parsed.minutes]
    : [parsed.minMinutes, parsed.maxMinutes]
}

/** Total time, falling back to prep + cook when Mela has no total. */
export function effectiveDuration(recipe: {
  totalTime: string
  prepTime: string
  cookTime: string
}): string {
  const totalRaw = recipe.totalTime?.trim() ?? ''
  if (totalRaw) {
    const total = parseDuration(totalRaw)
    return total ? formatParsedDuration(total) : totalRaw
  }

  const prepRaw = recipe.prepTime?.trim() ?? ''
  const cookRaw = recipe.cookTime?.trim() ?? ''
  const prep = parseDuration(prepRaw)
  const cook = parseDuration(cookRaw)

  // If one component is present but not understood, do not silently drop it.
  if ((prepRaw && !prep) || (cookRaw && !cook)) {
    return [prepRaw, cookRaw].filter(Boolean).join(' · ')
  }
  if (prep || cook) {
    const prepBounds = prep ? bounds(prep) : ([0, 0] as const)
    const cookBounds = cook ? bounds(cook) : ([0, 0] as const)
    return formatParsedDuration({
      kind: 'range',
      minMinutes: prepBounds[0] + cookBounds[0],
      maxMinutes: prepBounds[1] + cookBounds[1],
    })
  }
  return [prepRaw, cookRaw].filter(Boolean).join(' · ')
}

/**
 * Minutes for sorting, using the same rules as `effectiveDuration`: total time
 * when present, otherwise prep + cook. Any non-empty but unclear value makes
 * the duration unknown instead of guessing.
 */
export function effectiveDurationMinutes(recipe: {
  totalTime: string
  prepTime: string
  cookTime: string
}): number | null {
  const totalRaw = recipe.totalTime?.trim() ?? ''
  if (totalRaw) return durationMinutes(totalRaw)

  const prepRaw = recipe.prepTime?.trim() ?? ''
  const cookRaw = recipe.cookTime?.trim() ?? ''
  const prep = durationMinutes(prepRaw)
  const cook = durationMinutes(cookRaw)
  if ((prepRaw && prep === null) || (cookRaw && cook === null)) return null
  if (prep === null && cook === null) return null
  return (prep ?? 0) + (cook ?? 0)
}

/** 6 → "6 Portionen", 1 → "1 Portion", 2.5 → "2,5 Portionen". */
export function formatPortionCount(value: number): string {
  const formatted = Number.isInteger(value) ? String(value) : value.toLocaleString('de-DE')
  return `${formatted} ${value === 1 ? 'Portion' : 'Portionen'}`
}

/** 1.5 → "1,5"; whole values keep no decimals. */
export function formatFactor(value: number): string {
  return value.toLocaleString('de-DE', { maximumFractionDigits: 2 })
}

/**
 * "4" → "4 Portionen", "1" → "1 Portion", "4 Portionen" stays as-is.
 * Avoids the bare "40 · 2" values in cards.
 */
export function formatServings(text: string | null | undefined, number: number | null): string {
  const value = text?.trim() ?? ''
  if (!value) {
    if (number !== null && number > 0) return `${number} ${number === 1 ? 'Portion' : 'Portionen'}`
    return ''
  }
  if (/^\d+$/.test(value)) {
    return `${value} ${value === '1' ? 'Portion' : 'Portionen'}`
  }
  if (/^\d+\s*[-–]\s*\d+$/.test(value)) {
    return `${value.replace(/\s*[-–]\s*/, '–')} Portionen`
  }
  if (/portion|person|serving|stück|stueck/i.test(value)) return value
  return `${value} Portionen`
}
