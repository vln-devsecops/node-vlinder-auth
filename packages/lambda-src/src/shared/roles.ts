import { GetCommand, QueryCommand, type DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb'
import type { RoleDefinition, UserRoleAssignments } from './types'

export interface ResolveUserRoleAssignmentsParams {
  userId: string
  tableName: string
  ddbDocClient: DynamoDBDocumentClient
}

/**
 * Looks up all of a user's role assignments. A user may hold several roles at
 * once; every one is returned so callers can union their privileges. v1 assumes
 * a user is active in exactly one tenant (assigned at signup by
 * post-confirmation); if the partition ever spans tenants, the first tenant
 * seen anchors the result and only its roles are returned. Supporting a user
 * active across multiple tenants simultaneously is a documented future
 * extension, not v1 scope.
 */
export async function resolveUserRoleAssignments(
  params: ResolveUserRoleAssignmentsParams,
): Promise<UserRoleAssignments | undefined> {
  const { userId, tableName, ddbDocClient } = params

  const result = await ddbDocClient.send(
    new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: 'userId = :u',
      ExpressionAttributeValues: { ':u': userId },
    }),
  )

  const items = result.Items ?? []
  if (items.length === 0) {
    return undefined
  }

  const tenantId = items[0].tenantId as string
  const roleIds = items
    .filter((item) => item.tenantId === tenantId)
    .map((item) => item.roleId as string)

  return { userId, tenantId, roleIds }
}

export interface GetRoleDefinitionParams {
  roleId: string
  tableName: string
  ddbDocClient: DynamoDBDocumentClient
}

/** Looks up a role's privilege list and scope from the Terraform-seeded role catalog. */
export async function getRoleDefinition(
  params: GetRoleDefinitionParams,
): Promise<RoleDefinition | undefined> {
  const { roleId, tableName, ddbDocClient } = params

  const result = await ddbDocClient.send(
    new GetCommand({
      TableName: tableName,
      Key: { roleId },
    }),
  )

  if (!result.Item) {
    return undefined
  }

  return {
    roleId: result.Item.roleId as string,
    privileges: result.Item.privileges as string[],
    tenantScope: result.Item.tenantScope as RoleDefinition['tenantScope'],
  }
}
