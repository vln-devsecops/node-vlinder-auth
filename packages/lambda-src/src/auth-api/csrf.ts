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

/** Mints the CSRF cookie value: base64url(HMAC-SHA256(secret, sessionId)). */
export function mintCsrfCookieValue(secret: string, sessionId: string): string {
  return createHmac('sha256', secret).update(sessionId).digest('base64url')
}
