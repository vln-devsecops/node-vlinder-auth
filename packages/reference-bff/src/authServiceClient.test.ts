import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { exchangeToken, refresh, relay } from './authServiceClient'

describe('authServiceClient', () => {
  const originalFetch = global.fetch

  beforeEach(() => {
    global.fetch = vi.fn()
  })

  afterEach(() => {
    global.fetch = originalFetch
  })

  it('exchangeToken posts snake_case code_verifier to /api/v1/auth/token', async () => {
    const mockFetch = global.fetch as ReturnType<typeof vi.fn>
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ accessToken: 'a', idToken: 'i', refreshToken: 'r', expiresAt: 1 }), {
        status: 200,
      }),
    )

    const result = await exchangeToken('https://auth.example.com', { token: 't', code_verifier: 'v' })

    expect(mockFetch).toHaveBeenCalledWith(
      'https://auth.example.com/api/v1/auth/token',
      expect.objectContaining({ method: 'POST' }),
    )
    const [, init] = mockFetch.mock.calls[0]
    expect(JSON.parse(init.body as string)).toEqual({ token: 't', code_verifier: 'v' })
    expect(result).toEqual({ status: 200, body: { accessToken: 'a', idToken: 'i', refreshToken: 'r', expiresAt: 1 } })
  })

  it('exchangeToken propagates a non-2xx status and body verbatim', async () => {
    const mockFetch = global.fetch as ReturnType<typeof vi.fn>
    mockFetch.mockResolvedValue(new Response(JSON.stringify({ error: 'invalid_request' }), { status: 400 }))

    const result = await exchangeToken('https://auth.example.com', { token: 't', code_verifier: 'v' })
    expect(result.status).toBe(400)
    expect(result.body).toEqual({ error: 'invalid_request' })
  })

  it('refresh posts refresh_token to /api/v1/auth/refresh', async () => {
    const mockFetch = global.fetch as ReturnType<typeof vi.fn>
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ accessToken: 'a2', idToken: 'i2', refreshToken: 'r2', expiresAt: 2 }), {
        status: 200,
      }),
    )
    const result = await refresh('https://auth.example.com', { refresh_token: 'r' })
    expect(mockFetch).toHaveBeenCalledWith(
      'https://auth.example.com/api/v1/auth/refresh',
      expect.objectContaining({ method: 'POST' }),
    )
    expect(result.status).toBe(200)
  })

  it('relay forwards method, Authorization header, and body, returning the upstream status and body', async () => {
    const mockFetch = global.fetch as ReturnType<typeof vi.fn>
    mockFetch.mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }))

    const result = await relay('https://auth.example.com', '/api/v1/auth/sudo', {
      method: 'POST',
      authorization: 'Bearer abc',
      body: { privilege: 'x' },
    })

    expect(mockFetch).toHaveBeenCalledWith(
      'https://auth.example.com/api/v1/auth/sudo',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ authorization: 'Bearer abc' }),
      }),
    )
    expect(result).toEqual({ status: 200, body: { ok: true } })
  })

  it('relay omits the Authorization header when none is given', async () => {
    const mockFetch = global.fetch as ReturnType<typeof vi.fn>
    mockFetch.mockResolvedValue(new Response('{}', { status: 200 }))
    await relay('https://auth.example.com', '/api/v1/auth/whoami', { method: 'GET' })
    const [, init] = mockFetch.mock.calls[0]
    expect((init.headers as Record<string, string>).authorization).toBeUndefined()
  })

  it('relay handles a 404 (endpoint not yet built) by passing the status through', async () => {
    const mockFetch = global.fetch as ReturnType<typeof vi.fn>
    mockFetch.mockResolvedValue(new Response('Not Found', { status: 404 }))
    const result = await relay('https://auth.example.com', '/api/v1/auth/whoami', { method: 'GET' })
    expect(result.status).toBe(404)
  })
})
