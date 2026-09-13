import { describe, expect, it } from 'vitest'
import { mintState, verifyState } from './stateJwe'

const KEY = 'a'.repeat(32)
const OTHER_KEY = 'b'.repeat(32)

describe('stateJwe', () => {
  it('round-trips a payload through mint and verify', async () => {
    const now = Date.parse('2026-01-01T00:00:00Z')
    const token = await mintState({ codeVerifier: 'verifier-value', issuedAt: now, csrfNonce: 'nonce-1' }, KEY, 300, now)
    const payload = await verifyState(token, KEY, now)
    expect(payload).toEqual({ codeVerifier: 'verifier-value', issuedAt: now, csrfNonce: 'nonce-1' })
  })

  it('rejects a token past its TTL', async () => {
    const now = Date.parse('2026-01-01T00:00:00Z')
    const token = await mintState({ codeVerifier: 'v', issuedAt: now, csrfNonce: 'n' }, KEY, 300, now)
    const payload = await verifyState(token, KEY, now + 301_000)
    expect(payload).toBeNull()
  })

  it('rejects a token decrypted with the wrong key', async () => {
    const now = Date.parse('2026-01-01T00:00:00Z')
    const token = await mintState({ codeVerifier: 'v', issuedAt: now, csrfNonce: 'n' }, KEY, 300, now)
    const payload = await verifyState(token, OTHER_KEY, now)
    expect(payload).toBeNull()
  })

  it('rejects malformed/tampered tokens', async () => {
    const payload = await verifyState('not-a-real-jwe', KEY)
    expect(payload).toBeNull()
  })

  it('throws loudly on a key of the wrong byte length, naming the env var', async () => {
    await expect(
      mintState({ codeVerifier: 'v', issuedAt: Date.now(), csrfNonce: 'n' }, 'too-short', 300),
    ).rejects.toThrow(/STATE_JWE_KEY must be exactly 32 bytes/)
  })

  it('verifyState also throws loudly on a wrong-length key, rather than swallowing it as an invalid token', async () => {
    // Regression: a misconfigured STATE_JWE_KEY must not be indistinguishable
    // from an ordinary tampered/expired token -- see the fix in
    // lambda-src/src/auth-api/oneTimeToken.ts for the identical bug class.
    const token = await mintState({ codeVerifier: 'v', issuedAt: Date.now(), csrfNonce: 'n' }, KEY, 300)
    await expect(verifyState(token, 'too-short')).rejects.toThrow(/STATE_JWE_KEY must be exactly 32 bytes/)
  })
})
