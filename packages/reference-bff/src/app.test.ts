import request from 'supertest'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp } from './app'
import type { BffConfig } from './config'
import { mintCsrfCookieValue } from './csrf'
import { verifyState } from './stateJwe'
import * as authServiceClient from './authServiceClient'

vi.mock('./authServiceClient', async () => {
  const actual = await vi.importActual<typeof import('./authServiceClient')>('./authServiceClient')
  return {
    ...actual,
    exchangeToken: vi.fn(),
    refresh: vi.fn(),
    relay: vi.fn(),
  }
})

const baseConfig: BffConfig = {
  authServiceBaseUrl: 'https://auth.example.com',
  rpClientId: 'client-1',
  rpRedirectUri: 'https://app.example.com/login/callback',
  stateJweKey: 'a'.repeat(32),
  csrfSecret: 'csrf-secret',
  accessTokenDelivery: 'cookie',
  refreshCookieMaxAgeSeconds: 2592000,
  port: 3000,
}

function csrfPair(refreshToken: string, config: BffConfig = baseConfig) {
  return mintCsrfCookieValue(config.csrfSecret, refreshToken)
}

describe('GET /login', () => {
  it('redirects to the auth service /authorize with PKCE material and a decryptable state', async () => {
    const app = createApp(baseConfig)
    const res = await request(app).get('/login')

    expect(res.status).toBe(302)
    const location = new URL(res.headers.location)
    expect(location.origin + location.pathname).toBe('https://auth.example.com/api/v1/auth/authorize')
    expect(location.searchParams.get('client_id')).toBe('client-1')
    expect(location.searchParams.get('redirect_uri')).toBe('https://app.example.com/login/callback')
    expect(location.searchParams.get('response_type')).toBe('code')
    expect(location.searchParams.get('code_challenge_method')).toBe('S256')

    const state = location.searchParams.get('state')!
    const payload = await verifyState(state, baseConfig.stateJweKey)
    expect(payload).not.toBeNull()

    const setCookie = res.headers['set-cookie'] as unknown as string[]
    const nonceCookie = setCookie.find((c) => c.startsWith('vln_bff_login_csrf='))!
    expect(nonceCookie).toContain('SameSite=Lax')
    expect(nonceCookie).toContain('HttpOnly')
    expect(nonceCookie.split(';')[0].split('=')[1]).toBe(payload!.csrfNonce)
  })
})

