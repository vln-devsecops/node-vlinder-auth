import {
  AdminInitiateAuthCommand,
  type CognitoIdentityProviderClient,
  NotAuthorizedException,
  UserNotFoundException,
} from '@aws-sdk/client-cognito-identity-provider'
import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb'
import { hasPendingCode } from '../../shared/verificationCodes'
import { mintOneTimeToken } from '../oneTimeToken'
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

// The one-time token only needs to survive a same-browser redirect round trip
// (this Lambda -> the RP's front-end -> the RP's back-end's /token call), not
// an interactive session -- so its TTL is far shorter than
// IDENTIFY_SESSION_TTL_SECONDS's 300s, which has to tolerate a human reading
// and typing a password. 60s is generous for an automated redirect chain
// while keeping the window a leaked token (e.g. via a referrer header or
// browser history) stays valid for as small as practical.
export const ONE_TIME_TOKEN_TTL_SECONDS = 60

export interface PasswordParams {
  identifySession: string | undefined
  password: string
  cognitoClient: CognitoIdentityProviderClient
  clientId: string
  userPoolId: string
  signingKey: string
  ddbDocClient: DynamoDBDocumentClient
  verificationCodesTableName: string
  /** Key for encrypting the RP-handoff one-time token (see oneTimeToken.ts). Required only on the redirect path below. */
  oneTimeTokenKey: string
  now?: number
}

export type PasswordResult =
  | { status: 'authenticated'; tokens: AuthTokens; username: string }
  | { status: 'challenge'; challengeName: string; challengeSession: string | undefined }
  | { status: 'redirect'; location: string; username: string; tokens: AuthTokens }

export async function password(params: PasswordParams): Promise<PasswordResult> {
  const {
    identifySession,
    password,
    cognitoClient,
    clientId,
    userPoolId,
    signingKey,
    ddbDocClient,
    verificationCodesTableName,
    oneTimeTokenKey,
    now,
  } = params

  const claims = await verifySession(identifySession, signingKey, now)
  if (!claims || typeof claims.identifier !== 'string') {
    throw new InvalidSessionError('The identify session is missing or has expired.')
  }
  const username = claims.identifier

  // PreSignUp auto-confirms every account instantly (see
  // pre-sign-up/handler.ts), so Cognito's own UserNotConfirmedException --
  // today's implicit login-blocker for a never-verified user -- will never
  // fire again. A pending signup code is this app's replacement gate.
  const pendingVerification = await hasPendingCode({
    email: username,
    purpose: 'signup',
    ddbDocClient,
    tableName: verificationCodesTableName,
  })
  if (pendingVerification) {
    throw new UnverifiedAccountError('Please verify your email address before signing in.')
  }

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
  const tokens: AuthTokens = {
    accessToken: result.AccessToken,
    idToken: result.IdToken,
    refreshToken: result.RefreshToken,
    expiresAt: nowMs + (result.ExpiresIn ?? 3600) * 1000,
  }

  // If the identify-session carries both redirect_uri and code_challenge,
  // this login started at /authorize (see handlers/authorize.ts) and must
  // complete the RP handoff rather than return tokens directly to the SPA:
  // mint the one-time token embedding these tokens and send the browser back
  // to the RP. Their absence (today's existing direct-login case, e.g. the
  // admin panel) leaves this path completely unchanged.
  const redirectUri = claims.redirectUri
  const codeChallenge = claims.codeChallenge
  if (typeof redirectUri === 'string' && redirectUri && typeof codeChallenge === 'string' && codeChallenge) {
    const oneTimeToken = await mintOneTimeToken(
      { userId: username, redirectUri, codeChallenge, tokens },
      oneTimeTokenKey,
      ONE_TIME_TOKEN_TTL_SECONDS,
      now,
    )
    const state = claims.state
    // Built via the URL API, not string concatenation: a registered
    // redirect_uri is free to already carry its own query string (e.g.
    // `https://app.example.com/callback?tenant=acme`), and naively
    // appending `?token=...` would produce a second `?`, corrupting it
    // into a single malformed query string instead of adding a parameter.
    const location = new URL(redirectUri)
    location.searchParams.set('token', oneTimeToken)
    if (typeof state === 'string' && state) {
      location.searchParams.set('state', state)
    }
    return {
      status: 'redirect',
      username,
      location: location.toString(),
      // Also handed back (not just embedded in the one-time token) so the
      // handler can still set the same AS_SESSION_COOKIE it sets on the
      // direct-login path -- the SSO story (this browser has an AS session)
      // must hold regardless of which flow established it.
      tokens,
    }
  }

  return {
    status: 'authenticated',
    username,
    tokens,
  }
}

export class InvalidSessionError extends Error {}
export class AuthFailedError extends Error {}
export class UnverifiedAccountError extends Error {}
