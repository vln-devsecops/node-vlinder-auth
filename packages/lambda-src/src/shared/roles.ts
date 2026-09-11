import { GetCommand, QueryCommand, type DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb'
import type { AssignedRole, RoleActivation, RoleDefinition, UserRoleAssignments } from './types'

export interface ResolveUserRoleAssignmentsParams {
  userId: string
  tableName: string
  ddbDocClient: DynamoDBDocumentClient
}

/**
 * Looks up all of a user's role assignments, grouped by tenant. A user may
 * hold several roles per tenant, and may hold assignments in more than one
 * tenant at once -- a user logged in on more than one tenant simultaneously
 * -- so every row is returned, grouped, rather than anchored to a single
 * tenant.
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

  const rolesByTenant = new Map<string, AssignedRole[]>()
  for (const item of items) {
    const tenantId = item.tenantId as string
    const role: AssignedRole = {
      roleId: item.roleId as string,
      // Older rows written before activation existed default to a login role.
      activation: (item.activation ?? 'default') as RoleActivation,
    }
    const roles = rolesByTenant.get(tenantId)
    if (roles) {
      roles.push(role)
    } else {
      rolesByTenant.set(tenantId, [role])
    }
  }

  const tenants = [...rolesByTenant.entries()].map(([tenantId, roles]) => ({ tenantId, roles }))

  return { userId, tenants }
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
