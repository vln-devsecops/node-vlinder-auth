import { createHmac } from 'node:crypto'

// Double-submit CSRF, per terraform-modules/modules/aws/vlinder_auth/doc/admin-api-csrf.md
// (step 8a: the admin API's edge function is brought into line with the
// scheme reference-bff's own csrf.ts already established in step 8). The
// CSRF cookie value is HMAC-SHA256(csrfSecret, sessionId), base64url-encoded
// -- not a bare random value, so it cannot be forged by anyone who can
// merely *set* a cookie on the origin but not read one or set a custom
// cross-origin header.
//
// "Session id" here is AS_SESSION_COOKIE's own value (the raw Cognito access
// token minted alongside it in handler.ts's /password case) -- mirroring
// reference-bff's own choice of the refresh-token cookie's value as its
// session id, for the same reason: the CSRF cookie is naturally (re)minted
// every time the session cookie is (re)minted, always with the same Max-Age.
//
// Mint-only: this Lambda never verifies this cookie. Verification happens
// entirely at the CloudFront-Function edge (admin_api_rewrite.js), which
// compares the cookie to the X-Vln-Csrf-Token request header as a plain
// string comparison -- see the design doc above for the full posture.

// The Terraform-side seed script generates this secret with AWS's full
// printable-password alphabet (94 characters, ~6.55 bits/char) at length 64
// -- around 420 bits, comfortably clearing 256. But that's a fact about how
// the secret happens to be *generated* today; nothing here enforced it, so a
// future manual override, a misconfigured env var, or a change to the seed
// script could silently hand this function a weak key with no error at all
// -- unlike the A256GCM keys elsewhere in this codebase (see
// shared/dirJwe.ts's keyBytes), which fail loudly on a wrong byte count.
// This is a *minimum length* check, not a true entropy check (nothing can
// verify actual randomness from a string alone), assessed against the same
// conservative alphanumeric-alphabet assumption (62 chars, ~5.95 bits/char)
// already used elsewhere in this project's own entropy analysis -- so 43
// bytes is the floor that still guarantees >= 256 bits even under that
// pessimistic assumption, not just under the alphabet the seed script
// actually uses.
const MIN_CSRF_SECRET_BYTES = 43

/** Mints the CSRF cookie value: base64url(HMAC-SHA256(secret, sessionId)). */
export function mintCsrfCookieValue(secret: string, sessionId: string): string {
  const secretBytes = new TextEncoder().encode(secret).length
  if (secretBytes < MIN_CSRF_SECRET_BYTES) {
    throw new Error(
      `Admin API CSRF secret must be at least ${MIN_CSRF_SECRET_BYTES} bytes (to guarantee >= 256 bits ` +
        `even under a conservative alphanumeric-alphabet assumption), got ${secretBytes}. ` +
        'Check the value stored under ADMIN_API_CSRF_SECRET_ID.',
    )
  }
  return createHmac('sha256', secret).update(sessionId).digest('base64url')
}
