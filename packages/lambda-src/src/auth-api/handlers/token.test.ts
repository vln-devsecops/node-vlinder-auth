import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { mintOneTimeToken, type OneTimeTokenKey } from '../oneTimeToken'
import { exchangeToken, InvalidOneTimeTokenError, PkceMismatchError } from './token'

const KEY: OneTimeTokenKey = { keyId: 'current-key-id', key: '01234567890123456789012345678901'.slice(0, 32) }
const CODE_VERIFIER = 'a-known-code-verifier-string'
const CODE_CHALLENGE = createHash('sha256').update(CODE_VERIFIER).digest('base64url')

const TOKENS = {
  accessToken: 'access-token',
  idToken: 'id-token',
  refreshToken: 'refresh-token',
  expiresAt: 1_000_003_600_000,
}

function oneTimeTokenFor(
  codeChallenge = CODE_CHALLENGE,
  ttlSeconds = 60,
  now?: number,
  key: OneTimeTokenKey = KEY,
) {
  return mintOneTimeToken(
    {
      userId: 'jane@example.com',
      redirectUri: 'https://app.example.com/login/callback',
      codeChallenge,
      tokens: TOKENS,
    },
    key,
    ttlSeconds,
    now,
  )
}

describe('exchangeToken', () => {
  it('returns the embedded tokens when the one-time token and PKCE verifier both check out', async () => {
    const token = await oneTimeTokenFor()

    const result = await exchangeToken({ token, codeVerifier: CODE_VERIFIER, keys: [KEY] })

    expect(result).toEqual(TOKENS)
  })

  it('rejects an expired one-time token', async () => {
    const issuedAt = 1_000_000_000_000
    const token = await oneTimeTokenFor(CODE_CHALLENGE, 60, issuedAt)

    await expect(
      exchangeToken({ token, codeVerifier: CODE_VERIFIER, keys: [KEY], now: issuedAt + 61_000 }),
    ).rejects.toThrow(InvalidOneTimeTokenError)
  })

  it('rejects a tampered one-time token', async () => {
    const token = await oneTimeTokenFor()
    const parts = token.split('.')
    // Flip the first character, not the last: in base64url the last
    // character can land on padding bits that don't change the decoded
    // bytes, which would make this test flaky (see oneTimeToken.test.ts's
    // identical tamper test).
    const ciphertext = parts[3]
    const tamperedCiphertext = (ciphertext[0] === 'A' ? 'B' : 'A') + ciphertext.slice(1)
    const tampered = [parts[0], parts[1], parts[2], tamperedCiphertext, parts[4]].join('.')

    await expect(
      exchangeToken({ token: tampered, codeVerifier: CODE_VERIFIER, keys: [KEY] }),
    ).rejects.toThrow(InvalidOneTimeTokenError)
  })

  it('rejects a correct token but wrong code_verifier', async () => {
    const token = await oneTimeTokenFor()

    await expect(
      exchangeToken({ token, codeVerifier: 'not-the-right-verifier', keys: [KEY] }),
    ).rejects.toThrow(PkceMismatchError)
  })

  it('succeeds across a rotation boundary: a token minted with the previous key still exchanges when both current and previous are supplied', async () => {
    // Mirrors the real call site's ordering in handler.ts (current first,
    // then previous) -- this is the actual scenario the rotation fix exists
    // for: a token minted right before `put-secret-value` replaced
    // AWSCURRENT, exchanged just after, while its 60s TTL still holds.
    const previousKey: OneTimeTokenKey = {
      keyId: 'previous-key-id',
      key: '99999999999999999999999999999999'.slice(0, 32),
    }
    const token = await oneTimeTokenFor(CODE_CHALLENGE, 60, undefined, previousKey)

    const result = await exchangeToken({
      token,
      codeVerifier: CODE_VERIFIER,
      keys: [KEY, previousKey],
    })

    expect(result).toEqual(TOKENS)
  })
})
