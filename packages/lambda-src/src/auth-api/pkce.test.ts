import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { verifyCodeChallenge } from './pkce'

describe('verifyCodeChallenge', () => {
  it('accepts a verifier whose S256 hash matches the challenge', () => {
    const codeVerifier = 'a-known-code-verifier-string'
    const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url')

    expect(verifyCodeChallenge(codeVerifier, codeChallenge)).toBe(true)
  })

  it('rejects a verifier that does not hash to the given challenge', () => {
    const codeChallenge = createHash('sha256').update('the-real-verifier').digest('base64url')

    expect(verifyCodeChallenge('a-different-verifier', codeChallenge)).toBe(false)
  })

  it('rejects when both are empty strings rather than treating them as trivially equal', () => {
    expect(verifyCodeChallenge('', '')).toBe(false)
  })
})
