import { createHash } from 'node:crypto'

// PKCE (RFC 7636) verification for the RP handoff (see doc/vendor-neutral-auth.md's
// "Login" sequence diagram). The BFF mints a random `code_verifier` and sends only
// its S256 hash (`code_challenge`) through the browser-visible /authorize redirect;
// the verifier itself never leaves the BFF until /token, at which point this checks
// that whoever is redeeming the one-time token is the same party that started the
// flow -- a stolen one-time token is useless without the verifier.

/**
 * Verifies `code_verifier` against a previously-issued `code_challenge` using the
 * S256 method: base64url(sha256(code_verifier)) === code_challenge. This is the
 * only method this codebase supports (see UnsupportedCodeChallengeMethodError in
 * handlers/authorize.ts) -- plain (unhashed) PKCE is deliberately not offered.
 */
export function verifyCodeChallenge(codeVerifier: string, codeChallenge: string): boolean {
  const expected = createHash('sha256').update(codeVerifier).digest('base64url')
  return expected === codeChallenge
}
