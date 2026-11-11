import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { RecipeDraft } from '../recipe/editor'
import type { EditorImage } from '../recipe/repository'
import type { Recipe } from '../types'
import type { OcrRecipe, PhotoOcrPage } from '../import/photo-ocr'
import {
  PhotoOcrAbortedError,
  PhotoOcrRequestError,
  type PhotoOcrResult,
} from '../import/photo-ocr-client'
import { draftFromOcrRecipe, photoDraftNotices } from '../import/photo-draft'
import type { PreparedPhotoPage } from '../import/photo-image'
import { renderPdfToPhotoPages } from '../import/photo-pdf'
import {
  PhotoImportController,
  PhotoImportPage,
  PhotoImportView,
  canStartRecognition,
  initialPhotoImportState,
  prepareReplacementPhotoPage,
  selectPhotoPages,
  totalPhotoBytes,
  type PhotoImportState,
  type PhotoRecognizeOptions,
} from './PhotoImportPage'

vi.mock('../components/Markdown', () => ({
  Markdown: ({ text }: { text: string }) => <div data-markdown>{text}</div>,
  useImageUrl: () => null,
}))

function bytes(length = 16): ArrayBuffer {
  return new Uint8Array(length).buffer as ArrayBuffer
}

function preparedPage(id: string, overrides: Partial<PreparedPhotoPage> = {}): PreparedPhotoPage {
  return {
    id,
    name: `${id}.jpg`,
    mimeType: 'image/jpeg',
    bytes: bytes(32),
    width: 2048,
    height: 1536,
    originalWidth: 4000,
    originalHeight: 3000,
    dataBase64: btoa('bild'),
    ...overrides,
  }
}

function toEditorImagesForTest(): EditorImage[] {
  return [
    {
      id: 'manuell',
      name: 'manuell.jpg',
      bytes: bytes(),
      mimeType: 'image/jpeg',
    },
  ]
}

function imageFile(name = 'seite.jpg'): File {
  return new File([new Uint8Array(32)], name, { type: 'image/jpeg' })
}

function pdfFile(name = 'rezept.pdf'): File {
  return new File([new Uint8Array(64)], name, { type: 'application/pdf' })
}

function ocrRecipe(overrides: Partial<OcrRecipe> = {}): OcrRecipe {
  return {
    recognized: true,
    title: 'Omas Apfelkuchen',
    description: 'Familienrezept.',
    servingsText: '4 Portionen',
    prepTime: '20 Min.',
    cookTime: '50 Min.',
    totalTime: '',
    notes: '',
    ingredients: [
      {
        group: 'Teig',
        quantity: '250',
        unit: 'g',
        name: 'Mehl',
        purchaseNote: '',
        preparationNote: '',
        uncertain: true,
        uncertainty: 'Menge evtl. 300 g',
      },
    ],
    steps: [{ text: 'Alles verkneten.', uncertain: false, uncertainty: '' }],
    uncertainties: [{ reference: 'Zutat 1, Menge', note: 'Schwer lesbar.' }],
    warnings: [],
    ...overrides,
  }
}

function ocrResult(overrides: Partial<PhotoOcrResult> = {}): PhotoOcrResult {
  return {
    model: '@cf/meta/llama-4-scout-17b-16e-instruct',
    recipe: ocrRecipe(),
    pages: [{ index: 0, kind: 'recipe', note: '' }],
    usage: { promptTokens: 1, completionTokens: 2 },
    ...overrides,
  }
}

function reviewState(overrides: Partial<PhotoImportState> = {}): PhotoImportState {
  const recipe = ocrRecipe()
  return {
    ...initialPhotoImportState(),
    status: 'review',
    pages: [preparedPage('p1')],
    result: ocrResult({ recipe }),
    draft: draftFromOcrRecipe(recipe),
    notices: photoDraftNotices(recipe),
    recognizedAt: 1_700_000_000_000,
    importId: 'photo-test',
    ...overrides,
  }
}

const noop = () => undefined

function renderView(state: PhotoImportState) {
  return renderToStaticMarkup(
    <PhotoImportView
      state={state}
      onAddFiles={noop}
      onReplacePage={noop}
      onMovePage={noop}
      onRemovePage={noop}
      onRecognize={noop}
      onCancelRecognition={noop}
      onChangeDraft={noop}
      onChangeImages={noop}
      onIncludePhotos={noop}
      onSave={noop}
      onReset={noop}
    />,
  )
}

/* ---------------------------------------------------------------- */
/* Dateiauswahl mit echten File-Objekten (ohne DOM)                  */
/* ---------------------------------------------------------------- */

