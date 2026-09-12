import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { mintOneTimeToken } from '../oneTimeToken'
import { exchangeToken, InvalidOneTimeTokenError, PkceMismatchError } from './token'

const KEY = '01234567890123456789012345678901'.slice(0, 32)
const CODE_VERIFIER = 'a-known-code-verifier-string'
const CODE_CHALLENGE = createHash('sha256').update(CODE_VERIFIER).digest('base64url')

const TOKENS = {
  accessToken: 'access-token',
  idToken: 'id-token',
  refreshToken: 'refresh-token',
  expiresAt: 1_000_003_600_000,
}

function oneTimeTokenFor(codeChallenge = CODE_CHALLENGE, ttlSeconds = 60, now?: number) {
  return mintOneTimeToken(
    {
      userId: 'jane@example.com',
      redirectUri: 'https://app.example.com/login/callback',
      codeChallenge,
      tokens: TOKENS,
    },
    KEY,
    ttlSeconds,
    now,
  )
}

describe('exchangeToken', () => {
  it('returns the embedded tokens when the one-time token and PKCE verifier both check out', async () => {
    const token = await oneTimeTokenFor()

    const result = await exchangeToken({ token, codeVerifier: CODE_VERIFIER, key: KEY })

    expect(result).toEqual(TOKENS)
  })

  it('rejects an expired one-time token', async () => {
    const issuedAt = 1_000_000_000_000
    const token = await oneTimeTokenFor(CODE_CHALLENGE, 60, issuedAt)

    await expect(
      exchangeToken({ token, codeVerifier: CODE_VERIFIER, key: KEY, now: issuedAt + 61_000 }),
    ).rejects.toThrow(InvalidOneTimeTokenError)
  })

  it('rejects a tampered one-time token', async () => {
    const token = await oneTimeTokenFor()
    const parts = token.split('.')
    const tamperedCiphertext = parts[3].slice(0, -1) + (parts[3].slice(-1) === 'A' ? 'B' : 'A')
    const tampered = [parts[0], parts[1], parts[2], tamperedCiphertext, parts[4]].join('.')

    await expect(exchangeToken({ token: tampered, codeVerifier: CODE_VERIFIER, key: KEY })).rejects.toThrow(
      InvalidOneTimeTokenError,
    )
  })

  it('rejects a correct token but wrong code_verifier', async () => {
    const token = await oneTimeTokenFor()

    await expect(
      exchangeToken({ token, codeVerifier: 'not-the-right-verifier', key: KEY }),
    ).rejects.toThrow(PkceMismatchError)
  })
})
