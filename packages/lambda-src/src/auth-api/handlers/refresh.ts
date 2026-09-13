import {
  AdminInitiateAuthCommand,
  type CognitoIdentityProviderClient,
  NotAuthorizedException,
} from '@aws-sdk/client-cognito-identity-provider'
import { decayElevatedGrants, mintRefreshToken, type RefreshTokenKey, verifyRefreshToken } from '../refreshToken'

// POST /api/v1/auth/refresh (see doc/vendor-neutral-auth.md's Layer 1 and
// Refresh sections): the BFF forwards its opaque refresh-token JWE
// unmodified, this decrypts it, exchanges the underlying raw Cognito refresh
// token via REFRESH_TOKEN_AUTH, and returns a fresh access/ID token plus a
// newly-rotated JWE wrapping whatever refresh token Cognito hands back. The
// BFF never decrypts anything itself -- see refreshToken.ts.

export interface RefreshParams {
  refreshToken: string // the incoming JWE
  cognitoClient: CognitoIdentityProviderClient
  clientId: string
  userPoolId: string
  /**
   * Candidate keys for verifying the incoming JWE, current first (see
   * shared/secrets.ts's `getSecretVersions`). More than one matters here for
   * the same reason as /token's one-time-token verification: a JWE minted
   * with what was AWSCURRENT a moment ago must still verify just after a
   * rotation.
   */
  verifyKeys: RefreshTokenKey[]
  /**
   * Key for minting the rotated replacement JWE. Always the current Secrets
   * Manager version -- minting never needs a "previous" candidate, same
   * reasoning as handlers/token.ts's refreshTokenKey.
   */
  mintKey: RefreshTokenKey
  refreshTokenTtlSeconds: number
  now?: number
}

export interface RefreshResult {
  accessToken: string
  idToken: string
  refreshToken: string // newly rotated JWE
  expiresAt: number
}

export class InvalidRefreshTokenError extends Error {}

export async function refresh(params: RefreshParams): Promise<RefreshResult> {
  const { refreshToken, cognitoClient, clientId, userPoolId, verifyKeys, mintKey, refreshTokenTtlSeconds, now } =
    params

  const payload = await verifyRefreshToken(refreshToken, verifyKeys, now)
  if (!payload) {
    throw new InvalidRefreshTokenError(
      'The refresh token is missing, invalid, tampered with, or has expired.',
    )
  }

  const liveGrants = decayElevatedGrants(payload.elevatedGrants, now)

  let response
  try {
    response = await cognitoClient.send(
      new AdminInitiateAuthCommand({
        UserPoolId: userPoolId,
        ClientId: clientId,
        AuthFlow: 'REFRESH_TOKEN_AUTH',
        AuthParameters: { REFRESH_TOKEN: payload.cognitoRefreshToken },
      }),
    )
  } catch (error) {
    // Expired, revoked, or reuse-detected-after-rotation -- the caller must
    // not be able to distinguish "our JWE was bad" from "Cognito rejected
    // the underlying token"; both are just "log in again".
    if (error instanceof NotAuthorizedException) {
      throw new InvalidRefreshTokenError(
        'The refresh token is missing, invalid, tampered with, or has expired.',
        { cause: error },
      )
    }
    throw error
  }

  const result = response.AuthenticationResult
  if (!result?.AccessToken || !result.IdToken) {
    throw new Error('Cognito did not return the expected AccessToken/IdToken from REFRESH_TOKEN_AUTH.')
  }
  if (!result.RefreshToken) {
    // Once Cognito's native refresh-token-rotation feature is enabled on the
    // app client (coordinated separately via terraform-modules), Cognito
    // always returns a new RefreshToken on every REFRESH_TOKEN_AUTH call. A
    // missing one here is a deploy-time misconfiguration, not a user-facing
    // auth failure -- surface it loudly rather than silently reusing the old
    // (possibly-already-invalidated) refresh token.
    throw new Error(
      'Cognito did not return a rotated refresh token; check that refresh token rotation is enabled on the app client.',
    )
  }

  const nowMs = now ?? Date.now()
  const rotatedRefreshToken = await mintRefreshToken(
    { cognitoRefreshToken: result.RefreshToken, elevatedGrants: liveGrants },
    mintKey,
    refreshTokenTtlSeconds,
    nowMs,
  )

  return {
    accessToken: result.AccessToken,
    idToken: result.IdToken,
    refreshToken: rotatedRefreshToken,
    expiresAt: nowMs + (result.ExpiresIn ?? 3600) * 1000,
  }
}
