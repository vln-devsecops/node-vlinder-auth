import { describe, expect, it } from 'vitest'
import { mintCsrfCookieValue, verifyCsrfToken } from './csrf'

describe('csrf', () => {
  it('mints a deterministic base64url HMAC value for a given secret and session id', () => {
    const value = mintCsrfCookieValue('secret', 'session-1')
    expect(value).toBe(mintCsrfCookieValue('secret', 'session-1'))
    expect(value).toMatch(/^[A-Za-z0-9_-]+$/)
  })

  it('mints different values for different session ids', () => {
    expect(mintCsrfCookieValue('secret', 'session-1')).not.toBe(mintCsrfCookieValue('secret', 'session-2'))
  })

  it('accepts when recomputed HMAC matches both the cookie and header', () => {
    const value = mintCsrfCookieValue('secret', 'session-1')
    expect(verifyCsrfToken('secret', 'session-1', value, value)).toBe(true)
  })

  it('rejects when the header does not match', () => {
    const value = mintCsrfCookieValue('secret', 'session-1')
    expect(verifyCsrfToken('secret', 'session-1', value, 'wrong-header')).toBe(false)
  })

  it('rejects when the cookie does not match, even if the header matches the recomputed value', () => {
    const value = mintCsrfCookieValue('secret', 'session-1')
    // Simulates an attacker who can set an arbitrary cookie (e.g. cookie
    // tossing) and control their own header, but cannot forge a value this
    // server actually minted.
    expect(verifyCsrfToken('secret', 'session-1', 'attacker-cookie', 'attacker-cookie')).toBe(false)
    expect(verifyCsrfToken('secret', 'session-1', value, value)).toBe(true)
  })

  it('rejects when either value is missing', () => {
    const value = mintCsrfCookieValue('secret', 'session-1')
    expect(verifyCsrfToken('secret', 'session-1', undefined, value)).toBe(false)
    expect(verifyCsrfToken('secret', 'session-1', value, undefined)).toBe(false)
  })

  it('rejects when the session id used to verify differs from the one used to mint', () => {
    const value = mintCsrfCookieValue('secret', 'session-1')
    expect(verifyCsrfToken('secret', 'session-2', value, value)).toBe(false)
  })
})
