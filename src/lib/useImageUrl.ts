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
