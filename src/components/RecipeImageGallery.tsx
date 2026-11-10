/*
 * Küchenrunde – gemeinsame Bildergalerie
 * Copyright (C) 2026 openCook Web contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Eine einzige Galerie für lokale (Object-URL) und Cloud-Bilder (Signed URL).
 * Die Datenquelle liefert nur fertige URLs; diese Komponente kennt weder
 * Dexie noch Supabase und zeigt bei fehlenden Bildern einen verständlichen
 * Hinweis statt eines stillen leeren Bereichs.
 */

import { useEffect, useState } from 'react'

export interface RecipeGalleryImage {
  id: string
  url: string | null
  alt?: string
  /** Optional error detail shown in the main image area. */
  error?: string
  status?: 'idle' | 'loading' | 'ready' | 'error'
}

export function RecipeImageGallery({ images }: { images: readonly RecipeGalleryImage[] }) {
  const [active, setActive] = useState(0)

  useEffect(() => {
    setActive((current) => (current < images.length ? current : 0))
  }, [images.length])

  if (images.length === 0) return null
  const currentIndex = Math.min(active, images.length - 1)
  const current = images[currentIndex]
  if (!current) return null

  return (
    <div className="gallery">
      {current.url ? (
        <img
          className="detail-image"
          src={current.url}
          alt={current.alt ?? ''}
        />
      ) : (
        <div className="detail-image image-unavailable" role="status">
          <span>
            {current.status === 'error' ? 'Bild nicht verfügbar' : 'Bild wird geladen …'}
          </span>
          {current.status === 'error' && current.error ? (
            <small>{current.error}</small>
          ) : null}
        </div>
      )}
      {images.length > 1 ? (
        <div className="thumbs">
          {images.map((image, index) => (
            <button
              key={image.id}
              type="button"
              className={`thumb${index === currentIndex ? ' active' : ''}`}
              onClick={() => setActive(index)}
              aria-label={`Bild ${index + 1} anzeigen`}
              aria-pressed={index === currentIndex}
              title={image.error || undefined}
            >
              {image.url ? (
                <img src={image.url} alt="" />
              ) : (
                <span className="thumb-unavailable" aria-hidden="true">
                  {image.status === 'error' ? '!' : '…'}
                </span>
              )}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
