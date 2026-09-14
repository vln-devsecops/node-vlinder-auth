import type { CognitoIdentityProviderClient } from '@aws-sdk/client-cognito-identity-provider'
import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb'
import { resolveCurrentUser } from '../../shared/currentUser'
import { resolvePrivilegesForUser } from '../../shared/privileges'
import { getUserProfile, type UserProfile } from '../../shared/userProfile'

// GET /api/v1/auth/whoami (see doc/vendor-neutral-auth.md's whoami section):
// re-derives the caller's privileges fresh from user_role_assignments --
// never from the caller's own token, which is the whole point, since it must
// reflect grants changed server-side after the token was minted -- plus
// profile attributes (avatar, display name, preferences) that have no
// business in a token at all.

export interface WhoamiParams {
  /** From AS_SESSION_COOKIE (see session.ts); may be absent. */
  accessToken: string | undefined
  cognitoClient: CognitoIdentityProviderClient
  roleAssignmentsTableName: string
  rolesTableName: string
  tenantsTableName: string
  authAppTenantId: string
  ddbDocClient: DynamoDBDocumentClient
}

export interface WhoamiResult {
  active: string[]
  held: string[]
  profile: UserProfile
}

export class MissingAccessTokenError extends Error {}

export async function whoami(params: WhoamiParams): Promise<WhoamiResult> {
  const {
    accessToken,
    cognitoClient,
    roleAssignmentsTableName,
    rolesTableName,
    tenantsTableName,
    authAppTenantId,
    ddbDocClient,
  } = params

  if (!accessToken) {
    throw new MissingAccessTokenError('No AS session cookie was presented.')
  }

  // Propagates InvalidAccessTokenError if Cognito rejects the token.
  const { userId } = await resolveCurrentUser(accessToken, cognitoClient)

  const [resolved, profile] = await Promise.all([
    resolvePrivilegesForUser({
      userId,
      roleAssignmentsTableName,
      rolesTableName,
      ddbDocClient,
    }),
    getUserProfile({ userId, authAppTenantId, tenantsTableName, ddbDocClient }),
  ])

  const active = resolved.accessTokenPrivileges
  // `held` deliberately means "what you could step up into" -- the set
  // difference of the held-plus-active superset minus what's already active
  // -- not the raw idTokenPrivileges superset, which would make every active
  // privilege also (redundantly, confusingly) appear in `held`.
  const activeSet = new Set(active)
  const held = resolved.idTokenPrivileges.filter((privilege) => !activeSet.has(privilege))

  return { active, held, profile }
}
