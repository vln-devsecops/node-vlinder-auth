import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb'
import { parsePrivilege } from './privilegeMatch'
import { getRoleDefinition, resolveUserRoleAssignments } from './roles'
import type { RoleDefinition } from './types'

export interface ResolvePrivilegesForUserParams {
  userId: string
  roleAssignmentsTableName: string
  rolesTableName: string
  ddbDocClient: DynamoDBDocumentClient
}

export interface ResolvedPrivileges {
  /** Every tenant the user holds a role assignment in -- the `tenants` claim. */
  tenants: string[]
  /** The active (default) roles whose privileges are unioned into the access token. */
  roleIds: string[]
  /**
   * Held-plus-active: the deduped union of privileges from *every* role the
   * user holds, `default` and `elevated` alike. Lands in the ID token only --
   * it describes the account, and an ID token is not a bearer credential a
   * resource server accepts, so surfacing a held-but-inactive privilege there
   * carries no access risk. Superset of `accessTokenPrivileges`.
   */
  idTokenPrivileges: string[]
  /**
   * Active-only: the deduped union of privileges from just the `default`
   * (active-at-login) roles. Lands in the access token -- the credential a
   * resource server actually trusts -- so an `elevated` role a user merely
   * holds must never appear here until a future sudo step-up widens it in.
   */
  accessTokenPrivileges: string[]
}

/**
 * A `tenantScope: 'tenant'` role's catalog entry is written in
 * tenant-irrelevant form (e.g. `read:users`, reusable across every tenant it
 * is assigned in) -- the concrete tenant is bound here, at resolution time,
 * from the caller's own resolved assignment, overriding whatever tenant
 * segment the catalog entry carries. A `tenantScope: 'global'` role's
 * privileges (typically already tenant-wildcard, e.g. `write:*:users`) pass
 * through untouched, since they aren't meant to be confined to one tenant.
 *
 * `tenantScope` is per-*role*, not per-privilege: every privilege on a
 * `tenant`-scoped role is bound, with no way for one of its privileges to
 * opt out and stay universal. A role that needs to grant both a
 * tenant-confined privilege and a genuinely tenant-agnostic one should be
 * split into two catalog entries -- one `tenant`-scoped, one `global`-scoped
 * -- and assigned together; `resolvePrivilegesForUser` already unions
 * privileges across every role a user holds.
 */
function bindRolePrivileges(role: RoleDefinition | undefined, tenantId: string): string[] {
  if (!role) {
    return []
  }
  if (role.tenantScope === 'global') {
    return role.privileges
  }
  return role.privileges.map((privilege) => {
    const parsed = parsePrivilege(privilege)
    return parsed === undefined ? privilege : `${parsed.verb}:${tenantId}:${parsed.resource}`
  })
}

/**
 * Resolves a user's privileges across every tenant they hold an assignment
 * in (a user can be logged in on more than one tenant at once), as **two**
 * distinct sets rather than one: the ID token gets the held-plus-active
 * union (every role the user holds, `default` and `elevated` alike, bound
 * to its tenant); the access token gets only the active-only union (just
 * the `default`, active-at-login roles) -- today's pre-split behavior,
 * still exactly what the access token is allowed to carry. An `elevated`
 * role contributes nothing to the access token until a sudo step-up
 * (future) widens it in; it is not "ignored" any more, since the ID token
 * now needs to see it too, as the account-description surface, without
 * granting it as a bearer credential.
 *
 * Both sets are derived from a **single** role-definition fetch: every role
 * the user holds (the superset that would make up the ID token's set) is
 * looked up once, in one `Promise.all`, and the access-token set is filtered
 * down from that same fetch by each entry's original activation, rather than
 * fetching definitions twice. This runs inside the synchronous,
 * timeout-sensitive Cognito pre-token-generation trigger, so latency should
 * depend on the slowest single lookup, not on the number of tenants/roles
 * the user happens to hold, let alone doubling that by resolving twice.
 * This is the boundary between "role" (an app-defined name) and "privilege"
 * (what actually lands in a token) -- callers only ever see privileges and
 * the tenant list, never the role names themselves.
 */
export async function resolvePrivilegesForUser(
  params: ResolvePrivilegesForUserParams,
): Promise<ResolvedPrivileges> {
  const { userId, roleAssignmentsTableName, rolesTableName, ddbDocClient } = params

  const assignments = await resolveUserRoleAssignments({
    userId,
    tableName: roleAssignmentsTableName,
    ddbDocClient,
  })

  if (!assignments) {
    return { tenants: [], roleIds: [], idTokenPrivileges: [], accessTokenPrivileges: [] }
  }

  // Every (tenant, role) pair the user holds, default and elevated alike --
  // the superset needed for the ID token's set -- flattened across every
  // tenant so every getRoleDefinition lookup fires in a single Promise.all
  // instead of one round per tenant or per token type.
  const heldAssignments = assignments.tenants.flatMap(({ tenantId, roles }) =>
    roles.map((role) => ({ tenantId, roleId: role.roleId, activation: role.activation })),
  )

  const roleDefinitions = await Promise.all(
    heldAssignments.map(({ roleId }) =>
      getRoleDefinition({ roleId, tableName: rolesTableName, ddbDocClient }),
    ),
  )

  const idTokenPrivileges = heldAssignments.flatMap(({ tenantId }, index) =>
    bindRolePrivileges(roleDefinitions[index], tenantId),
  )

  const activeAssignmentIndexes = heldAssignments
    .map((assignment, index) => ({ assignment, index }))
    .filter(({ assignment }) => assignment.activation === 'default')

  const accessTokenPrivileges = activeAssignmentIndexes.flatMap(({ assignment, index }) =>
    bindRolePrivileges(roleDefinitions[index], assignment.tenantId),
  )

  return {
    tenants: assignments.tenants.map((tenant) => tenant.tenantId),
    roleIds: activeAssignmentIndexes.map(({ assignment }) => assignment.roleId),
    idTokenPrivileges: [...new Set(idTokenPrivileges)],
    accessTokenPrivileges: [...new Set(accessTokenPrivileges)],
  }
}
