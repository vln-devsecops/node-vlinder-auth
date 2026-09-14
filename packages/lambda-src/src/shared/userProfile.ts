import { GetCommand, type DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb'

// Global (not tenant-scoped) user-profile attributes surfaced by
// GET /api/v1/auth/whoami -- avatar, display name, preferences, and anything
// else that never belongs in a token (see doc/vendor-neutral-auth.md's
// whoami section). Stored in the same multi-purpose `tenants` table as
// tenant profiles, client registry entries, and domain->IdP pins (see this
// table's other sort-key prefixes: `PROFILE`, `CLIENT#<id>`, `DOMAIN#<domain>`)
// rather than a parallel store, under the reserved `authAppTenantId` partition
// ("auth" -- the auth application's own tenant, not any adopter tenant) since
// a user profile belongs to the auth service itself, not to any one tenant.
//
// Tenant-scoped profile overrides/inheritance were raised as an open question
// in PR #103's review and explicitly deferred by the project owner: this is a
// single global profile only, with no per-tenant lookup or override.
//
// Nothing writes this record yet -- no admin UI or API exists to edit a
// profile. A brand-new user simply has no row here, which is not an error:
// getUserProfile returns `{}` for that case.

export interface UserProfile {
  avatarUrl?: string
  displayName?: string
  preferences?: Record<string, unknown>
}

export interface GetUserProfileParams {
  userId: string
  authAppTenantId: string
  tenantsTableName: string
  ddbDocClient: DynamoDBDocumentClient
}

/** Builds the `tenants` table sort key for a user's global profile row. */
function userProfileSortKey(userId: string): string {
  return `USERPROFILE#${userId}`
}

/**
 * Reads a user's global profile, if one exists. Returns `{}` -- not an
 * error, not null -- when no row has ever been written for this user, since
 * nothing writes this record yet and a brand-new user is expected to have
 * none.
 */
export async function getUserProfile(params: GetUserProfileParams): Promise<UserProfile> {
  const { userId, authAppTenantId, tenantsTableName, ddbDocClient } = params

  const result = await ddbDocClient.send(
    new GetCommand({
      TableName: tenantsTableName,
      Key: { tenantId: authAppTenantId, sk: userProfileSortKey(userId) },
    }),
  )

  const item = result.Item
  if (!item) {
    return {}
  }

  const profile: UserProfile = {}
  if (typeof item.avatarUrl === 'string') {
    profile.avatarUrl = item.avatarUrl
  }
  if (typeof item.displayName === 'string') {
    profile.displayName = item.displayName
  }
  if (item.preferences && typeof item.preferences === 'object') {
    profile.preferences = item.preferences as Record<string, unknown>
  }
  return profile
}