describe('GET /login/callback', () => {
  beforeEach(() => {
    vi.mocked(authServiceClient.exchangeToken).mockReset()
  })

  /** Runs /login and returns both the resulting `state` and the login-nonce cookie a real browser would carry back. */
  async function loginFor(config: BffConfig = baseConfig) {
    const res = await request(createApp(config)).get('/login')
    const state = new URL(res.headers.location).searchParams.get('state')!
    const setCookie = res.headers['set-cookie'] as unknown as string[]
    const loginNonceCookie = setCookie.find((c) => c.startsWith('vln_bff_login_csrf='))!.split(';')[0]
    return { state, loginNonceCookie }
  }

  it('exchanges the token, sets refresh/csrf/access cookies, and returns idToken+expiresAt (cookie mode)', async () => {
    const { state, loginNonceCookie } = await loginFor()
    vi.mocked(authServiceClient.exchangeToken).mockResolvedValue({
      status: 200,
      body: { accessToken: 'access-1', idToken: 'id-1', refreshToken: 'refresh-1', expiresAt: Date.now() + 3600_000 },
    })

    const res = await request(createApp(baseConfig))
      .get('/login/callback')
      .query({ token: 't', state })
      .set('Cookie', [loginNonceCookie])

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ idToken: 'id-1', expiresAt: expect.any(Number) })
    const setCookie = res.headers['set-cookie'] as unknown as string[]
    expect(setCookie.some((c) => c.startsWith('vln_bff_refresh=refresh-1'))).toBe(true)
    expect(setCookie.some((c) => c.startsWith('vln_bff_access=access-1'))).toBe(true)
    const csrfCookie = setCookie.find((c) => c.startsWith('vln_auth_csrf='))!
    expect(csrfCookie).not.toContain('HttpOnly')
    expect(csrfCookie).toContain(csrfPair('refresh-1'))
    // The login-nonce cookie is single-use -- confirm it's cleared, not left alive.
    const clearedNonceCookie = setCookie.find((c) => c.startsWith('vln_bff_login_csrf='))!
    expect(clearedNonceCookie).toContain('Max-Age=0')
  })

  it('returns accessToken in the body and sets no access cookie in body mode', async () => {
    const config = { ...baseConfig, accessTokenDelivery: 'body' as const }
    const { state, loginNonceCookie } = await loginFor(config)
    vi.mocked(authServiceClient.exchangeToken).mockResolvedValue({
      status: 200,
      body: { accessToken: 'access-2', idToken: 'id-2', refreshToken: 'refresh-2', expiresAt: Date.now() + 1000 },
    })

    const res = await request(createApp(config))
      .get('/login/callback')
      .query({ token: 't', state })
      .set('Cookie', [loginNonceCookie])

    expect(res.body).toEqual({ idToken: 'id-2', expiresAt: expect.any(Number), accessToken: 'access-2' })
    const setCookie = res.headers['set-cookie'] as unknown as string[]
    expect(setCookie.some((c) => c.startsWith('vln_bff_access='))).toBe(false)
  })

  it('propagates a non-2xx upstream response verbatim', async () => {
    const { state, loginNonceCookie } = await loginFor()
    vi.mocked(authServiceClient.exchangeToken).mockResolvedValue({
      status: 400,
      body: { error: 'invalid_one_time_token' },
    })

    const res = await request(createApp(baseConfig))
      .get('/login/callback')
      .query({ token: 't', state })
      .set('Cookie', [loginNonceCookie])
    expect(res.status).toBe(400)
    expect(res.body).toEqual({ error: 'invalid_one_time_token' })
  })

  it('400s on missing token or state', async () => {
    const res = await request(createApp(baseConfig)).get('/login/callback').query({ state: 'x' })
    expect(res.status).toBe(400)
  })

  it('400s on an invalid/expired state', async () => {
    const res = await request(createApp(baseConfig)).get('/login/callback').query({ token: 't', state: 'garbage' })
    expect(res.status).toBe(400)
  })

  it('502s when the auth service returns a 2xx with a malformed body, instead of crashing on cookie serialization', async () => {
    const { state, loginNonceCookie } = await loginFor()
    vi.mocked(authServiceClient.exchangeToken).mockResolvedValue({ status: 200, body: {} })

    const res = await request(createApp(baseConfig))
      .get('/login/callback')
      .query({ token: 't', state })
      .set('Cookie', [loginNonceCookie])

    expect(res.status).toBe(502)
  })

  it('400s with login_csrf, without ever calling the auth service, when the login-nonce cookie is missing', async () => {
    const { state } = await loginFor()

    const res = await request(createApp(baseConfig)).get('/login/callback').query({ token: 't', state })

    expect(res.status).toBe(400)
    expect(res.body.error).toBe('login_csrf')
    expect(vi.mocked(authServiceClient.exchangeToken)).not.toHaveBeenCalled()
  })

  it('400s with login_csrf when the login-nonce cookie does not match the one embedded in state', async () => {
    // The exact attack this closes: an attacker completes their own login,
    // captures the resulting token+state, and lures a victim into visiting
    // it. The victim's browser never had the attacker's login-nonce cookie.
    const { state } = await loginFor()

    const res = await request(createApp(baseConfig))
      .get('/login/callback')
      .query({ token: 't', state })
      .set('Cookie', ['vln_bff_login_csrf=some-other-browsers-nonce'])

    expect(res.status).toBe(400)
    expect(res.body.error).toBe('login_csrf')
    expect(vi.mocked(authServiceClient.exchangeToken)).not.toHaveBeenCalled()
  })
})