describe('photo selection', () => {
  it('prepares image files via the injected pipeline in order', async () => {
    const result = await selectPhotoPages([], [imageFile('a.jpg'), imageFile('b.jpg')], {
      prepareImage: async (file) => preparedPage(file.name.replace('.jpg', '')),
    })
    expect(result.pages.map((page) => page.name)).toEqual(['a.jpg', 'b.jpg'])
    expect(result.errors).toEqual([])
  })

  it('keeps existing pages and counts them against the budget', async () => {
    const existing = [
      preparedPage('p1'),
      preparedPage('p2'),
      preparedPage('p3'),
      preparedPage('p4'),
    ]
    const result = await selectPhotoPages(existing, [imageFile()], {
      prepareImage: async () => preparedPage('neu'),
    })
    expect(result.pages).toHaveLength(4)
    expect(result.errors.join(' ')).toContain('höchstens 4 Seiten')
  })

  it('turns max four PDF pages into photo pages with a warning', async () => {
    const rendered = {
      pages: Array.from({ length: 7 }, (_, index) => preparedPage(`pdf-${index}`)),
      warnings: ['Das PDF hat 7 Seiten. Übernommen wurden die ersten 4 Seiten.'],
    }
    const result = await selectPhotoPages([], [pdfFile()], {
      renderPdf: async () => rendered,
    })
    expect(result.pages).toHaveLength(4)
    expect(result.warnings).toContain(rendered.warnings[0])
    expect(result.errors.join(' ')).toContain('höchstens 4 Seiten')
  })

  it('reports an encrypted PDF without crashing', async () => {
    const result = await selectPhotoPages([], [pdfFile()], {
      renderPdf: async () => {
        throw new Error('Das PDF ist passwortgeschützt.')
      },
    })
    expect(result.pages).toHaveLength(0)
    expect(result.errors[0]).toContain('passwortgeschützt')
  })

  it('replaces one prepared page through the same pipeline', async () => {
    const current = [preparedPage('p1'), preparedPage('p2')]
    const result = await prepareReplacementPhotoPage(current, 'p1', imageFile('neu.jpg'), {
      prepareImage: async () => preparedPage('neu'),
    })
    expect(result.error).toBeNull()
    expect(result.page?.id).toBe('neu')
    expect(totalPhotoBytes(current)).toBe(64)
  })

  it('rejects a PDF when replacing a single page', async () => {
    const result = await prepareReplacementPhotoPage([preparedPage('p1')], 'p1', pdfFile(), {})
    expect(result.page).toBeNull()
    expect(result.error).toContain('kein PDF')
  })
})

describe('PDF renderer limit', () => {
  function fakePdfLoader(numPages: number, byteLength = 100) {
    const rendered: number[] = []
    return {
      rendered,
      loader: {
        async load() {
          return {
            numPages,
            async renderPage(index: number) {
              rendered.push(index)
              return { bytes: bytes(byteLength), width: 1024, height: 768 }
            },
            dispose: () => undefined,
          }
        },
      },
    }
  }

  it('renders at most four pages and warns about the rest', async () => {
    const fake = fakePdfLoader(9)
    const result = await renderPdfToPhotoPages(pdfFile(), {
      loader: fake.loader,
      maxPages: 4,
    })
    expect(result.pages).toHaveLength(4)
    expect(fake.rendered).toEqual([0, 1, 2, 3])
    expect(result.warnings[0]).toContain('9 Seiten')
    expect(result.pages[0]?.mimeType).toBe('image/jpeg')
    expect(result.pages[0]?.dataBase64.length).toBeGreaterThan(0)
  })

  it('maps an encrypted PDF to a readable German message', async () => {
    await expect(
      renderPdfToPhotoPages(pdfFile(), {
        loader: {
          async load() {
            const error = new Error('Password required')
            error.name = 'PasswordException'
            throw error
          },
        },
      }),
    ).rejects.toMatchObject({ code: 'encrypted' })
  })
})

/* ---------------------------------------------------------------- */
/* Controller: Erkennen, Speichern, Verwerfen                        */
/* ---------------------------------------------------------------- */

