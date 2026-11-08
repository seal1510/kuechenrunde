/*
 * openCook Web
 * Copyright (C) 2026 openCook Web contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Conservative URL handling shared by the import UI and the duplicate check.
 * Normalisation only removes parts that cannot identify a different document
 * (scheme/host case, default port, fragment). Path, query and `www.` are kept
 * deliberately: different recipes must never be merged accidentally.
 */

export function normalizeHttpUrl(raw: string): string | null {
  let text = String(raw ?? '').trim()
  if (!text) return null
  // Users commonly paste "example.com/recipe" without a scheme.
  if (!/^[a-z][a-z0-9+.-]*:/i.test(text)) text = `https://${text}`
  let url: URL
  try {
    url = new URL(text)
  } catch {
    return null
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  if (!url.hostname) return null
  if (url.username || url.password) return null
  url.hash = ''
  // URL already lowercases the scheme/host and drops a default port.
  return url.toString()
}

/** Human-readable host for a source link; returns the input when parsing fails. */
export function sourceHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

/** Absolute http(s) URL resolution for images and links found in HTML. */
export function resolveHttpUrl(value: string, baseUrl: string): string | null {
  const trimmed = String(value ?? '').trim()
  if (!trimmed) return null
  try {
    const resolved = new URL(trimmed, baseUrl)
    if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') return null
    if (resolved.username || resolved.password) return null
    return resolved.toString()
  } catch {
    return null
  }
}
