/*
 * Küchenrunde – kurze Cloud-Bildhinweise
 * Copyright (C) 2026 openCook Web contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Wenn Rezeptdaten erfolgreich gespeichert wurden, eine alte Bilddatei aber
 * nicht aus dem Storage entfernt werden konnte, muss die Oberfläche das
 * sichtbar melden. Der Hinweis lebt nur im Arbeitsspeicher und verschwindet
 * beim Logout oder wenn der Nutzer ihn schließt.
 */

type Listener = () => void

const listeners = new Set<Listener>()
let current = ''

export function setCloudImageNotice(message: string): void {
  const next = message.trim()
  if (!next) return
  current = next
  for (const listener of [...listeners]) listener()
}

export function clearCloudImageNotice(): void {
  if (!current) return
  current = ''
  for (const listener of [...listeners]) listener()
}

export function getCloudImageNotice(): string {
  return current
}

export function subscribeCloudImageNotice(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
