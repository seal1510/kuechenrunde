import { describe, expect, it, vi } from 'vitest'
import {
  authorizeHouseholdMember,
  readSupabaseConfig,
  type SupabaseEnv,
} from './supabase-auth'
import { HttpError } from './http'

const env: SupabaseEnv = {
  SUPABASE_URL: 'https://project.supabase.co',
  SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_abcdefghijklmnopqrstuvwxyz',
}
const token = 'a'.repeat(40)

function request(authorization?: string): Request {
  return new Request('https://app.example.com/api/recipe-fetch', {
    method: 'POST',
    headers: authorization ? { Authorization: authorization } : {},
  })
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('Supabase auth and household membership', () => {
  it('rejects a missing or malformed token before any upstream call', async () => {
    const fetchImpl = vi.fn()
    await expect(
      authorizeHouseholdMember(request(), env, { fetchImpl: fetchImpl as unknown as typeof fetch }),
    ).rejects.toMatchObject({ status: 401, code: 'unauthorized' })
    expect(fetchImpl).not.toHaveBeenCalled()

    await expect(
      authorizeHouseholdMember(request('Basic abc'), env, {
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toMatchObject({ status: 401 })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('requires runtime configuration and rejects secret/service-role keys', () => {
    expect(() => readSupabaseConfig(undefined)).toThrow(HttpError)
    expect(() => readSupabaseConfig({ SUPABASE_URL: 'https://project.supabase.co' })).toThrow(
      /SUPABASE_PUBLISHABLE_KEY/,
    )
    expect(() =>
      readSupabaseConfig({
        SUPABASE_URL: 'http://project.supabase.co',
        SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_abcdefghijklmnopqrstuvwxyz',
      }),
    ).toThrow(/öffentliche HTTPS-Adresse/)
    expect(() =>
      readSupabaseConfig({
        SUPABASE_URL: 'https://project.supabase.co',
        SUPABASE_PUBLISHABLE_KEY: 'sb_secret_abcdefghijklmnopqrstuvwxyz',
      }),
    ).toThrow(HttpError)
    expect(() =>
      readSupabaseConfig({
        SUPABASE_URL: 'https://project.supabase.co',
        SUPABASE_PUBLISHABLE_KEY: `x.${btoa(JSON.stringify({ role: 'service_role' }))}.y`,
      }),
    ).toThrow(HttpError)
  })

  it('accepts the legacy anon key variable as a public-key fallback', () => {
    const config = readSupabaseConfig({
      SUPABASE_URL: 'https://project.supabase.co/',
      SUPABASE_ANON_KEY: 'sb_publishable_abcdefghijklmnopqrstuvwxyz',
    })
    expect(config.origin).toBe('https://project.supabase.co')
  })

  it('accepts a valid token only when the membership RPC returns true', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = []
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      calls.push({ url, init: init ?? {} })
      if (url.endsWith('/auth/v1/user')) {
        return json({ id: 'user-1', email: 'member@example.org' })
      }
      if (url.endsWith('/rest/v1/rpc/is_household_member')) return json(true)
      throw new Error(`unexpected ${url}`)
    }) as unknown as typeof fetch

    const member = await authorizeHouseholdMember(request(`Bearer ${token}`), env, { fetchImpl })
    expect(member).toEqual({ id: 'user-1', email: 'member@example.org' })
    expect(calls).toHaveLength(2)
    for (const call of calls) {
      const headers = call.init.headers as Record<string, string>
      expect(headers.apikey).toBe(env.SUPABASE_PUBLISHABLE_KEY)
      expect(headers.Authorization).toBe(`Bearer ${token}`)
      expect(JSON.stringify(headers)).not.toContain('service_role')
    }
    expect(calls[1]!.init.method).toBe('POST')
    expect(calls[1]!.init.body).toBe('{}')
  })

  it('rejects invalid tokens and non-members', async () => {
    const invalid = (async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/auth/v1/user')) return json({ message: 'invalid' }, 401)
      throw new Error('unexpected')
    }) as unknown as typeof fetch
    await expect(
      authorizeHouseholdMember(request(`Bearer ${token}`), env, { fetchImpl: invalid }),
    ).rejects.toMatchObject({ status: 401, code: 'unauthorized' })

    const nonMember = (async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/auth/v1/user')) return json({ id: 'user-2' })
      if (url.endsWith('/rest/v1/rpc/is_household_member')) return json(false)
      throw new Error('unexpected')
    }) as unknown as typeof fetch
    await expect(
      authorizeHouseholdMember(request(`Bearer ${token}`), env, { fetchImpl: nonMember }),
    ).rejects.toMatchObject({ status: 403, code: 'not-a-member' })

    const forbidden = (async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/auth/v1/user')) return json({ id: 'user-3' })
      return json({ message: 'forbidden' }, 403)
    }) as unknown as typeof fetch
    await expect(
      authorizeHouseholdMember(request(`Bearer ${token}`), env, { fetchImpl: forbidden }),
    ).rejects.toMatchObject({ status: 403, code: 'not-a-member' })
  })

  it('maps upstream failures and timeouts without echoing the token', async () => {
    const upstream = (async () => json({ message: 'down' }, 500)) as unknown as typeof fetch
    const error = await authorizeHouseholdMember(request(`Bearer ${token}`), env, {
      fetchImpl: upstream,
    }).catch((cause: unknown) => cause)
    expect(error).toBeInstanceOf(HttpError)
    expect((error as HttpError).status).toBe(502)
    expect((error as Error).message).not.toContain(token)

    const malformed = (async () =>
      new Response('not json', { headers: { 'Content-Type': 'application/json' } })) as unknown as typeof fetch
    await expect(
      authorizeHouseholdMember(request(`Bearer ${token}`), env, { fetchImpl: malformed }),
    ).rejects.toMatchObject({ status: 502 })

    const stalled = ((_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const abort = new Error('aborted')
          abort.name = 'AbortError'
          reject(abort)
        })
      })) as unknown as typeof fetch
    await expect(
      authorizeHouseholdMember(request(`Bearer ${token}`), env, {
        fetchImpl: stalled,
        timeoutMs: 10,
      }),
    ).rejects.toMatchObject({ status: 504, code: 'upstream-timeout' })
  })
})
