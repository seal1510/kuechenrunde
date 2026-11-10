/*
 * Küchenrunde – Supabase-Storage für Rezeptbilder
 * Copyright (C) 2026 openCook Web contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Ausschließlich der private Bucket `recipe-images`, ausschließlich mit der
 * angemeldeten Sitzung (RLS). Keine öffentlichen URLs, kein service_role und
 * keine dauerhafte Speicherung von Signed URLs.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import {
  RECIPE_IMAGES_BUCKET,
  imageStorageFailure,
  type ImageStoragePort,
} from '../data/imageStorage'

export function createSupabaseImageStorage(client: SupabaseClient): ImageStoragePort {
  const bucket = client.storage.from(RECIPE_IMAGES_BUCKET)

  return {
    async upload(path, bytes, mimeType) {
      try {
        const { error } = await bucket.upload(path, bytes, {
          contentType: mimeType,
          upsert: false,
          cacheControl: '3600',
        })
        if (error) throw error
      } catch (cause) {
        throw imageStorageFailure('upload', cause)
      }
    },

    async createSignedUrl(path, expiresInSeconds) {
      try {
        const { data, error } = await bucket.createSignedUrl(path, expiresInSeconds)
        if (error) throw error
        if (!data?.signedUrl) {
          throw new Error('Supabase hat keine Signed URL geliefert.')
        }
        return data.signedUrl
      } catch (cause) {
        throw imageStorageFailure('download', cause)
      }
    },

    async download(path) {
      try {
        const { data, error } = await bucket.download(path)
        if (error) throw error
        if (!data) throw new Error('Supabase hat keine Bilddatei geliefert.')
        return await data.arrayBuffer()
      } catch (cause) {
        throw imageStorageFailure('download', cause)
      }
    },

    async remove(paths) {
      const unique = [...new Set(paths.filter((path) => Boolean(path?.trim())))]
      if (unique.length === 0) return
      try {
        const { error } = await bucket.remove(unique)
        if (error) throw error
      } catch (cause) {
        throw imageStorageFailure('delete', cause)
      }
    },
  }
}
