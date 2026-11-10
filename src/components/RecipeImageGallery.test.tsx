import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { RecipeImageGallery } from './RecipeImageGallery'

describe('RecipeImageGallery', () => {
  it('zeigt eine private Signed URL als Hauptbild', () => {
    const html = renderToStaticMarkup(
      <RecipeImageGallery
        images={[
          {
            id: 'img-a',
            url: 'https://signed.invalid/r1/img-a?token=abc',
            status: 'ready',
          },
        ]}
      />,
    )

    expect(html).toContain('class="detail-image"')
    expect(html).toContain('https://signed.invalid/r1/img-a?token=abc')
    expect(html).not.toContain('thumb')
  })

  it('zeigt mehrere Bilder mit Thumbnails und markiert das aktive Bild', () => {
    const html = renderToStaticMarkup(
      <RecipeImageGallery
        images={[
          { id: 'img-a', url: 'https://signed.invalid/a', status: 'ready' },
          { id: 'img-b', url: 'https://signed.invalid/b', status: 'ready' },
        ]}
      />,
    )

    expect(html.match(/<button/g)).toHaveLength(2)
    expect(html).toContain('aria-label="Bild 1 anzeigen"')
    expect(html).toContain('aria-pressed="true"')
  })

  it('zeigt einen verständlichen Fehler statt eines leeren Bereichs', () => {
    const html = renderToStaticMarkup(
      <RecipeImageGallery
        images={[
          {
            id: 'img-a',
            url: null,
            status: 'error',
            error: 'Das Bild konnte nicht aus dem Familienspeicher geladen werden.',
          },
        ]}
      />,
    )

    expect(html).toContain('Bild nicht verfügbar')
    expect(html).toContain('konnte nicht aus dem Familienspeicher geladen werden')
  })

  it('zeigt während des Ladens keinen falschen Fehler', () => {
    const html = renderToStaticMarkup(
      <RecipeImageGallery
        images={[{ id: 'img-a', url: null, status: 'loading' }]}
      />,
    )

    expect(html).toContain('Bild wird geladen')
    expect(html).not.toContain('Bild nicht verfügbar')
  })
})
