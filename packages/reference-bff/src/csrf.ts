import { createHmac, timingSafeEqual } from 'node:crypto'

// Double-submit CSRF, per terraform-modules/modules/aws/vlinder_auth/doc/admin-api-csrf.md
// (this BFF is the first implementation of that shared design; step 8a
// brings the admin API's edge function into line with it). The CSRF cookie
// value is HMAC-SHA256(csrfSecret, sessionId), base64url-encoded -- not a
// bare random value, so it cannot be forged by anyone who can merely *set* a
// cookie on the origin (e.g. via subdomain cookie-tossing) but not read one
// or set a custom cross-origin header.
//
// "Session id" is left undefined in the abstract design; for this BFF it is
// the refresh-token cookie's own (opaque) value. That is a deliberate choice
// (see reference-bff's task brief / doc history), not incidental: it means
// the CSRF cookie is naturally (re)minted every time the refresh-token
// cookie is (re)minted -- at /login/callback and at every successful
// /refresh -- always with the same Max-Age, and it rotates in lockstep with
// the refresh token with no extra bookkeeping.

/** Mints the CSRF cookie value: base64url(HMAC-SHA256(secret, sessionId)). */
export function mintCsrfCookieValue(secret: string, sessionId: string): string {
  return createHmac('sha256', secret).update(sessionId).digest('base64url')
}

/**
 * Verifies a CSRF attempt. Recomputes HMAC(secret, sessionId) and requires
 * it to equal **both** the request's own CSRF cookie and the request
 * header -- not just header-to-cookie -- since comparing only header to
 * cookie doesn't prove the cookie was legitimately minted by this server
 * (an attacker who can merely set a cookie could set matching header and
 * cookie values to an arbitrary string and pass a header===cookie check).
 */
export function verifyCsrfToken(
  secret: string,
  sessionId: string,
  cookieValue: string | undefined,
  headerValue: string | undefined,
): boolean {
  if (!cookieValue || !headerValue) {
    return false
  }
  const expected = mintCsrfCookieValue(secret, sessionId)
  return constantTimeEquals(expected, cookieValue) && constantTimeEquals(expected, headerValue)
}

function constantTimeEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)
  if (bufA.length !== bufB.length) {
    return false
  }
  return timingSafeEqual(bufA, bufB)
}
