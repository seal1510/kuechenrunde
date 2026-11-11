import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const root = new URL('../', import.meta.url)

function read(path: string): string {
  return readFileSync(new URL(path, root), 'utf8')
}

describe('Cloudflare Pages configuration', () => {
  it('routes only the recipe fetch endpoint to Pages Functions', () => {
    const routes = JSON.parse(read('public/_routes.json')) as {
      version: number
      include: string[]
      exclude: string[]
    }
    expect(routes.version).toBe(1)
    expect(routes.include).toEqual(['/api/recipe-fetch', '/api/recipe-ocr'])
    expect(routes.exclude).toEqual([])
  })

  it('prepares the Pages build without committing secrets', () => {
    const wrangler = read('wrangler.toml')
    expect(wrangler).toContain('pages_build_output_dir = "dist"')
    expect(wrangler).toContain('global_fetch_strictly_public')
    expect(wrangler).not.toMatch(/service_role\s*=/)
    expect(wrangler).not.toMatch(/SUPABASE_(SERVICE|SECRET)/)
    expect(wrangler).not.toMatch(/sb_secret_/)
  })

  it('binds Workers AI for the photo OCR Function', () => {
    const wrangler = read('wrangler.toml')
    expect(wrangler).toMatch(/^\[ai\]$/m)
    expect(wrangler).toMatch(/^\s*binding\s*=\s*"AI"\s*$/m)
    // Das Binding ist kein Secret und darf keine Zugangsdaten enthalten.
    expect(wrangler).not.toMatch(/api[_-]?token/i)
    expect(wrangler).not.toMatch(/api[_-]?key/i)
  })

  it('ships secure HTTP headers for the static site', () => {
    const headers = read('public/_headers')
    expect(headers).toContain('X-Content-Type-Options: nosniff')
    expect(headers).toContain('X-Frame-Options: DENY')
    expect(headers).toContain('Referrer-Policy: strict-origin-when-cross-origin')
    expect(headers).toContain('Strict-Transport-Security:')
    expect(headers).toContain("default-src 'self'")
    expect(headers).toContain("object-src 'none'")
    expect(headers).toContain("frame-ancestors 'none'")
    expect(headers).toContain('https://*.supabase.co')
    expect(headers).toContain('wss://*.supabase.co')
    expect(headers).not.toContain("'unsafe-eval'")
    expect(headers).not.toContain('*;')
  })

  it('pins a supported Node version for Cloudflare Pages', () => {
    const pkg = JSON.parse(read('package.json')) as {
      engines?: { node?: string }
      scripts?: Record<string, string>
    }
    expect(pkg.engines?.node).toBe('>=22')
    expect(pkg.scripts?.build).toContain('tsc -p functions/tsconfig.json --noEmit')
    expect(read('.nvmrc').trim()).toBe('22')
  })

  it('keeps legal notices complete and in sync', () => {
    const notice = read('NOTICE')
    expect(read('public/legal/NOTICE.txt')).toBe(notice)
    expect(notice).toContain('@supabase/supabase-js')
    expect(notice).toContain('tslib')
    expect(notice).toContain('ODbL 1.0')
    expect(notice).toContain('ingredients.txt')
    expect(notice).toContain('ingredients_processing.txt')
    expect(notice).toContain('/legal/ingredient-catalog.json')
    expect(notice).not.toMatch(/schriftlich mit Open\s+Food Facts zu klären/)
    const offNotice = read('public/legal/OFF-DATA-NOTICE.txt')
    expect(offNotice).toContain('ODbL 1.0')
    expect(offNotice).toContain('ingredients.txt')
    expect(offNotice).toContain('ingredients_processing.txt')
    expect(offNotice).toContain('/legal/ingredient-catalog.json')
    expect(offNotice).not.toContain('reuse@openfoodfacts.org')
    const thirdParty = read('public/legal/THIRD-PARTY-LICENSES.txt')
    expect(thirdParty).toContain('@supabase/supabase-js')
    expect(thirdParty).toContain('@supabase/phoenix')
    expect(thirdParty).toContain('iceberg-js')
    expect(thirdParty).toContain('tslib')
    expect(read('public/legal/LICENSE.txt')).toBe(read('LICENSE'))
  })

  it('keeps the Function source free of Node-only imports and APIs', () => {
    const files = [
      'functions/api/recipe-fetch.ts',
      'functions/api/recipe-ocr.ts',
      'functions/lib/photo-ai.ts',
      'functions/lib/photo-request.ts',
      'functions/lib/http.ts',
      'functions/lib/remote-fetch.ts',
      'functions/lib/supabase-auth.ts',
    ]
    for (const file of files) {
      const source = read(file)
      expect(source, file).not.toMatch(/from\s+['"]node:/)
      expect(source, file).not.toMatch(/\brequire\s*\(/)
      expect(source, file).not.toMatch(/\bBuffer\b/)
      expect(source, file).not.toMatch(/\bprocess\./)
      expect(source, file).not.toMatch(/\bdocument\./)
      expect(source, file).not.toMatch(/\bwindow\./)
    }
    const remote = read('functions/lib/remote-fetch.ts')
    expect(remote).toContain("redirect: 'manual'")
    expect(remote).toContain('readBodyLimited')
    expect(remote).toContain('CLOUD_URL_POLICY')
  })
})
