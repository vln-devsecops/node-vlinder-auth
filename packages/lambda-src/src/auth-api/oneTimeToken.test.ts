import { decodeProtectedHeader } from 'jose'
import { describe, expect, it } from 'vitest'
import { mintOneTimeToken, type OneTimeTokenKey, verifyOneTimeToken } from './oneTimeToken'

// Exactly 32 bytes when UTF-8 encoded (32 ASCII characters), as A256GCM's
// `dir` mode requires.
const KEY_MATERIAL = '01234567890123456789012345678901'.slice(0, 32)
const KEY: OneTimeTokenKey = { keyId: 'test-key-id', key: KEY_MATERIAL }

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
    const result = await verifyOneTimeToken(token, [KEY])
    // toMatchObject, not toEqual: the decrypted payload also carries the
    // standard iat/exp claims jose adds, same as verifySession's payload.
    expect(result).toMatchObject(PAYLOAD)
  })

  it('embeds the key id as the JWE protected header kid, for operator traceability across a rotation boundary', async () => {
    const token = await mintOneTimeToken(PAYLOAD, KEY, 60)
    const header = decodeProtectedHeader(token)
    expect(header.kid).toBe('test-key-id')
  })

  it('rejects an expired token', async () => {
    const issuedAt = 1_000_000_000_000
    const token = await mintOneTimeToken(PAYLOAD, KEY, 60, issuedAt)
    expect(await verifyOneTimeToken(token, [KEY], issuedAt + 61_000)).toBeNull()
    expect(await verifyOneTimeToken(token, [KEY], issuedAt + 59_000)).not.toBeNull()
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
    expect(await verifyOneTimeToken(tampered, [KEY])).toBeNull()
  })

  it('rejects a token decrypted with the wrong key', async () => {
    const token = await mintOneTimeToken(PAYLOAD, KEY, 60)
    const otherKey: OneTimeTokenKey = {
      keyId: 'other-key-id',
      key: '99999999999999999999999999999999'.slice(0, 32),
    }
    expect(await verifyOneTimeToken(token, [otherKey])).toBeNull()
  })

  it('throws a clear error when the key is not exactly 32 bytes', async () => {
    await expect(
      mintOneTimeToken(PAYLOAD, { keyId: 'short', key: 'too-short-key' }, 60),
    ).rejects.toThrow(/32 bytes/)
  })

  it('succeeds against a token minted with a previous key, when both current and previous are supplied as candidates (rotation boundary)', async () => {
    const previousKey: OneTimeTokenKey = {
      keyId: 'previous-key-id',
      key: '99999999999999999999999999999999'.slice(0, 32),
    }
    const currentKey: OneTimeTokenKey = { keyId: 'current-key-id', key: KEY_MATERIAL }
    // Minted right before rotation, with what was then AWSCURRENT and is now
    // AWSPREVIOUS by the time /token verifies it.
    const token = await mintOneTimeToken(PAYLOAD, previousKey, 60)

    const result = await verifyOneTimeToken(token, [currentKey, previousKey])

    expect(result).toMatchObject(PAYLOAD)
  })

  it('fails when only a key that matches neither current nor previous is supplied', async () => {
    const token = await mintOneTimeToken(PAYLOAD, KEY, 60)
    const unrelatedKey: OneTimeTokenKey = {
      keyId: 'unrelated-key-id',
      key: '55555555555555555555555555555555'.slice(0, 32),
    }
    expect(await verifyOneTimeToken(token, [unrelatedKey])).toBeNull()
  })

  it('returns null when given an empty candidate list', async () => {
    const token = await mintOneTimeToken(PAYLOAD, KEY, 60)
    expect(await verifyOneTimeToken(token, [])).toBeNull()
  })

  it('throws a clear error (not a silent null) when a candidate key is not exactly 32 bytes', async () => {
    // Regression: a per-candidate try/catch must not swallow a
    // misconfigured-key error as if it were just "this candidate didn't
    // match" -- the two are different failure classes and must not look
    // the same to an operator debugging a /token outage.
    const token = await mintOneTimeToken(PAYLOAD, KEY, 60)
    const badKey: OneTimeTokenKey = { keyId: 'bad', key: 'too-short-key' }
    await expect(verifyOneTimeToken(token, [badKey])).rejects.toThrow(/32 bytes/)
  })
})
