import { verifyCodeChallenge } from '../pkce'
import { type OneTimeTokenKey, verifyOneTimeToken } from '../oneTimeToken'
import { mintRefreshToken, type RefreshTokenKey } from '../refreshToken'

// The RP handoff's final step (see doc/vendor-neutral-auth.md's "Login"
// sequence diagram): the RP's back-end exchanges the one-time token it
// received (via its front-end) for the real Cognito tokens, proving it holds
// the code_verifier that matches the code_challenge embedded in the one-time
// token. Because the one-time token already carries the AuthenticationResult
// obtained back at /password (see handlers/password.ts and oneTimeToken.ts),
// this never calls Cognito itself -- it only decrypts and checks.

export interface TokenExchangeParams {
  token: string
  codeVerifier: string
  /**
   * Candidate keys to try when decrypting the one-time token, in order --
   * in practice the current Secrets Manager version followed by the
   * previous one, if it exists (see handler.ts). More than one candidate is
   * needed here (but never for minting in password.ts) to cover a token
   * minted right before a key rotation and exchanged just after: its 60s TTL
   * makes this a narrow window, but a real one given Secrets Manager's
   * immediate-overwrite rotation.
   */
  keys: OneTimeTokenKey[]
  /**
   * Key for wrapping the raw Cognito refresh token before it leaves this
   * Lambda in the response body (see doc/vendor-neutral-auth.md's Token
   * model). Always the current Secrets Manager version -- minting a new
   * wrapper around a token that was only just obtained has no
   * rotation-boundary case, same reasoning as the one-time-token key's own
   * minting side (see password.ts's oneTimeTokenKey doc comment).
   */
  refreshTokenKey: RefreshTokenKey
  refreshTokenTtlSeconds: number
  now?: number
}

export type TokenExchangeResult = {
  accessToken: string
  idToken: string
  refreshToken: string
  expiresAt: number
}

export async function exchangeToken(params: TokenExchangeParams): Promise<TokenExchangeResult> {
  const { token, codeVerifier, keys, refreshTokenKey, refreshTokenTtlSeconds, now } = params

  const payload = await verifyOneTimeToken(token, keys, now)
  if (!payload) {
    throw new InvalidOneTimeTokenError('The one-time token is missing, invalid, tampered with, or has expired.')
  }

  if (!verifyCodeChallenge(codeVerifier, payload.codeChallenge)) {
    // Deliberately its own error class internally (useful for logging/metrics)
    // but mapped to the same generic 400 as InvalidOneTimeTokenError at the
    // HTTP layer (see handler.ts's errorResponse) -- the response must not let
    // a caller distinguish "token invalid" from "PKCE mismatch".
    throw new PkceMismatchError('The code_verifier does not match the code_challenge.')
  }

  // Wrap the raw Cognito refresh token in this Lambda's own JWE before it
  // ever leaves in a response body -- the BFF holding it must never be able
  // to read or replay it directly against Cognito (see doc/vendor-neutral-auth.md's
  // Token model and Refresh sections). elevatedGrants starts empty: this is
  // a brand-new login, so there is nothing to carry forward.
  const wrappedRefreshToken = await mintRefreshToken(
    { cognitoRefreshToken: payload.tokens.refreshToken, elevatedGrants: [] },
    refreshTokenKey,
    refreshTokenTtlSeconds,
    now,
  )

  return { ...payload.tokens, refreshToken: wrappedRefreshToken }
}

export class InvalidOneTimeTokenError extends Error {}
export class PkceMismatchError extends Error {}
