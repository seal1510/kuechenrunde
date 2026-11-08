/*
 * openCook Web
 * Copyright (C) 2026 openCook Web contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * One free text note per calendar date. Notes are stored separately from meals
 * and cooking events: they never create portions, ingredients or appointments.
 */

import { db } from '../db'
import { isValidDateKey } from '../domain/dishplan'
import type { DayNote } from '../types'

export function normalizeDayNoteText(value: string): string {
  return value.replace(/\r\n?/g, '\n').trim()
}

/** Create or update a note; an empty text removes the note for that date. */
export async function saveDayNote(date: string, text: string): Promise<DayNote | null> {
  if (!isValidDateKey(date)) throw new Error('Ungültiges Datum.')
  const value = normalizeDayNoteText(text)
  if (!value) {
    await db.dayNotes.delete(date)
    return null
  }
  const existing = await db.dayNotes.get(date)
  const now = Date.now()
  const note: DayNote = {
    date,
    text: value,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  }
  await db.dayNotes.put(note)
  return note
}

export async function deleteDayNote(date: string): Promise<void> {
  if (!isValidDateKey(date)) throw new Error('Ungültiges Datum.')
  await db.dayNotes.delete(date)
}

export async function getDayNote(date: string): Promise<DayNote | undefined> {
  return db.dayNotes.get(date)
}

export class DayNoteMoveConflictError extends Error {
  constructor(
    message = 'Am Zieltag ist bereits ein Kommentar vorhanden.',
  ) {
    super(message)
    this.name = 'DayNoteMoveConflictError'
  }
}

export interface DayNoteMoveSnapshot {
  signature: string
}

export function dayNoteSignature(note: DayNote): string {
  return JSON.stringify({
    date: note.date,
    text: note.text,
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
  })
}

async function moveDayNoteInTransaction(
  date: string,
  targetDate: string,
): Promise<DayNote> {
  if (!isValidDateKey(date) || !isValidDateKey(targetDate)) {
    throw new Error('Ungültiges Datum.')
  }
  const note = await db.dayNotes.get(date)
  if (!note) throw new Error('Der Kommentar existiert nicht mehr.')
  if (date === targetDate) return note

  const target = await db.dayNotes.get(targetDate)
  if (target) throw new DayNoteMoveConflictError()

  const moved: DayNote = {
    ...note,
    date: targetDate,
    updatedAt: Date.now(),
  }
  await db.dayNotes.delete(date)
  await db.dayNotes.put(moved)
  return moved
}

/** Move one note to another date. Dishes on the target never block it. */
export async function moveDayNote(
  date: string,
  targetDate: string,
): Promise<DayNote> {
  return db.transaction('rw', db.dayNotes, () =>
    moveDayNoteInTransaction(date, targetDate),
  )
}

/**
 * Undo a note move only when the moved note and the original date are still in
 * exactly the expected state. Later edits are never overwritten.
 */
export async function undoDayNoteMove(input: {
  currentDate: string
  originalDate: string
  expected: DayNoteMoveSnapshot
}): Promise<DayNote> {
  return db.transaction('rw', db.dayNotes, async () => {
    if (!isValidDateKey(input.currentDate) || !isValidDateKey(input.originalDate)) {
      throw new Error('Ungültiges Datum.')
    }
    const current = await db.dayNotes.get(input.currentDate)
    if (!current || dayNoteSignature(current) !== input.expected.signature) {
      throw new DayNoteMoveConflictError(
        'Rückgängig nicht möglich: Der Kommentar wurde zwischenzeitlich geändert.',
      )
    }
    if (await db.dayNotes.get(input.originalDate)) {
      throw new DayNoteMoveConflictError(
        'Rückgängig nicht möglich: Am ursprünglichen Tag ist inzwischen ein Kommentar vorhanden.',
      )
    }
    return moveDayNoteInTransaction(input.currentDate, input.originalDate)
  })
}
