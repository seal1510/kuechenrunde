/*
 * Küchenrunde – relative week labels
 * Copyright (C) 2026 openCook Web contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Shared wording for the mobile week header and the move dialog. The numeric
 * offset is always derived from the calendar helpers, never calculated here.
 */

export function weekRelationLabel(offset: number): string {
  if (offset === 0) return 'Diese Woche'
  if (offset === -1) return 'Vorige Woche'
  if (offset === 1) return 'Nächste Woche'
  if (offset === -2) return 'Vorletzte Woche'
  if (offset === 2) return 'Übernächste Woche'
  if (offset < 0) return `Vor ${Math.abs(offset)} Wochen`
  return `In ${offset} Wochen`
}
