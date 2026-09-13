import { describe, expect, it } from 'vitest'
import { mintCsrfCookieValue } from './csrf'

describe('mintCsrfCookieValue', () => {
  it('is deterministic for the same secret and session id', () => {
    expect(mintCsrfCookieValue('secret', 'session-1')).toBe(mintCsrfCookieValue('secret', 'session-1'))
  })

  it('mints different values for different session ids', () => {
    expect(mintCsrfCookieValue('secret', 'session-1')).not.toBe(mintCsrfCookieValue('secret', 'session-2'))
  })

  it('mints different values for different secrets', () => {
    expect(mintCsrfCookieValue('secret-a', 'session-1')).not.toBe(mintCsrfCookieValue('secret-b', 'session-1'))
  })

  it('produces a base64url-alphabet string', () => {
    expect(mintCsrfCookieValue('secret', 'session-1')).toMatch(/^[A-Za-z0-9_-]+$/)
  })
})