describe('PhotoImportController', () => {
  it('recognizes only after the button action and saves only after confirmation', async () => {
    const recognize = vi.fn(
      async (_pages: PhotoOcrPage[], _options: PhotoRecognizeOptions) => ocrResult(),
    )
    const saveRecipe = vi.fn(async (_recipe: Recipe, _images: EditorImage[]) => [] as string[])
    const controller = new PhotoImportController({
      recognize,
      saveRecipe,
      now: () => 1_700_000_000_000,
    })
    controller.setPages([preparedPage('p1')])

    expect(saveRecipe).not.toHaveBeenCalled()
    await controller.recognize()

    expect(recognize).toHaveBeenCalledTimes(1)
    expect(recognize.mock.calls[0]?.[0]).toEqual([
      {
        mimeType: 'image/jpeg',
        dataBase64: btoa('bild'),
        width: 2048,
        height: 1536,
      },
    ])
    expect(controller.getState().status).toBe('review')
    expect(controller.getState().includePhotos).toBe(false)
    expect(controller.getState().images).toEqual([])
    // Nach der Erkennung wird noch nichts gespeichert.
    expect(saveRecipe).not.toHaveBeenCalled()

    await controller.save()
    expect(saveRecipe).toHaveBeenCalledTimes(1)
    const recipe = saveRecipe.mock.calls[0]?.[0] as unknown as Recipe
    const images = saveRecipe.mock.calls[0]?.[1] as unknown as EditorImage[]
    expect(recipe.importSource).toBe('photo')
    expect(recipe.importId).toMatch(/^photo-1700000000000-/)
    expect(recipe.title).toBe('Omas Apfelkuchen')
    expect(recipe.raw).toMatchObject({
      source: 'photo-ocr',
      model: '@cf/meta/llama-4-scout-17b-16e-instruct',
      pageCount: 1,
      recognizedAt: 1_700_000_000_000,
    })
    expect(images).toEqual([])
    expect(controller.getState().status).toBe('saved')
  })

  it('does not save when the user discards the draft', async () => {
    const saveRecipe = vi.fn(async () => [])
    const controller = new PhotoImportController({
      recognize: async () => ocrResult(),
      saveRecipe,
    })
    controller.setPages([preparedPage('p1')])
    await controller.recognize()
    controller.reset()

    expect(controller.getState().status).toBe('idle')
    expect(controller.getState().draft).toBeNull()
    expect(saveRecipe).not.toHaveBeenCalled()
  })

  it('only sends the page photos when the checkbox is enabled', async () => {
    const saveRecipe = vi.fn(async (_recipe: Recipe, _images: EditorImage[]) => [] as string[])
    const controller = new PhotoImportController({
      recognize: async () => ocrResult(),
      saveRecipe,
      now: () => 7,
    })
    controller.setPages([preparedPage('p1'), preparedPage('p2')])
    await controller.recognize()
    expect(controller.getState().images).toEqual([])

    controller.setIncludePhotos(true)
    expect(controller.getState().images.map((image) => image.id)).toEqual(['p1', 'p2'])
    expect(controller.getState().images[0]?.mimeType).toBe('image/jpeg')

    await controller.save()
    const images = saveRecipe.mock.calls[0]?.[1] as unknown as EditorImage[]
    expect(images).toHaveLength(2)
  })

  it('never persists page photos when the checkbox is off', async () => {
    const saveRecipe = vi.fn(async (_recipe: Recipe, _images: EditorImage[]) => [] as string[])
    const controller = new PhotoImportController({
      recognize: async () => ocrResult(),
      saveRecipe,
    })
    controller.setPages([preparedPage('p1')])
    await controller.recognize()
    controller.changeImages(toEditorImagesForTest())
    await controller.save()
    expect(saveRecipe.mock.calls[0]?.[1]).toEqual([])
  })

  it('reorders, removes and replaces pages before recognition', () => {
    const controller = new PhotoImportController({
      recognize: async () => ocrResult(),
      saveRecipe: async () => [],
    })
    controller.setPages([preparedPage('a'), preparedPage('b'), preparedPage('c')])
    controller.movePage(0, 1)
    expect(controller.getState().pages.map((page) => page.id)).toEqual(['b', 'a', 'c'])
    controller.movePage(2, 1)
    expect(controller.getState().pages.map((page) => page.id)).toEqual(['b', 'a', 'c'])
    controller.removePage('a')
    expect(controller.getState().pages.map((page) => page.id)).toEqual(['b', 'c'])
  })

  it('adds files through the input handler pipeline', async () => {
    const controller = new PhotoImportController({
      recognize: async () => ocrResult(),
      saveRecipe: async () => [],
      prepareImage: async (file) => preparedPage(file.name.replace('.jpg', '')),
    })
    await controller.addFiles([imageFile('vorne.jpg')])
    expect(controller.getState().pages[0]?.id).toBe('vorne')
  })

  it('shows a quota message and keeps the manual fallback', async () => {
    const controller = new PhotoImportController({
      recognize: async () => {
        throw new PhotoOcrRequestError('quota-exhausted')
      },
      saveRecipe: async () => [],
    })
    controller.setPages([preparedPage('p1')])
    await controller.recognize()
    const state = controller.getState()
    expect(state.status).toBe('idle')
    expect(state.errorCode).toBe('quota-exhausted')
    expect(state.error).toContain('Tageskontingent')
    expect(state.error).toContain('keine Kosten')
    expect(state.manualFallback).toBe(true)
  })

  it('treats a cancelled recognition as a silent return to the selection', async () => {
    let resolveRecognition: (result: PhotoOcrResult) => void = () => undefined
    const recognize = vi.fn(
      () =>
        new Promise<PhotoOcrResult>((resolve) => {
          resolveRecognition = resolve
        }),
    )
    const controller = new PhotoImportController({ recognize, saveRecipe: async () => [] })
    controller.setPages([preparedPage('p1')])
    const pending = controller.recognize()
    expect(controller.getState().status).toBe('recognizing')
    expect(controller.getState().recognizingPageCount).toBe(1)

    controller.cancelRecognition()
    expect(controller.getState().status).toBe('idle')
    resolveRecognition(ocrResult())
    await pending
    expect(controller.getState().status).toBe('idle')
    expect(controller.getState().draft).toBeNull()
  })

  it('reports an empty AI answer as no recipe, not as success', async () => {
    const controller = new PhotoImportController({
      recognize: async () =>
        ocrResult({
          recipe: {
            ...ocrRecipe(),
            recognized: false,
            ingredients: [],
            steps: [],
            warnings: ['Kein Rezept erkannt.'],
          },
        }),
      saveRecipe: async () => [],
    })
    controller.setPages([preparedPage('p1')])
    await controller.recognize()
    expect(controller.getState().status).toBe('idle')
    expect(controller.getState().draft).toBeNull()
    expect(controller.getState().error).toContain('kein Rezept erkannt')
  })

  it('keeps the same photo import id when saving is retried', async () => {
    const recipes: Recipe[] = []
    const saveRecipe = vi
      .fn()
      .mockImplementationOnce(async (recipe: Recipe) => {
        recipes.push(recipe)
        throw new Error('Netzwerkfehler')
      })
      .mockImplementationOnce(async (recipe: Recipe) => {
        recipes.push(recipe)
        return []
      })
    const controller = new PhotoImportController({
      recognize: async () => ocrResult(),
      saveRecipe,
      now: () => 99,
    })
    controller.setPages([preparedPage('p1')])
    await controller.recognize()
    await controller.save()
    expect(controller.getState().status).toBe('review')
    expect(controller.getState().error).toContain('Netzwerkfehler')
    await controller.save()
    expect(controller.getState().status).toBe('saved')
    expect(recipes).toHaveLength(2)
    expect(recipes[0]?.importId).toBe(recipes[1]?.importId)
  })

  it('needs a title before saving', async () => {
    const saveRecipe = vi.fn(async () => [])
    const controller = new PhotoImportController({
      recognize: async () => ocrResult(),
      saveRecipe,
    })
    controller.setPages([preparedPage('p1')])
    await controller.recognize()
    const emptyDraft = { ...(controller.getState().draft as RecipeDraft), title: '   ' }
    controller.changeDraft(emptyDraft)
    await controller.save()
    expect(saveRecipe).not.toHaveBeenCalled()
    expect(controller.getState().error).toContain('Titel')
  })

  it('treats an explicit abort signal as a silent cancel', async () => {
    const controller = new PhotoImportController({
      recognize: async () => {
        throw new PhotoOcrAbortedError()
      },
      saveRecipe: async () => [],
    })
    controller.setPages([preparedPage('p1')])
    await controller.recognize()
    expect(controller.getState().status).toBe('idle')
    expect(controller.getState().error).toBe('')
  })
})

