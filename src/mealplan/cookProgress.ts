/*
 * openCook Web
 * Copyright (C) 2026 openCook Web contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Local cook-mode progress. Progress belongs to exactly one planned cooking
 * event (`CookSession`); a recipe opened directly from the library uses a
 * temporary in-memory session instead and stores nothing. Reaching the last
 * step never marks a cooking event as cooked.
 */

import { db } from '../db'

export async function loadCookProgress(cookSessionId: string): Promise<number | null> {
  if (!cookSessionId) return null
  const row = await db.cookProgress.get(cookSessionId)
  if (!row) return null
  return Number.isInteger(row.stepIndex) && row.stepIndex >= 0 ? row.stepIndex : null
}

export interface SaveCookProgressOptions {
  /**
   * Existence check for the cooking event. Local mode keeps the Dexie check;
   * cloud mode supplies the shared CloudRecordsStore check so progress stays
   * device-local without reading local plan tables.
   */
  sessionExists?: () => boolean | Promise<boolean>
}

export async function saveCookProgress(
  cookSessionId: string,
  stepIndex: number,
  options: SaveCookProgressOptions = {},
): Promise<void> {
  if (!cookSessionId || !Number.isInteger(stepIndex) || stepIndex < 0) return
  // Never create progress for a cooking event that no longer exists.
  const exists = options.sessionExists
    ? await options.sessionExists()
    : Boolean(await db.cookSessions.get(cookSessionId))
  if (!exists) return
  await db.cookProgress.put({
    cookSessionId,
    stepIndex,
    updatedAt: Date.now(),
  })
}

export async function resetCookProgress(cookSessionId: string): Promise<void> {
  if (!cookSessionId) return
  await db.cookProgress.delete(cookSessionId)
}

/** Remove rows whose cooking event was deleted outside the normal services. */
export async function pruneOrphanedCookProgress(): Promise<number> {
  const rows = await db.cookProgress.toArray()
  if (rows.length === 0) return 0
  const sessionIds = new Set((await db.cookSessions.toArray()).map((session) => session.id))
  const orphaned = rows
    .filter((row) => !sessionIds.has(row.cookSessionId))
    .map((row) => row.cookSessionId)
  if (orphaned.length > 0) await db.cookProgress.bulkDelete(orphaned)
  return orphaned.length
}
