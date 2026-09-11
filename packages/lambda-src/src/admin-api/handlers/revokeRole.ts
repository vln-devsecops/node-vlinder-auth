import { DeleteCommand, type DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb'
import { assertTenantAccess, type CallerContext } from '../authz'
import { ADMIN_USERS_WRITE } from '../privileges'
import { loadTargetUsersSoleTenant } from '../targetTenant'
import { tenantRoleKey } from '../../shared/roleAssignments'

export interface RevokeRoleParams {
  caller: CallerContext
  targetUserId: string
  roleId: string
  ddbDocClient: DynamoDBDocumentClient
  roleAssignmentsTableName: string
}

/**
 * Removes one specific role from a user, leaving their other roles intact. The
 * user's effective privileges become the union of whatever roles remain (or
 * zero privileges if this was their last -- the pre-token-generation trigger
 * treats no assignments as "no permissions/tenantId claims"). Deleting a role
 * the user does not hold is a harmless no-op.
 */
export async function revokeRole(params: RevokeRoleParams): Promise<void> {
  const { caller, targetUserId, roleId, ddbDocClient, roleAssignmentsTableName } = params

  const { tenantId } = await loadTargetUsersSoleTenant(
    ddbDocClient,
    roleAssignmentsTableName,
    targetUserId,
  )

  assertTenantAccess(caller, ADMIN_USERS_WRITE, tenantId)

  await ddbDocClient.send(
    new DeleteCommand({
      TableName: roleAssignmentsTableName,
      Key: { userId: targetUserId, tenantRole: tenantRoleKey(tenantId, roleId) },
    }),
  )
}
