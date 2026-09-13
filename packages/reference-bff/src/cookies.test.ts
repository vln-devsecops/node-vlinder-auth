import { describe, expect, it } from 'vitest'
import {
  ACCESS_COOKIE,
  clearBffCookie,
  clearSessionCookies,
  CSRF_COOKIE,
  parseCookieHeader,
  REFRESH_COOKIE,
  serializeBffCookie,
  sessionCookies,
} from './cookies'
import { verifyCsrfToken } from './csrf'

const config = { csrfSecret: 'secret', accessTokenDelivery: 'cookie' as const, refreshCookieMaxAgeSeconds: 2592000 }

describe('serializeBffCookie', () => {
  it('sets Secure, SameSite=Strict, HttpOnly by default, explicit Path and Max-Age', () => {
    const cookie = serializeBffCookie('name', 'value', { maxAgeSeconds: 60 })
    expect(cookie).toContain('name=value')
    expect(cookie).toContain('Path=/')
    expect(cookie).toContain('Max-Age=60')
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('Secure')
    expect(cookie).toContain('SameSite=Strict')
  })

  it('omits HttpOnly when explicitly disabled (the CSRF cookie case)', () => {
    const cookie = serializeBffCookie('name', 'value', { maxAgeSeconds: 60, httpOnly: false })
    expect(cookie).not.toContain('HttpOnly')
    expect(cookie).toContain('Secure')
    expect(cookie).toContain('SameSite=Strict')
  })
})

describe('clearBffCookie', () => {
  it('produces a Max-Age=0 cookie', () => {
    expect(clearBffCookie('name')).toContain('Max-Age=0')
  })
})

describe('parseCookieHeader', () => {
  it('parses a Cookie header into a name -> value map', () => {
    expect(parseCookieHeader('a=1; b=2')).toEqual({ a: '1', b: '2' })
  })

  it('returns an empty object for an undefined header', () => {
    expect(parseCookieHeader(undefined)).toEqual({})
  })
})

describe('sessionCookies', () => {
  it('mints refresh, CSRF (derived from the refresh token) and access cookies sharing one Max-Age', () => {
    const cookies = sessionCookies(config, { accessToken: 'access', refreshToken: 'refresh', expiresAt: Date.now() + 3600_000 })
    expect(cookies).toHaveLength(3)
    const parsed = Object.fromEntries(
      cookies.map((c) => {
        const [pair] = c.split(';')
        const eq = pair.indexOf('=')
        return [pair.slice(0, eq), pair.slice(eq + 1)]
      }),
    )
    expect(parsed[REFRESH_COOKIE]).toBe('refresh')
    expect(parsed[ACCESS_COOKIE]).toBe('access')
    expect(verifyCsrfToken('secret', 'refresh', parsed[CSRF_COOKIE], parsed[CSRF_COOKIE])).toBe(true)
    // refresh and CSRF cookies both carry the full configured Max-Age
    expect(cookies[0]).toContain(`Max-Age=${config.refreshCookieMaxAgeSeconds}`)
    expect(cookies[1]).toContain(`Max-Age=${config.refreshCookieMaxAgeSeconds}`)
  })

  it('omits the access-token cookie when delivery is body', () => {
    const bodyConfig = { ...config, accessTokenDelivery: 'body' as const }
    const cookies = sessionCookies(bodyConfig, { accessToken: 'access', refreshToken: 'refresh', expiresAt: Date.now() + 1000 })
    expect(cookies).toHaveLength(2)
  })
})

describe('clearSessionCookies', () => {
  it('clears all three cookies', () => {
    const cookies = clearSessionCookies()
    expect(cookies).toHaveLength(3)
    expect(cookies.every((c) => c.includes('Max-Age=0'))).toBe(true)
  })
})
