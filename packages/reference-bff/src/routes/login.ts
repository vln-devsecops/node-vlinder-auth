import type { Request, RequestHandler, Response } from 'express'
import type { BffConfig } from '../config'
import { codeChallengeFor, generateCodeVerifier } from '../pkce'
import { mintState } from '../stateJwe'

// Short-lived TTL matching this codebase's existing precedent for "a human
// doing something interactively" timeouts (e.g. lambda-src's identify
// session, also 300s) -- generous enough for a federated login round-trip
// through an external IdP too.
export const LOGIN_STATE_TTL_SECONDS = 300

/**
 * GET /login -- the RP front-end's entry point into the login flow (see
 * doc/vendor-neutral-auth.md's Login sequence diagram). Mints PKCE material
 * and an encrypted `state`, then 302s to the auth service's own /authorize.
 */
export function loginRoute(config: BffConfig): RequestHandler {
  return async (req: Request, res: Response) => {
    const codeVerifier = generateCodeVerifier()
    const codeChallenge = codeChallengeFor(codeVerifier)
    const state = await mintState(
      { codeVerifier, issuedAt: Date.now() },
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

    res.redirect(302, authorizeUrl.toString())
  }
}
