import { describe, expect, it } from 'vitest'
import {
  PHOTO_OCR_MAX_PAGES,
  PHOTO_OCR_MAX_PAGE_BYTES,
  PHOTO_OCR_MAX_TOTAL_BYTES,
  PHOTO_OCR_TARGET_LONG_EDGE,
} from './photo-ocr'
import {
  PhotoImageError,
  arrayBufferToBase64,
  base64ByteLength,
  createPhotoPreviewUrl,
  fitWithinLongEdge,
  formatPhotoBytes,
  isPdfPhotoFile,
  photoFileMimeType,
  preparePhotoFile,
  preparePhotoFiles,
  photoResolutionWarning,
  revokePhotoPreviewUrl,
  shouldDownscale,
  toOcrPage,
  validatePhotoFile,
  validatePhotoPageCount,
  validatePhotoTotalBytes,
  type PhotoCanvasLike,
  type PhotoImagePipeline,
  type PreparedPhotoPage,
} from './photo-image'

function file(name = 'rezept.jpg', type = 'image/jpeg', size = 1024): File {
  return new File([new Uint8Array(Math.max(1, size))], name, { type })
}

function bytesOf(length: number, fill = 1): ArrayBuffer {
  return new Uint8Array(length).fill(fill).buffer as ArrayBuffer
}

function fakeContext(): CanvasRenderingContext2D {
  return {
    save: () => undefined,
    restore: () => undefined,
    fillRect: () => undefined,
    drawImage: () => undefined,
    fillStyle: '#ffffff',
  } as unknown as CanvasRenderingContext2D
}

function fakePipeline(options: {
  width?: number
  height?: number
  encoded?: ArrayBuffer
  encodeSizes?: number[]
} = {}) {
  const canvi: Array<{ width: number; height: number }> = []
  const qualities: number[] = []
  const sizes = options.encodeSizes ?? []
  const encoded = options.encoded ?? bytesOf(500, 7)
  const pipeline: PhotoImagePipeline = {
    async decode() {
      return {
        width: options.width ?? 4000,
        height: options.height ?? 3000,
        draw: () => undefined,
      }
    },
    createCanvas(width, height) {
      canvi.push({ width, height })
      const canvas: PhotoCanvasLike = {
        width,
        height,
        getContext: () => fakeContext(),
        toBlob: () => undefined,
      }
      return canvas
    },
    async encodeJpeg(_canvas, quality) {
      qualities.push(quality)
      const size = sizes[qualities.length - 1]
      return size === undefined ? encoded : bytesOf(size, 1)
    },
  }
  return { pipeline, canvi, qualities }
}

describe('fitWithinLongEdge', () => {
  it('fits landscape and portrait photos into the long edge', () => {
    expect(fitWithinLongEdge(4000, 3000)).toEqual({
      width: PHOTO_OCR_TARGET_LONG_EDGE,
      height: 1536,
      scale: PHOTO_OCR_TARGET_LONG_EDGE / 4000,
    })
    expect(fitWithinLongEdge(3000, 4500)).toEqual({
      width: 1365,
      height: PHOTO_OCR_TARGET_LONG_EDGE,
      scale: PHOTO_OCR_TARGET_LONG_EDGE / 4500,
    })
  })

  it('never upscales small images', () => {
    expect(fitWithinLongEdge(1000, 800)).toEqual({ width: 1000, height: 800, scale: 1 })
    expect(fitWithinLongEdge(600, 400)).toEqual({ width: 600, height: 400, scale: 1 })
    expect(shouldDownscale(1000, 800)).toBe(false)
    expect(shouldDownscale(4000, 3000)).toBe(true)
  })

  it('returns a safe empty size for invalid values', () => {
    expect(fitWithinLongEdge(0, 1000)).toEqual({ width: 0, height: 0, scale: 1 })
    expect(fitWithinLongEdge(Number.NaN, 1000)).toEqual({ width: 0, height: 0, scale: 1 })
    expect(fitWithinLongEdge(-5, -5)).toEqual({ width: 0, height: 0, scale: 1 })
  })
})

