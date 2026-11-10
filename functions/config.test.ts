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
    expect(routes.include).toEqual(['/api/recipe-fetch'])
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

  it('keeps the Function source free of Node-only imports and APIs', () => {
    const files = [
      'functions/api/recipe-fetch.ts',
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
