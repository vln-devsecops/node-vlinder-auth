import { PutCommand, QueryCommand, type DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb'
import { assertTenantAccess, type CallerContext } from '../authz'
import { NotFoundError } from './getUser'

const PRIVILEGE_FAMILY = 'admin:users:write'

export interface AssignRoleParams {
  caller: CallerContext
  targetUserId: string
  roleId: string
  ddbDocClient: DynamoDBDocumentClient
  roleAssignmentsTableName: string
}

/**
 * Overwrites a user's role within their existing tenant. This changes which
 * role a user holds, not which tenant they belong to -- a user's tenant is
 * fixed at signup (see lambda-src/post-confirmation), so this looks up the
 * existing assignment to authorize against its tenant, then replaces only
 * the roleId.
 */
export async function assignRole(params: AssignRoleParams): Promise<void> {
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
    new PutCommand({
      TableName: roleAssignmentsTableName,
      Item: { userId: targetUserId, tenantId: assignment.tenantId, roleId },
    }),
  )
}
