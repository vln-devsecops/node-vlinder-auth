import { describe, expect, it } from 'vitest'
import { mintOneTimeToken, verifyOneTimeToken } from './oneTimeToken'

// Exactly 32 bytes when UTF-8 encoded (32 ASCII characters), as A256GCM's
// `dir` mode requires.
const KEY = '01234567890123456789012345678901'.slice(0, 32)

const PAYLOAD = {
  userId: 'jane@example.com',
  redirectUri: 'https://app.example.com/login/callback',
  codeChallenge: 'test-code-challenge',
  tokens: {
    accessToken: 'access-token',
    idToken: 'id-token',
    refreshToken: 'refresh-token',
    expiresAt: 1_000_003_600_000,
  },
}

describe('mintOneTimeToken / verifyOneTimeToken', () => {
  it('round-trips the payload', async () => {
    const token = await mintOneTimeToken(PAYLOAD, KEY, 60)
    const result = await verifyOneTimeToken(token, KEY)
    // toMatchObject, not toEqual: the decrypted payload also carries the
    // standard iat/exp claims jose adds, same as verifySession's payload.
    expect(result).toMatchObject(PAYLOAD)
  })

  it('rejects an expired token', async () => {
    const issuedAt = 1_000_000_000_000
    const token = await mintOneTimeToken(PAYLOAD, KEY, 60, issuedAt)
    expect(await verifyOneTimeToken(token, KEY, issuedAt + 61_000)).toBeNull()
    expect(await verifyOneTimeToken(token, KEY, issuedAt + 59_000)).not.toBeNull()
  })

  it('rejects a tampered token', async () => {
    const token = await mintOneTimeToken(PAYLOAD, KEY, 60)
    const parts = token.split('.')
    // Flip the first character of the ciphertext segment (not the last, which
    // in base64url can land on padding bits that don't change the decoded
    // bytes) -- GCM's authentication tag must reject any content change.
    const ciphertext = parts[3]
    const tamperedCiphertext = (ciphertext[0] === 'A' ? 'B' : 'A') + ciphertext.slice(1)
    const tampered = [parts[0], parts[1], parts[2], tamperedCiphertext, parts[4]].join('.')
    expect(await verifyOneTimeToken(tampered, KEY)).toBeNull()
  })

  it('rejects a token decrypted with the wrong key', async () => {
    const token = await mintOneTimeToken(PAYLOAD, KEY, 60)
    const otherKey = '99999999999999999999999999999999'.slice(0, 32)
    expect(await verifyOneTimeToken(token, otherKey)).toBeNull()
  })

  it('throws a clear error when the key is not exactly 32 bytes', async () => {
    await expect(mintOneTimeToken(PAYLOAD, 'too-short-key', 60)).rejects.toThrow(/32 bytes/)
  })
})
