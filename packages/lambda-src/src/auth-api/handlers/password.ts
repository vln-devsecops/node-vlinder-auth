import {
  AdminInitiateAuthCommand,
  type CognitoIdentityProviderClient,
  NotAuthorizedException,
  UserNotFoundException,
} from '@aws-sdk/client-cognito-identity-provider'
import { verifySession } from '../session'

// Step 2 of the identifier-first flow: the user submits their password. The
// identifier rides the signed identify-session cookie from /auth/identify, so
// it is never re-sent by the client. Verification runs server-side via
// ADMIN_USER_PASSWORD_AUTH (the browser never touches Cognito), and on success
// the vendor-neutral tokens are returned to the caller.
//
// TRANSITIONAL: tokens are returned in the response body so the same-origin SPA
// keeps its current sessionStorage + Bearer flow while it migrates off the
// direct /idp proxy. Moving to httpOnly-cookie session delivery (and an admin
// authorizer that reads the cookie) is a separately-sequenced step -- see
// doc/vendor-neutral-auth.md. This is no worse than today: the SPA already
// holds Cognito tokens in sessionStorage.

export interface AuthTokens {
  accessToken: string
  idToken: string
  refreshToken: string
  expiresAt: number
}

export interface PasswordParams {
  identifySession: string | undefined
  password: string
  cognitoClient: CognitoIdentityProviderClient
  clientId: string
  userPoolId: string
  signingKey: string
  now?: number
}

export type PasswordResult =
  | { status: 'authenticated'; tokens: AuthTokens; username: string }
  | { status: 'challenge'; challengeName: string; challengeSession: string | undefined }

export async function password(params: PasswordParams): Promise<PasswordResult> {
  const { identifySession, password, cognitoClient, clientId, userPoolId, signingKey, now } = params

  const claims = await verifySession(identifySession, signingKey, now)
  if (!claims || typeof claims.identifier !== 'string') {
    throw new InvalidSessionError('The identify session is missing or has expired.')
  }
  const username = claims.identifier

  let response
  try {
    response = await cognitoClient.send(
      new AdminInitiateAuthCommand({
        UserPoolId: userPoolId,
        ClientId: clientId,
        AuthFlow: 'ADMIN_USER_PASSWORD_AUTH',
        AuthParameters: { USERNAME: username, PASSWORD: password },
      }),
    )
  } catch (error) {
    // A wrong password and an unknown user are deliberately collapsed into one
    // opaque failure so the endpoint doesn't disclose which accounts exist.
    if (error instanceof NotAuthorizedException || error instanceof UserNotFoundException) {
      throw new AuthFailedError('Incorrect username or password.', { cause: error })
    }
    throw error
  }

  if (response.ChallengeName) {
    return {
      status: 'challenge',
      challengeName: response.ChallengeName,
      challengeSession: response.Session,
    }
  }

  const result = response.AuthenticationResult
  if (!result?.AccessToken || !result.IdToken || !result.RefreshToken) {
    throw new AuthFailedError('Authentication did not return the expected tokens.')
  }
  const nowMs = now ?? Date.now()
  return {
    status: 'authenticated',
    username,
    tokens: {
      accessToken: result.AccessToken,
      idToken: result.IdToken,
      refreshToken: result.RefreshToken,
      expiresAt: nowMs + (result.ExpiresIn ?? 3600) * 1000,
    },
  }
}

export class InvalidSessionError extends Error {}
export class AuthFailedError extends Error {}
