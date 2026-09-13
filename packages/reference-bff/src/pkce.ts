import { randomBytes, createHash } from 'node:crypto'

// PKCE (RFC 7636), mint side. lambda-src/src/auth-api/pkce.ts is the auth
// service's *verification* side (base64url(sha256(code_verifier)) ===
// code_challenge, S256 only); this is the BFF's mint side, producing values
// compatible with that exact construction.

/** A cryptographically random, URL-safe code_verifier (43-128 chars per RFC 7636; this emits 43). */
export function generateCodeVerifier(): string {
  // 32 raw bytes -> 43 base64url characters (no padding), within RFC 7636's
  // required 43-128 character range.
  return randomBytes(32).toString('base64url')
}

/** code_challenge = base64url(sha256(code_verifier)), the only method this system supports (S256). */
export function codeChallengeFor(codeVerifier: string): string {
  return createHash('sha256').update(codeVerifier).digest('base64url')
}
