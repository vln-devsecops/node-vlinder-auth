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
  tenantId: string | undefined
  /** The active (default) roles whose privileges are unioned into the token. */
  roleIds: string[]
  privileges: string[]
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
 * Resolves a user's **login** privileges: the deduped union of the privileges
 * of their `default` (active-at-login) roles. Roles the user holds as
 * `elevated` are ignored here -- they contribute nothing until a sudo step-up
 * (future) resolves privileges including chosen elevated roles. This is the
 * boundary between "role" (an app-defined name) and "privilege" (what actually
 * lands in the token) -- callers only ever see privileges and the tenantId,
 * never the role names themselves.
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
    return { tenantId: undefined, roleIds: [], privileges: [] }
  }

  const activeRoleIds = assignments.roles
    .filter((role) => role.activation === 'default')
    .map((role) => role.roleId)

  const roleDefinitions = await Promise.all(
    activeRoleIds.map((roleId) =>
      getRoleDefinition({ roleId, tableName: rolesTableName, ddbDocClient }),
    ),
  )

  const privileges = [
    ...new Set(
      roleDefinitions.flatMap((role) => bindRolePrivileges(role, assignments.tenantId)),
    ),
  ]

  return {
    tenantId: assignments.tenantId,
    roleIds: activeRoleIds,
    privileges,
  }
}
