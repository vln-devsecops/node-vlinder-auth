import { DeleteCommand, QueryCommand, type DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb'
import { assertTenantAccess, type CallerContext } from '../authz'
import { NotFoundError } from './getUser'

const PRIVILEGE_FAMILY = 'admin:users:write'

export interface RevokeRoleParams {
  caller: CallerContext
  targetUserId: string
  ddbDocClient: DynamoDBDocumentClient
  roleAssignmentsTableName: string
}

/**
 * Removes a user's role assignment entirely, leaving them with zero
 * privileges until reassigned -- the pre-token-generation trigger treats a
 * missing assignment as "no permissions/tenantId claims", so this is a
 * complete revocation rather than a fallback to a default role.
 */
export async function revokeRole(params: RevokeRoleParams): Promise<void> {
  const { caller, targetUserId, ddbDocClient, roleAssignmentsTableName } = params

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
      Key: { userId: targetUserId, tenantId: assignment.tenantId },
    }),
  )
}
