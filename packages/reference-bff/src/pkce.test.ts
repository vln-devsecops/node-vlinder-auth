import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { codeChallengeFor, generateCodeVerifier } from './pkce'

describe('pkce', () => {
  it('generates a URL-safe verifier of RFC 7636 length (43-128 chars)', () => {
    const verifier = generateCodeVerifier()
    expect(verifier.length).toBeGreaterThanOrEqual(43)
    expect(verifier.length).toBeLessThanOrEqual(128)
    expect(verifier).toMatch(/^[A-Za-z0-9_-]+$/)
  })

  it('generates different verifiers on each call', () => {
    expect(generateCodeVerifier()).not.toBe(generateCodeVerifier())
  })

  it('computes code_challenge as base64url(sha256(code_verifier)), matching the auth service verification', () => {
    const verifier = generateCodeVerifier()
    const challenge = codeChallengeFor(verifier)
    const expected = createHash('sha256').update(verifier).digest('base64url')
    expect(challenge).toBe(expected)
  })
})
