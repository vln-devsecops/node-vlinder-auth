import { GetCommand, QueryCommand, type DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb'
import type { RoleAssignment, RoleDefinition } from './types'

export interface ResolveUserRoleAssignmentParams {
  userId: string
  tableName: string
  ddbDocClient: DynamoDBDocumentClient
}

/**
 * Looks up a user's role assignment. v1 assumes a user is active in exactly
 * one tenant at a time (assigned at signup by post-confirmation); if the
 * partition key ever holds more than one item for a user, only the first
 * (lowest tenantId) is used. Supporting a user active across multiple
 * tenants simultaneously is a documented future extension, not v1 scope.
 */
export async function resolveUserRoleAssignment(
  params: ResolveUserRoleAssignmentParams,
): Promise<RoleAssignment | undefined> {
  const { userId, tableName, ddbDocClient } = params

  const result = await ddbDocClient.send(
    new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: 'userId = :u',
      ExpressionAttributeValues: { ':u': userId },
      Limit: 1,
    }),
  )

  const item = result.Items?.[0]
  if (!item) {
    return undefined
  }

  return {
    userId: item.userId as string,
    tenantId: item.tenantId as string,
    roleId: item.roleId as string,
  }
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
