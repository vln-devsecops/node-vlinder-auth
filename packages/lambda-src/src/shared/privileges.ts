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
  roleIds: string[]
  privileges: string[]
}

/**
 * Resolves all of a user's roles and expands them to a single deduped privilege
 * list -- the **union** across every role they hold. This is the boundary
 * between "role" (an app-defined name) and "privilege" (what actually lands in
 * the token) -- callers only ever see privileges and the tenantId, never the
 * role names themselves.
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

  const roleDefinitions = await Promise.all(
    assignments.roleIds.map((roleId) =>
      getRoleDefinition({ roleId, tableName: rolesTableName, ddbDocClient }),
    ),
  )

  const privileges = [
    ...new Set(roleDefinitions.flatMap((role) => role?.privileges ?? [])),
  ]

  return {
    tenantId: assignments.tenantId,
    roleIds: assignments.roleIds,
    privileges,
  }
}
