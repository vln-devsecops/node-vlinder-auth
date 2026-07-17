import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb'
import { getRoleDefinition, resolveUserRoleAssignments } from './roles'

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

  const privileges = [...new Set(roleDefinitions.flatMap((role) => role?.privileges ?? []))]

  return {
    tenantId: assignments.tenantId,
    roleIds: activeRoleIds,
    privileges,
  }
}
