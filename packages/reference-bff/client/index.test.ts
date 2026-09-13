// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRefreshClient } from './index'

describe('createRefreshClient', () => {
  const originalFetch = global.fetch

  beforeEach(() => {
    document.cookie = 'vln_auth_csrf=csrf-value-1'
  })

  afterEach(() => {
    global.fetch = originalFetch
    document.cookie = 'vln_auth_csrf=; Max-Age=0'
  })

  it('sends the CSRF cookie value in the configured header, with credentials included', async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ idToken: 'id-1', expiresAt: 123 }), { status: 200 }),
    )
    global.fetch = mockFetch as unknown as typeof fetch

    const client = createRefreshClient({ refreshUrl: '/refresh' })
    const result = await client.refresh()

    expect(result).toEqual({ idToken: 'id-1', expiresAt: 123 })
    expect(mockFetch).toHaveBeenCalledWith(
      '/refresh',
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        headers: { 'X-Vln-Csrf-Token': 'csrf-value-1' },
      }),
    )
  })

  it('respects custom csrfHeaderName / csrfCookieName', async () => {
    document.cookie = 'custom-csrf=custom-value'
    const mockFetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ idToken: 'x', expiresAt: 1 }), { status: 200 }))
    global.fetch = mockFetch as unknown as typeof fetch

    const client = createRefreshClient({
      refreshUrl: '/refresh',
      csrfHeaderName: 'X-Custom-Csrf',
      csrfCookieName: 'custom-csrf',
    })
    await client.refresh()

    expect(mockFetch).toHaveBeenCalledWith(
      '/refresh',
      expect.objectContaining({ headers: { 'X-Custom-Csrf': 'custom-value' } }),
    )
  })

  it('coalesces concurrent refresh() calls into a single in-flight fetch', async () => {
    let resolveFetch!: (value: Response) => void
    const fetchPromise = new Promise<Response>((resolve) => {
      resolveFetch = resolve
    })
    const mockFetch = vi.fn().mockReturnValue(fetchPromise)
    global.fetch = mockFetch as unknown as typeof fetch

    const client = createRefreshClient({ refreshUrl: '/refresh' })

    const call1 = client.refresh()
    const call2 = client.refresh()
    const call3 = client.refresh()

    expect(mockFetch).toHaveBeenCalledTimes(1)

    resolveFetch(new Response(JSON.stringify({ idToken: 'shared', expiresAt: 999 }), { status: 200 }))

    const [r1, r2, r3] = await Promise.all([call1, call2, call3])
    expect(r1).toEqual({ idToken: 'shared', expiresAt: 999 })
    expect(r2).toEqual({ idToken: 'shared', expiresAt: 999 })
    expect(r3).toEqual({ idToken: 'shared', expiresAt: 999 })
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it('starts a fresh fetch for a refresh() call made after the previous one settled', async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ idToken: 'first', expiresAt: 1 }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ idToken: 'second', expiresAt: 2 }), { status: 200 }))
    global.fetch = mockFetch as unknown as typeof fetch

    const client = createRefreshClient({ refreshUrl: '/refresh' })
    const first = await client.refresh()
    const second = await client.refresh()

    expect(first.idToken).toBe('first')
    expect(second.idToken).toBe('second')
    expect(mockFetch).toHaveBeenCalledTimes(2)
  })

  it('throws when the refresh response is not ok', async () => {
    const mockFetch = vi.fn().mockResolvedValue(new Response('{}', { status: 401 }))
    global.fetch = mockFetch as unknown as typeof fetch

    const client = createRefreshClient({ refreshUrl: '/refresh' })
    await expect(client.refresh()).rejects.toThrow(/401/)
  })
})