describe('file validation', () => {
  it('accepts supported images and detects the type by extension if needed', () => {
    expect(validatePhotoFile(file('urlaub.jpg', 'image/jpeg'))).toBeNull()
    expect(validatePhotoFile(file('scan.png', 'image/png'))).toBeNull()
    expect(photoFileMimeType({ name: 'foto.HEIC', size: 10, type: '' })).toBe('image/heic')
    expect(photoFileMimeType({ name: 'foto.jpg', size: 10, type: 'image/jpeg' })).toBe(
      'image/jpeg',
    )
    expect(isPdfPhotoFile({ name: 'rezept.pdf', size: 10, type: '' })).toBe(true)
  })

  it('rejects non-images, unsupported formats, empty and oversized files', () => {
    expect(validatePhotoFile(file('rezept.txt', 'text/plain'))?.code).toBe('not-an-image')
    expect(validatePhotoFile(file('rezept.svg', 'image/svg+xml'))?.code).toBe(
      'unsupported-type',
    )
    expect(validatePhotoFile(file('rezept.pdf', 'application/pdf'))?.code).toBe(
      'not-an-image',
    )
    expect(validatePhotoFile(new File([], 'leer.jpg', { type: 'image/jpeg' }))?.code).toBe(
      'too-large',
    )
    const huge = file('riesig.jpg', 'image/jpeg', 31 * 1024 * 1024)
    expect(validatePhotoFile(huge)?.code).toBe('too-large')
    expect(validatePhotoFile(huge)?.message).toContain('30 MB')
  })
})

describe('page and size budget', () => {
  it('limits the recipe to the contract page count', () => {
    expect(validatePhotoPageCount(0, 4)).toBeNull()
    expect(validatePhotoPageCount(3, 1)).toBeNull()
    expect(validatePhotoPageCount(3, 2)?.code).toBe('too-many-pages')
    expect(validatePhotoPageCount(0, 5)?.message).toContain(String(PHOTO_OCR_MAX_PAGES))
  })

  it('limits the total prepared size', () => {
    expect(validatePhotoTotalBytes(PHOTO_OCR_MAX_TOTAL_BYTES)).toBeNull()
    expect(validatePhotoTotalBytes(PHOTO_OCR_MAX_TOTAL_BYTES + 1)?.code).toBe(
      'total-too-large',
    )
  })

  it('warns about very small photos but does not block them', () => {
    expect(photoResolutionWarning(200, 150)).toContain('sehr klein')
    expect(photoResolutionWarning(2048, 1536)).toBeNull()
    expect(photoResolutionWarning(0, 0)).toBeNull()
  })
})

describe('base64 and formatting helpers', () => {
  it('encodes standard Base64 without a data URL prefix', () => {
    const buffer = new TextEncoder().encode('Hallo Welt').buffer as ArrayBuffer
    expect(arrayBufferToBase64(buffer)).toBe(btoa('Hallo Welt'))
    expect(base64ByteLength(arrayBufferToBase64(buffer))).toBe(10)
    expect(base64ByteLength('SGFsbG8=')).toBe(5)
    expect(base64ByteLength('')).toBe(0)
  })

  it('formats sizes for German hints', () => {
    expect(formatPhotoBytes(512)).toBe('512 B')
    expect(formatPhotoBytes(1536)).toContain('KB')
    expect(formatPhotoBytes(5 * 1024 * 1024)).toContain('MB')
  })
})

describe('preparePhotoFile', () => {
  it('downscales to the target long edge and encodes JPEG with Base64', async () => {
    const { pipeline, canvi, qualities } = fakePipeline()
    const page = await preparePhotoFile(file('familienrezept.jpg'), pipeline)

    expect(canvi).toEqual([{ width: 2048, height: 1536 }])
    expect(page.mimeType).toBe('image/jpeg')
    expect(page.width).toBe(2048)
    expect(page.height).toBe(1536)
    expect(page.originalWidth).toBe(4000)
    expect(page.originalHeight).toBe(3000)
    expect(page.name).toBe('familienrezept.jpg')
    expect(page.id).toBeTruthy()
    expect(qualities).toHaveLength(1)
    expect(page.bytes.byteLength).toBe(500)
    expect(page.dataBase64).toBe(arrayBufferToBase64(page.bytes))
    expect(base64ByteLength(page.dataBase64)).toBe(500)
  })

  it('keeps the original size for small photos', async () => {
    const { pipeline, canvi } = fakePipeline({ width: 900, height: 700 })
    const page = await preparePhotoFile(file('klein.jpg'), pipeline)
    expect(canvi).toEqual([{ width: 900, height: 700 }])
    expect(page.width).toBe(900)
  })

  it('retries with lower JPEG quality when a page is too large', async () => {
    const { pipeline, qualities } = fakePipeline({
      encodeSizes: [PHOTO_OCR_MAX_PAGE_BYTES + 100, PHOTO_OCR_MAX_PAGE_BYTES - 100],
    })
    const page = await preparePhotoFile(file('gross.jpg'), pipeline)
    expect(qualities).toEqual([0.85, 0.7])
    expect(page.bytes.byteLength).toBe(PHOTO_OCR_MAX_PAGE_BYTES - 100)
  })

  it('fails with a readable message when the page cannot be brought under the limit', async () => {
    const { pipeline } = fakePipeline({
      encodeSizes: [
        PHOTO_OCR_MAX_PAGE_BYTES + 1,
        PHOTO_OCR_MAX_PAGE_BYTES + 1,
        PHOTO_OCR_MAX_PAGE_BYTES + 1,
      ],
    })
    await expect(preparePhotoFile(file('riesig.jpg'), pipeline)).rejects.toMatchObject({
      code: 'too-large',
    })
  })

  it('maps decoder failures to a German error', async () => {
    const pipeline = fakePipeline().pipeline
    pipeline.decode = async () => {
      throw new Error('HEIC nicht unterstützt')
    }
    await expect(preparePhotoFile(file('iphone.heic', 'image/heic'), pipeline)).rejects.toMatchObject({
      code: 'decode-failed',
    })
    await expect(preparePhotoFile(file('iphone.heic', 'image/heic'), pipeline)).rejects.toThrow(
      /in diesem Browser nicht gelesen/,
    )
  })
})

