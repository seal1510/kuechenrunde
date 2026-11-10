/*
 * Küchenrunde – Fehler der Cloud-Persistenz
 * Copyright (C) 2026 openCook Web contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export class CloudDataError extends Error {
  readonly code: string | undefined

  constructor(message: string, code?: string) {
    super(message)
    this.name = 'CloudDataError'
    this.code = code
  }
}

/** Der Datensatz wurde zwischenzeitlich von jemand anderem geändert. */
export class CloudConflictError extends CloudDataError {
  constructor(message = 'Der Datensatz wurde zwischenzeitlich geändert.') {
    super(message)
    this.name = 'CloudConflictError'
  }
}

/** RLS oder die Mitgliedschaftsprüfung hat den Zugriff verweigert. */
export class CloudPermissionError extends CloudDataError {
  constructor(message = 'Kein Zugriff auf die Familiendaten.') {
    super(message)
    this.name = 'CloudPermissionError'
  }
}

/** Es wurde gelesen/geschrieben, bevor der Snapshot geladen war. */
export class CloudNotLoadedError extends CloudDataError {
  constructor(message = 'Die Cloud-Daten sind noch nicht geladen.') {
    super(message)
    this.name = 'CloudNotLoadedError'
  }
}

/** Ein privates Rezeptbild konnte nicht gespeichert, geladen oder gelöscht werden. */
export class CloudImageError extends CloudDataError {
  constructor(message: string, code?: string) {
    super(message, code)
    this.name = 'CloudImageError'
  }
}
