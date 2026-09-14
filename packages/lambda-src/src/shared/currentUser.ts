import {
  GetUserCommand,
  NotAuthorizedException,
  type CognitoIdentityProviderClient,
} from '@aws-sdk/client-cognito-identity-provider'

// Resolving "who is calling" from the raw Cognito access token carried in
// AS_SESSION_COOKIE (see auth-api/session.ts's doc comment on that cookie).
// auth_api's own API Gateway authorizer is a CUSTOM origin-check-only Lambda
// authorizer (unlike the admin API's JWT authorizer), so this Lambda has to
// validate the token itself. GetUserCommand -- the *non-Admin*,
// self-describing Cognito call -- does both jobs in one round trip with no
// admin credentials needed: it rejects an invalid/expired/revoked token, and
// it returns the caller's own attributes on success.

export interface CurrentUser {
  /**
   * Cognito's `sub` claim -- the same identifier `user_role_assignments` is
   * keyed by (see pre-token-generation/handler.ts, which reads
   * `event.request.userAttributes.sub` for the exact same purpose:
   * resolving role assignments). Deliberately read from GetUserCommand's
   * `UserAttributes` list rather than trusted from its top-level `Username`
   * field: in this user pool, sign-in/sign-up address Cognito by email (see
   * handlers/password.ts, handlers/registration.ts), and while `Username`
   * happens to coincide with `sub` under this pool's current configuration,
   * `sub` is the one identifier every other caller of
   * resolvePrivilegesForUser already treats as canonical. Matching that
   * exactly, rather than relying on a coincidence, is what keeps this
   * lookup from silently resolving the wrong (or no) role assignments for
   * every caller.
   */
  userId: string
}

export class InvalidAccessTokenError extends Error {}

export async function resolveCurrentUser(
  accessToken: string,
  cognitoClient: CognitoIdentityProviderClient,
): Promise<CurrentUser> {
  let response
  try {
    response = await cognitoClient.send(new GetUserCommand({ AccessToken: accessToken }))
  } catch (error) {
    // Mirrors handlers/password.ts and handlers/refresh.ts: narrow to the
    // specific Cognito exception class an invalid/expired/revoked token
    // actually throws, and rethrow as this module's own error rather than
    // leaking the Cognito exception type to callers.
    if (error instanceof NotAuthorizedException) {
      throw new InvalidAccessTokenError('The access token is missing, invalid, or has expired.', {
        cause: error,
      })
    }
    throw error
  }

  const sub = response.UserAttributes?.find((attr) => attr.Name === 'sub')?.Value
  if (!sub) {
    throw new InvalidAccessTokenError('Cognito did not return a sub attribute for this access token.')
  }

  return { userId: sub }
}