function preparedPage(name: string, byteLength: number): PreparedPhotoPage {
  return {
    id: name,
    name,
    mimeType: 'image/jpeg',
    bytes: bytesOf(byteLength),
    width: 2048,
    height: 1536,
    originalWidth: 4000,
    originalHeight: 3000,
    dataBase64: arrayBufferToBase64(bytesOf(byteLength)),
  }
}

describe('preparePhotoFiles', () => {
  it('prepares several files in order and keeps per-file errors separate', async () => {
    const prepared = [preparedPage('a.jpg', 1000), preparedPage('b.jpg', 1000)]
    let call = 0
    const result = await preparePhotoFiles(
      [file('a.jpg'), file('b.jpg')],
      [],
      {
        prepare: async () => {
          const page = prepared[call]
          call += 1
          if (!page) throw new Error('unerwartet')
          return page
        },
      },
    )

    expect(result.pages.map((page) => page.name)).toEqual(['a.jpg', 'b.jpg'])
    expect(result.errors).toEqual([])
  })

  it('stops when the page limit is reached and reports validation errors', async () => {
    const existing = [preparedPage('1', 10), preparedPage('2', 10), preparedPage('3', 10)]
    const result = await preparePhotoFiles(
      [file('4.jpg'), file('5.jpg')],
      existing,
      { prepare: async () => preparedPage('x', 10) },
    )
    expect(result.pages).toHaveLength(1)
    expect(result.errors.join(' ')).toContain('höchstens 4 Seiten')
  })

  it('ignores PDFs here and lets the PDF path handle them', async () => {
    const result = await preparePhotoFiles([file('rezept.pdf', 'application/pdf')], [], {
      prepare: async () => preparedPage('x', 10),
    })
    expect(result.pages).toHaveLength(0)
    expect(result.errors[0]).toContain('PDFs werden nur über die PDF-Auswahl')
  })

  it('stops before exceeding the total byte budget', async () => {
    const existing = [preparedPage('1', PHOTO_OCR_MAX_TOTAL_BYTES - 500)]
    const result = await preparePhotoFiles([file('2.jpg')], existing, {
      prepare: async () => preparedPage('2', 1000),
    })
    expect(result.pages).toHaveLength(0)
    expect(result.errors[0]).toContain('zusammen zu groß')
  })
})

describe('OCR conversion and preview URLs', () => {
  it('maps a prepared page to the shared request shape', () => {
    const page = preparedPage('seite.jpg', 42)
    expect(toOcrPage(page)).toEqual({
      mimeType: 'image/jpeg',
      dataBase64: page.dataBase64,
      width: 2048,
      height: 1536,
    })
  })

  it('creates and revokes preview URLs through the injected API', () => {
    const created: Blob[] = []
    const revoked: string[] = []
    const api = {
      createObjectURL(blob: Blob) {
        created.push(blob)
        return 'blob:preview-1'
      },
      revokeObjectURL(url: string) {
        revoked.push(url)
      },
    }
    const url = createPhotoPreviewUrl(bytesOf(4), 'image/jpeg', api)
    expect(url).toBe('blob:preview-1')
    expect(created[0]?.type).toBe('image/jpeg')
    revokePhotoPreviewUrl(url, api)
    revokePhotoPreviewUrl(null, api)
    expect(revoked).toEqual(['blob:preview-1'])
  })

  it('exposes a typed error class', () => {
    const error = new PhotoImageError('decode-failed', 'kaputt')
    expect(error.code).toBe('decode-failed')
    expect(error.message).toBe('kaputt')
  })
})
