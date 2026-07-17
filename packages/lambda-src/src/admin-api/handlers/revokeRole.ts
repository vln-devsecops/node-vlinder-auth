import { DeleteCommand, QueryCommand, type DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb'
import { assertTenantAccess, type CallerContext } from '../authz'
import { tenantRoleKey } from '../../shared/roleAssignments'
import { NotFoundError } from './getUser'

const PRIVILEGE_FAMILY = 'admin:users:write'

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

  const result = await ddbDocClient.send(
    new QueryCommand({
      TableName: roleAssignmentsTableName,
      KeyConditionExpression: 'userId = :u',
      ExpressionAttributeValues: { ':u': targetUserId },
      Limit: 1,
    }),
  )

  const assignment = result.Items?.[0] as { tenantId: string } | undefined
  if (!assignment) {
    throw new NotFoundError(`No user found with id ${targetUserId}`)
  }

  assertTenantAccess(caller, PRIVILEGE_FAMILY, assignment.tenantId)

  await ddbDocClient.send(
    new DeleteCommand({
      TableName: roleAssignmentsTableName,
      Key: { userId: targetUserId, tenantRole: tenantRoleKey(assignment.tenantId, roleId) },
    }),
  )
}
