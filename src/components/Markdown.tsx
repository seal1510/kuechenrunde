import { useMemo } from 'react'
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

/** Object URL helper, re-exported for existing callers. */
export { useImageUrl } from '../lib/useImageUrl'
