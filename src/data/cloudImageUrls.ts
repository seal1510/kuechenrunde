/*
 * Küchenrunde – Signed URLs für private Rezeptbilder
 * Copyright (C) 2026 openCook Web contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Kurzlebige Signed URLs werden ausschließlich im Arbeitsspeicher gehalten.
 * Der Cache verhindert doppelte Anfragen für dasselbe Bild, erneuert URLs vor
 * dem Ablauf und wird beim Logout vollständig verworfen.
 */

import type { ImageStoragePort } from './imageStorage'

export interface SignedImageUrl {
  url: string
  /** Absoluter Zeitpunkt (ms), ab dem die URL nicht mehr gültig ist. */
  expiresAt: number
  /** Absoluter Zeitpunkt (ms), ab dem die URL im Hintergrund erneuert wird. */
  refreshAt: number
}

type CacheEntry = SignedImageUrl

export interface CloudImageUrlCacheOptions {
  /** Nur die Signed-URL-Erzeugung wird benötigt, nicht der ganze Storage-Port. */
  storage: Pick<ImageStoragePort, 'createSignedUrl'>
  /** Gültigkeit der Signed URL in Sekunden. Default: 1 Stunde. */
  lifetimeSeconds?: number
  /** Vorlaufzeit für die Erneuerung in Sekunden. Default: 5 Minuten. */
  refreshMarginSeconds?: number
  /** Injizierbare Uhr für deterministische Tests. */
  now?: () => number
}

const DEFAULT_LIFETIME_SECONDS = 60 * 60
const DEFAULT_REFRESH_MARGIN_SECONDS = 5 * 60

export class CloudImageUrlCache {
  private readonly entries = new Map<string, CacheEntry>()
  private readonly pending = new Map<string, Promise<SignedImageUrl>>()
  private readonly storage: Pick<ImageStoragePort, 'createSignedUrl'>
  private readonly lifetimeMs: number
  private readonly refreshMarginMs: number
  private readonly now: () => number
  private generation = 0
  private disposed = false

  constructor(options: CloudImageUrlCacheOptions) {
    const lifetime = options.lifetimeSeconds ?? DEFAULT_LIFETIME_SECONDS
    const margin = options.refreshMarginSeconds ?? DEFAULT_REFRESH_MARGIN_SECONDS
    if (!Number.isFinite(lifetime) || lifetime <= 0) {
      throw new Error('Die Gültigkeitsdauer einer Signed URL muss positiv sein.')
    }
    if (!Number.isFinite(margin) || margin < 0 || margin >= lifetime) {
      throw new Error('Die Erneuerungsvorlaufzeit muss kleiner als die Gültigkeitsdauer sein.')
    }
    this.storage = options.storage
    this.lifetimeMs = Math.round(lifetime * 1000)
    this.refreshMarginMs = Math.round(margin * 1000)
    this.now = options.now ?? Date.now
  }

  /**
   * Liefert eine gültige Signed URL. Ein bereits laufender Ladevorgang für
   * denselben Pfad wird geteilt. Ist eine abgelaufene URL nicht erneuerbar,
   * wird der Fehler weitergereicht.
   */
  async getUrl(path: string): Promise<SignedImageUrl> {
    assertPath(path)
    if (this.disposed) throw new Error('Der Bild-URL-Cache wurde beendet.')

    const cached = this.entries.get(path)
    const now = this.now()
    if (cached && now < cached.refreshAt) return publicEntry(cached)

    const running = this.pending.get(path)
    if (running) return running

    const generation = this.generation
    const request = this.load(path, cached, generation)
    this.pending.set(path, request)
    try {
      return await request
    } finally {
      if (this.pending.get(path) === request) this.pending.delete(path)
    }
  }

  /** Bereits bekannte URL ohne Netzwerkzugriff, z. B. für einen schnellen ersten Frame. */
  peek(path: string): SignedImageUrl | null {
    const cached = this.entries.get(path)
    if (!cached) return null
    return publicEntry(cached)
  }

  invalidate(path: string): void {
    this.entries.delete(path)
  }

  /** Verwirft alle URLs, z. B. beim Kontowechsel innerhalb einer Sitzung. */
  clear(): void {
    this.generation += 1
    this.entries.clear()
    this.pending.clear()
  }

  /** Endgültige Bereinigung beim Logout. Danach sind keine Zugriffe mehr möglich. */
  dispose(): void {
    this.disposed = true
    this.clear()
  }

  private async load(
    path: string,
    previous: CacheEntry | undefined,
    generation: number,
  ): Promise<SignedImageUrl> {
    const lifetimeSeconds = Math.round(this.lifetimeMs / 1000)
    try {
      const url = await this.storage.createSignedUrl(path, lifetimeSeconds)
      const now = this.now()
      const entry: CacheEntry = {
        url,
        expiresAt: now + this.lifetimeMs,
        refreshAt: now + this.lifetimeMs - this.refreshMarginMs,
      }
      if (!this.disposed && generation === this.generation) {
        this.entries.set(path, entry)
      }
      return publicEntry(entry)
    } catch (cause) {
      // Eine noch gültige alte URL ist besser als ein sichtbarer Fehler.
      // Der nächste Versuch wird bewusst verzögert, damit ein vorübergehender
      // Fehler nicht zu einer Anfrage pro Sekunde führt.
      if (previous && this.now() < previous.expiresAt) {
        previous.refreshAt = Math.min(previous.expiresAt, this.now() + 30_000)
        return publicEntry(previous)
      }
      throw cause
    }
  }
}

function publicEntry(entry: CacheEntry): SignedImageUrl {
  return { url: entry.url, expiresAt: entry.expiresAt, refreshAt: entry.refreshAt }
}

function assertPath(path: string): void {
  if (typeof path !== 'string' || !path.trim()) {
    throw new Error('Für eine Signed URL wird ein Speicherpfad benötigt.')
  }
}
