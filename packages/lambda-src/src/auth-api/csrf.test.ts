import { describe, expect, it } from 'vitest'
import { mintCsrfCookieValue } from './csrf'

// >= 43 bytes, the minimum mintCsrfCookieValue enforces.
const SECRET = 'a'.repeat(43)
const OTHER_SECRET = 'b'.repeat(43)

describe('mintCsrfCookieValue', () => {
  it('is deterministic for the same secret and session id', () => {
    expect(mintCsrfCookieValue(SECRET, 'session-1')).toBe(mintCsrfCookieValue(SECRET, 'session-1'))
  })

  it('mints different values for different session ids', () => {
    expect(mintCsrfCookieValue(SECRET, 'session-1')).not.toBe(mintCsrfCookieValue(SECRET, 'session-2'))
  })

  it('mints different values for different secrets', () => {
    expect(mintCsrfCookieValue(SECRET, 'session-1')).not.toBe(mintCsrfCookieValue(OTHER_SECRET, 'session-1'))
  })

  it('produces a base64url-alphabet string', () => {
    expect(mintCsrfCookieValue(SECRET, 'session-1')).toMatch(/^[A-Za-z0-9_-]+$/)
  })

  it('throws loudly, naming the env var, when the secret is shorter than 43 bytes', () => {
    // Regression: the secret is generated with plenty of entropy today (see
    // this file's own doc comment), but nothing previously stopped a
    // misconfigured or manually-overridden short secret from silently
    // producing a weak CSRF cookie -- unlike the A256GCM keys elsewhere in
    // this codebase, which fail loudly on a wrong byte count.
    expect(() => mintCsrfCookieValue('too-short', 'session-1')).toThrow(
      /Admin API CSRF secret must be at least 43 bytes/,
    )
  })

  it('accepts a secret at exactly the 43-byte minimum', () => {
    expect(() => mintCsrfCookieValue('a'.repeat(43), 'session-1')).not.toThrow()
  })

  it('rejects a secret one byte short of the minimum', () => {
    expect(() => mintCsrfCookieValue('a'.repeat(42), 'session-1')).toThrow(/at least 43 bytes/)
  })
})
