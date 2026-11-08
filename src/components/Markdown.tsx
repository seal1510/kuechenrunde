import { useEffect, useMemo, useState } from 'react'
import DOMPurify from 'dompurify'
import { marked } from 'marked'

DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A') {
    node.setAttribute('target', '_blank')
    node.setAttribute('rel', 'noreferrer noopener')
  }
})

/** Render Mela markdown (description, steps, notes) after sanitising it. */
export function Markdown({ text, className = '' }: { text: string; className?: string }) {
  const html = useMemo(() => {
    if (!text.trim()) return ''
    const rendered = marked.parse(text, { async: false, gfm: true, breaks: true })
    return DOMPurify.sanitize(String(rendered))
  }, [text])

  if (!html) return null
  return <div className={`markdown ${className}`.trim()} dangerouslySetInnerHTML={{ __html: html }} />
}

/** Object URL for image bytes, revoked when the bytes or component change. */
export function useImageUrl(bytes: ArrayBuffer | undefined, mimeType: string | undefined): string | null {
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
