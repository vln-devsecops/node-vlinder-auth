import { describe, expect, it } from 'vitest'
import {
  clearSessionCookie,
  parseCookies,
  serializeSessionCookie,
  signSession,
  verifySession,
} from './session'

const KEY = 'test-signing-key-000000000000000000000000'

describe('signSession / verifySession', () => {
  it('round-trips a payload and preserves its claims', () => {
    const token = signSession({ identifier: 'jane@example.com', method: 'password' }, KEY, 300)
    const payload = verifySession(token, KEY)
    expect(payload).toMatchObject({ identifier: 'jane@example.com', method: 'password' })
    expect(typeof payload?.exp).toBe('number')
  })

  it('rejects a token signed with a different key', () => {
    const token = signSession({ sub: 'user-1' }, KEY, 300)
    expect(verifySession(token, 'a-different-key')).toBeNull()
  })

  it('rejects a tampered payload', () => {
    const token = signSession({ sub: 'user-1' }, KEY, 300)
    const [header, , signature] = token.split('.')
    const forged = Buffer.from(JSON.stringify({ sub: 'admin', exp: 9999999999 }))
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '')
    expect(verifySession(`${header}.${forged}.${signature}`, KEY)).toBeNull()
  })

  it('rejects an expired token', () => {
    const issuedAt = 1_000_000_000_000
    const token = signSession({ sub: 'user-1' }, KEY, 60, issuedAt)
    // 61s later
    expect(verifySession(token, KEY, issuedAt + 61_000)).toBeNull()
    // still valid at 59s
    expect(verifySession(token, KEY, issuedAt + 59_000)).not.toBeNull()
  })

  it('returns null for undefined or malformed tokens', () => {
    expect(verifySession(undefined, KEY)).toBeNull()
    expect(verifySession('not-a-jws', KEY)).toBeNull()
    expect(verifySession('a.b', KEY)).toBeNull()
  })
})

describe('cookie helpers', () => {
  it('serializes an HttpOnly, Secure, SameSite=Strict cookie', () => {
    const cookie = serializeSessionCookie('vln_auth_session', 'abc.def.ghi', { maxAgeSeconds: 300 })
    expect(cookie).toContain('vln_auth_session=abc.def.ghi')
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('Secure')
    expect(cookie).toContain('SameSite=Strict')
    expect(cookie).toContain('Max-Age=300')
    expect(cookie).toContain('Path=/api/v1/auth')
  })

  it('clears a cookie with Max-Age=0', () => {
    expect(clearSessionCookie('vln_auth_session')).toContain('Max-Age=0')
  })

  it('parses the API Gateway v2 cookies array into a map', () => {
    expect(parseCookies(['vln_auth_identify=xyz', 'other=1'])).toEqual({
      vln_auth_identify: 'xyz',
      other: '1',
    })
    expect(parseCookies(undefined)).toEqual({})
  })
})
