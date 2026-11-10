/*
 * openCook Web
 * Copyright (C) 2026 openCook Web contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Object URL for stored image bytes. Kept free of the Markdown renderer so
 * lightweight views such as the planning recipe picker do not pull DOMPurify
 * into their module graph.
 */

import { useEffect, useState } from 'react'

/** Object URL for image bytes, revoked when the bytes or component change. */
export function useImageUrl(
  bytes: ArrayBuffer | undefined,
  mimeType: string | undefined,
): string | null {
  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => {
    if (!bytes || !mimeType) {
      setUrl(null)
      return
    }
    const objectUrl = URL.createObjectURL(new Blob([bytes], { type: mimeType }))
    setUrl(objectUrl)
    return () => URL.revokeObjectURL(objectUrl)
  }, [bytes, mimeType])

  return url
}

export interface ImageBytesSource {
  id: string
  bytes?: ArrayBuffer
  mimeType?: string
}

/**
 * Object URLs for a list of stored image byte arrays. All URLs are revoked
 * together when the list changes or the component unmounts.
 */
export function useImageUrls(
  images: readonly ImageBytesSource[],
): Record<string, string> {
  const [urls, setUrls] = useState<Record<string, string>>({})

  useEffect(() => {
    const next: Record<string, string> = {}
    for (const image of images) {
      if (!image.bytes || !image.mimeType) continue
      next[image.id] = URL.createObjectURL(
        new Blob([image.bytes], { type: image.mimeType }),
      )
    }
    setUrls(next)
    return () => {
      for (const url of Object.values(next)) URL.revokeObjectURL(url)
    }
  }, [images])

  return urls
}
