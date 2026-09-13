import { randomBytes } from 'node:crypto'
import type { Request, RequestHandler, Response } from 'express'
import type { BffConfig } from '../config'
import { LOGIN_NONCE_COOKIE, serializeBffCookie } from '../cookies'
import { codeChallengeFor, generateCodeVerifier } from '../pkce'
import { mintState } from '../stateJwe'

// Short-lived TTL matching this codebase's existing precedent for "a human
// doing something interactively" timeouts (e.g. lambda-src's identify
// session, also 300s) -- generous enough for a federated login round-trip
// through an external IdP too.
export const LOGIN_STATE_TTL_SECONDS = 300

/** A cryptographically random, URL-safe single-use value -- see LOGIN_NONCE_COOKIE. */
function generateCsrfNonce(): string {
  return randomBytes(32).toString('base64url')
}

/**
 * GET /login -- the RP front-end's entry point into the login flow (see
 * doc/vendor-neutral-auth.md's Login sequence diagram). Mints PKCE material
 * and an encrypted `state` (bound to this browser via a matching short-lived
 * cookie -- see LOGIN_NONCE_COOKIE and routes/callback.ts), then 302s to the
 * auth service's own /authorize.
 */
export function loginRoute(config: BffConfig): RequestHandler {
  return async (req: Request, res: Response) => {
    const codeVerifier = generateCodeVerifier()
    const codeChallenge = codeChallengeFor(codeVerifier)
    const csrfNonce = generateCsrfNonce()
    const state = await mintState(
      { codeVerifier, issuedAt: Date.now(), csrfNonce },
      config.stateJweKey,
      LOGIN_STATE_TTL_SECONDS,
    )

    const authorizeUrl = new URL(`${config.authServiceBaseUrl}/api/v1/auth/authorize`)
    authorizeUrl.searchParams.set('client_id', config.rpClientId)
    authorizeUrl.searchParams.set('redirect_uri', config.rpRedirectUri)
    authorizeUrl.searchParams.set('response_type', 'code')
    authorizeUrl.searchParams.set('code_challenge', codeChallenge)
    authorizeUrl.searchParams.set('code_challenge_method', 'S256')
    authorizeUrl.searchParams.set('state', state)

    // SameSite=Lax, not the codebase's usual Strict: this cookie must survive
    // the top-level cross-site navigation the browser makes when the auth
    // service redirects back here to /login/callback -- from the browser's
    // perspective that request originates cross-site (from auth.<zone>), and
    // Strict cookies are not sent on a cross-site-initiated top-level GET,
    // which would make this cookie unreadable exactly when it's needed.
    res.setHeader(
      'Set-Cookie',
      serializeBffCookie(LOGIN_NONCE_COOKIE, csrfNonce, {
        maxAgeSeconds: LOGIN_STATE_TTL_SECONDS,
        sameSite: 'lax',
      }),
    )
    res.redirect(302, authorizeUrl.toString())
  }
}
