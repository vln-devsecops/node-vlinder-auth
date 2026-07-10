import {
  AdminGetUserCommand,
  type CognitoIdentityProviderClient,
} from '@aws-sdk/client-cognito-identity-provider'
import { QueryCommand, ScanCommand, type DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb'
import { resolveAccessScope, ForbiddenError, type CallerContext } from '../authz'

const PRIVILEGE_FAMILY = 'admin:users:read'

export interface AdminUserSummary {
  userId: string
  tenantId: string
  roleId: string
  email?: string
  enabled?: boolean
  userStatus?: string
}

export interface ListUsersParams {
  caller: CallerContext
  ddbDocClient: DynamoDBDocumentClient
  cognitoClient: CognitoIdentityProviderClient
  roleAssignmentsTableName: string
  userPoolId: string
}

export interface ListUsersResult {
  users: AdminUserSummary[]
}

/**
 * Lists users the caller is permitted to see: their own tenant only for an
 * "own"-scoped privilege, or every tenant for a "*"-scoped (super-admin)
 * privilege -- the same mechanism as the token's privilege check, just
 * applied to a listing instead of a single target.
 */
export async function listUsers(params: ListUsersParams): Promise<ListUsersResult> {
  const { caller, ddbDocClient, cognitoClient, roleAssignmentsTableName, userPoolId } = params

  const scope = resolveAccessScope(caller, PRIVILEGE_FAMILY)
  if (scope === 'none') {
    throw new ForbiddenError(`Missing privilege ${PRIVILEGE_FAMILY}:(own|*)`)
  }
  if (scope === 'own' && !caller.tenantId) {
    throw new ForbiddenError('Caller has no tenantId claim to scope an "own" listing to')
  }

  const assignments =
    scope === 'global'
      ? await scanAllAssignments(ddbDocClient, roleAssignmentsTableName)
      : await queryTenantAssignments(ddbDocClient, roleAssignmentsTableName, caller.tenantId!)

  const users = await Promise.all(
    assignments.map((assignment) => hydrateUser(assignment, cognitoClient, userPoolId)),
  )

  return { users }
}

async function queryTenantAssignments(
  ddbDocClient: DynamoDBDocumentClient,
  tableName: string,
  tenantId: string,
): Promise<Array<{ userId: string; tenantId: string; roleId: string }>> {
  const result = await ddbDocClient.send(
    new QueryCommand({
      TableName: tableName,
      IndexName: 'tenantId-index',
      KeyConditionExpression: 'tenantId = :t',
      ExpressionAttributeValues: { ':t': tenantId },
    }),
  )
  return (result.Items ?? []) as Array<{ userId: string; tenantId: string; roleId: string }>
}

async function scanAllAssignments(
  ddbDocClient: DynamoDBDocumentClient,
  tableName: string,
): Promise<Array<{ userId: string; tenantId: string; roleId: string }>> {
  const result = await ddbDocClient.send(new ScanCommand({ TableName: tableName }))
  return (result.Items ?? []) as Array<{ userId: string; tenantId: string; roleId: string }>
}

async function hydrateUser(
  assignment: { userId: string; tenantId: string; roleId: string },
  cognitoClient: CognitoIdentityProviderClient,
  userPoolId: string,
): Promise<AdminUserSummary> {
  const cognitoUser = await cognitoClient.send(
    new AdminGetUserCommand({ UserPoolId: userPoolId, Username: assignment.userId }),
  )

  const email = cognitoUser.UserAttributes?.find((attr) => attr.Name === 'email')?.Value

  return {
    userId: assignment.userId,
    tenantId: assignment.tenantId,
    roleId: assignment.roleId,
    email,
    enabled: cognitoUser.Enabled,
    userStatus: cognitoUser.UserStatus,
  }
}