/* ---------------------------------------------------------------- */
/* Statisches Markup (ohne Browser)                                  */
/* ---------------------------------------------------------------- */

describe('PhotoImportView', () => {
  it('renders the connected page in its initial state', () => {
    const html = renderToStaticMarkup(
      <PhotoImportPage
        recognize={async () => ocrResult()}
        saveRecipe={async () => []}
      />,
    )
    expect(html).toContain('Rezept per Foto oder Scan importieren')
    expect(html).toContain('Foto aufnehmen')
    expect(html).toContain('PDF auswählen')
  })

  it('offers separate iPhone capture, photo library and PDF controls', () => {
    const html = renderView(initialPhotoImportState())
    expect(html).toContain('Rezept per Foto oder Scan importieren')
    expect(html).toContain('Foto aufnehmen')
    expect(html).toContain('capture="environment"')
    expect(html).toContain('Aus Fotos auswählen')
    expect(html).toMatch(/type="file" accept="image\/\*" multiple=""/)
    expect(html).toContain('PDF auswählen')
    expect(html).toContain('accept="application/pdf,.pdf"')
    expect(html).toContain('Bilder oder ein PDF hierher ziehen')
    expect(html).toContain('Andere Importwege')
    expect(html).toContain('href="#/import"')
    // Ohne Seiten ist die Erkennung nicht startbar.
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Rezept erkennen<\/button>/)
    expect(html).not.toContain('Rezept speichern')
  })

  it('enables recognition for one to four selected pages', () => {
    const pages = [preparedPage('p1'), preparedPage('p2')]
    const html = renderView({ ...initialPhotoImportState(), pages })
    expect(canStartRecognition(pages)).toBe(true)
    expect(html).toContain('2 von 4 Seiten')
    expect(html).toContain('Seite 1')
    expect(html).toContain('aria-label="Seite 1 nach unten"')
    expect(html).toContain('aria-label="Seite 1 entfernen"')
    expect(html).toContain('Ersetzen')
    expect(html).toContain('Groß ansehen')
    const recognizeButton = /<button[^>]*>Rezept erkennen<\/button>/.exec(html)?.[0]
    expect(recognizeButton).not.toContain('disabled')
  })

  it('shows the recognizing state with page count and a cancel action', () => {
    const html = renderView({
      ...initialPhotoImportState(),
      status: 'recognizing',
      pages: [preparedPage('p1'), preparedPage('p2')],
      recognizingPageCount: 2,
    })
    expect(html).toContain('Erkenne 2 Seiten')
    expect(html).toContain('Erkennen abbrechen')
    expect(html).toContain('aria-live="polite"')
    // Während der Erkennung sind die Seiten gesperrt.
    expect(html).not.toContain('aria-label="Seite 1 entfernen"')
  })

  it('shows quota errors with a manual fallback link', () => {
    const html = renderView({
      ...initialPhotoImportState(),
      error: 'Das kostenlose Workers-AI-Tageskontingent ist erschöpft.',
      errorCode: 'quota-exhausted',
      manualFallback: true,
      pages: [preparedPage('p1')],
    })
    expect(html).toContain('role="alert"')
    expect(html).toContain('Tageskontingent')
    expect(html).toContain('keine Kosten')
    expect(html).toContain('href="#/recipe/new"')
    expect(html).toContain('Rezept manuell anlegen')
    expect(html).toContain('Erneut erkennen')
  })

  it('renders the recognized recipe in the existing form with the photos for comparison', () => {
    const html = renderView(reviewState())
    expect(html).toContain('Erkanntes Rezept prüfen')
    expect(html).toContain('Unklarheiten und Warnungen der KI')
    expect(html).toContain('Zutat 1, Menge')
    expect(html).toContain('Schwer lesbar.')
    expect(html).toContain('id="photo-import-form"')
    expect(html).toContain('value="Omas Apfelkuchen"')
    expect(html).toContain('form="photo-import-form"')
    expect(html).toContain('Rezept speichern')
    expect(html).toContain('Seitenfotos als Rezeptbilder mitspeichern')
    // Standardmäßig aus: Das Kontrollkästchen ist nicht vorausgewählt.
    const checkbox = /<input[^>]*type="checkbox"[^>]*>/.exec(html)?.[0]
    expect(checkbox).toBeDefined()
    expect(checkbox).not.toContain('checked')
    expect(html).toContain('Fotos sind für diese Erkennung gesperrt')
    expect(html).toContain('Verwerfen')
  })

  it('renders the saved state with a recipe link and a restart action', () => {
    const html = renderView({
      ...initialPhotoImportState(),
      status: 'saved',
      saved: { id: 'r1', title: 'Omas Apfelkuchen', warnings: ['Bild konnte nicht gespeichert werden.'] },
    })
    expect(html).toContain('Rezept gespeichert')
    expect(html).toContain('href="#/recipe/r1"')
    expect(html).toContain('Rezept öffnen')
    expect(html).toContain('Weiteres Foto importieren')
    expect(html).toContain('Bild konnte nicht gespeichert werden.')
  })
})
