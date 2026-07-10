import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb'
import { getRoleDefinition, resolveUserRoleAssignment } from './roles'

export interface ResolvePrivilegesForUserParams {
  userId: string
  roleAssignmentsTableName: string
  rolesTableName: string
  ddbDocClient: DynamoDBDocumentClient
}

export interface ResolvedPrivileges {
  tenantId: string | undefined
  roleId: string | undefined
  privileges: string[]
}

/**
 * Resolves a user's role assignment and expands it to a deduped privilege
 * list. This is the boundary between "role" (an app-defined name) and
 * "privilege" (what actually lands in the token) -- callers only ever see
 * privileges and the tenantId, never the role name itself.
 */
export async function resolvePrivilegesForUser(
  params: ResolvePrivilegesForUserParams,
): Promise<ResolvedPrivileges> {
  const { userId, roleAssignmentsTableName, rolesTableName, ddbDocClient } = params

  const assignment = await resolveUserRoleAssignment({
    userId,
    tableName: roleAssignmentsTableName,
    ddbDocClient,
  })

  if (!assignment) {
    return { tenantId: undefined, roleId: undefined, privileges: [] }
  }

  const role = await getRoleDefinition({
    roleId: assignment.roleId,
    tableName: rolesTableName,
    ddbDocClient,
  })

  return {
    tenantId: assignment.tenantId,
    roleId: assignment.roleId,
    privileges: role ? [...new Set(role.privileges)] : [],
  }
}