describe('POST /refresh', () => {
  beforeEach(() => {
    vi.mocked(authServiceClient.refresh).mockReset()
  })

  it('403s when the CSRF cookie/header are missing', async () => {
    const res = await request(createApp(baseConfig))
      .post('/refresh')
      .set('Cookie', ['vln_bff_refresh=refresh-1'])
    expect(res.status).toBe(403)
  })

  it('403s when the CSRF header does not match the cookie', async () => {
    const csrf = csrfPair('refresh-1')
    const res = await request(createApp(baseConfig))
      .post('/refresh')
      .set('Cookie', [`vln_bff_refresh=refresh-1`, `vln_auth_csrf=${csrf}`])
      .set('X-Vln-Csrf-Token', 'wrong-value')
    expect(res.status).toBe(403)
  })

  it('403s when the refresh cookie is missing entirely', async () => {
    const csrf = csrfPair('refresh-1')
    const res = await request(createApp(baseConfig))
      .post('/refresh')
      .set('Cookie', [`vln_auth_csrf=${csrf}`])
      .set('X-Vln-Csrf-Token', csrf)
    expect(res.status).toBe(403)
  })

  it('rotates all three cookies on a successful refresh', async () => {
    const csrf = csrfPair('refresh-1')
    vi.mocked(authServiceClient.refresh).mockResolvedValue({
      status: 200,
      body: { accessToken: 'access-2', idToken: 'id-2', refreshToken: 'refresh-2', expiresAt: Date.now() + 1000 },
    })

    const res = await request(createApp(baseConfig))
      .post('/refresh')
      .set('Cookie', [`vln_bff_refresh=refresh-1`, `vln_auth_csrf=${csrf}`])
      .set('X-Vln-Csrf-Token', csrf)

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ idToken: 'id-2', expiresAt: expect.any(Number) })
    const setCookie = res.headers['set-cookie'] as unknown as string[]
    expect(setCookie.some((c) => c.startsWith('vln_bff_refresh=refresh-2'))).toBe(true)
    expect(vi.mocked(authServiceClient.refresh)).toHaveBeenCalledWith('https://auth.example.com', {
      refresh_token: 'refresh-1',
    })
  })

  it('502s when the auth service returns a 2xx with a malformed body', async () => {
    const csrf = csrfPair('refresh-1')
    vi.mocked(authServiceClient.refresh).mockResolvedValue({ status: 200, body: { accessToken: 'a' } })

    const res = await request(createApp(baseConfig))
      .post('/refresh')
      .set('Cookie', [`vln_bff_refresh=refresh-1`, `vln_auth_csrf=${csrf}`])
      .set('X-Vln-Csrf-Token', csrf)

    expect(res.status).toBe(502)
  })

  it('clears all cookies and 401s when the auth service rejects the refresh token', async () => {
    const csrf = csrfPair('refresh-1')
    vi.mocked(authServiceClient.refresh).mockResolvedValue({ status: 401, body: { error: 'invalid_refresh_token' } })

    const res = await request(createApp(baseConfig))
      .post('/refresh')
      .set('Cookie', [`vln_bff_refresh=refresh-1`, `vln_auth_csrf=${csrf}`])
      .set('X-Vln-Csrf-Token', csrf)

    expect(res.status).toBe(401)
    const setCookie = res.headers['set-cookie'] as unknown as string[]
    expect(setCookie.every((c) => c.includes('Max-Age=0'))).toBe(true)
    expect(setCookie).toHaveLength(3)
  })
})

describe('relays: GET /whoami, POST /sudo, POST /logout', () => {
  beforeEach(() => {
    vi.mocked(authServiceClient.relay).mockReset()
  })

  it('GET /whoami requires no CSRF and attaches the access-token cookie as Bearer', async () => {
    vi.mocked(authServiceClient.relay).mockResolvedValue({ status: 200, body: { active: [], held: [] } })

    const res = await request(createApp(baseConfig)).get('/whoami').set('Cookie', ['vln_bff_access=access-1'])

    expect(res.status).toBe(200)
    expect(vi.mocked(authServiceClient.relay)).toHaveBeenCalledWith(
      'https://auth.example.com',
      '/api/v1/auth/whoami',
      expect.objectContaining({ method: 'GET', authorization: 'Bearer access-1' }),
    )
  })

  it('POST /sudo requires CSRF and forwards the body', async () => {
    const csrf = csrfPair('refresh-1')
    vi.mocked(authServiceClient.relay).mockResolvedValue({ status: 404, body: {} })

    const withoutCsrf = await request(createApp(baseConfig))
      .post('/sudo')
      .send({ privilege: 'x' })
    expect(withoutCsrf.status).toBe(403)

    const res = await request(createApp(baseConfig))
      .post('/sudo')
      .set('Cookie', [`vln_bff_refresh=refresh-1`, `vln_auth_csrf=${csrf}`, 'vln_bff_access=access-1'])
      .set('X-Vln-Csrf-Token', csrf)
      .send({ privilege: 'refund:acme:orders/**' })

    expect(vi.mocked(authServiceClient.relay)).toHaveBeenCalledWith(
      'https://auth.example.com',
      '/api/v1/auth/sudo',
      expect.objectContaining({
        method: 'POST',
        authorization: 'Bearer access-1',
        body: { privilege: 'refund:acme:orders/**' },
      }),
    )
    expect(res.status).toBe(404) // /sudo doesn't exist on the auth service yet -- expected.
  })

  it('POST /logout clears all cookies unconditionally, even when the upstream relay 404s', async () => {
    const csrf = csrfPair('refresh-1')
    vi.mocked(authServiceClient.relay).mockResolvedValue({ status: 404, body: {} })

    const res = await request(createApp(baseConfig))
      .post('/logout')
      .set('Cookie', [`vln_bff_refresh=refresh-1`, `vln_auth_csrf=${csrf}`])
      .set('X-Vln-Csrf-Token', csrf)

    const setCookie = res.headers['set-cookie'] as unknown as string[]
    expect(setCookie).toHaveLength(3)
    expect(setCookie.every((c) => c.includes('Max-Age=0'))).toBe(true)
  })
})
