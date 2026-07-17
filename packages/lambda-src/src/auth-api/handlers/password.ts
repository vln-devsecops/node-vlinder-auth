import {
  AdminInitiateAuthCommand,
  type CognitoIdentityProviderClient,
  NotAuthorizedException,
  UserNotFoundException,
} from '@aws-sdk/client-cognito-identity-provider'
import { signSession, verifySession } from '../session'

// Step 2 of the identifier-first flow: the user submits their password. The
// identifier rides the signed identify-session cookie from /auth/identify, so
// it is never re-sent by the client. Verification runs server-side via
// ADMIN_USER_PASSWORD_AUTH (the browser never touches Cognito), and on success
// we establish an "AS session" -- proof that this browser is authenticated at
// the auth component.
//
// Delivery of the resulting Cognito tokens to a consuming app (the BFF handoff)
// lands in a later increment; for now a successful password sign-in just
// establishes the AS session and nothing consumes it yet.

export const AS_SESSION_TTL_SECONDS = 3600

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
  | { status: 'authenticated'; asSession: string; username: string }
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

  const asSession = await signSession(
    { username, typ: 'as' },
    signingKey,
    AS_SESSION_TTL_SECONDS,
    now,
  )
  return { status: 'authenticated', asSession, username }
}

export class InvalidSessionError extends Error {}
export class AuthFailedError extends Error {}
