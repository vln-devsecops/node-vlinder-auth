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
  roleIds: string[]
  email?: string
  enabled?: boolean
  userStatus?: string
}

interface AssignmentRow {
  userId: string
  tenantId: string
  roleId: string
}

/** Collapses per-role assignment rows into one entry per user, gathering roleIds. */
function groupByUser(rows: AssignmentRow[]): Array<{
  userId: string
  tenantId: string
  roleIds: string[]
}> {
  const byUser = new Map<string, { userId: string; tenantId: string; roleIds: string[] }>()
  for (const row of rows) {
    const existing = byUser.get(row.userId)
    if (existing) {
      existing.roleIds.push(row.roleId)
    } else {
      byUser.set(row.userId, { userId: row.userId, tenantId: row.tenantId, roleIds: [row.roleId] })
    }
  }
  return [...byUser.values()]
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
    groupByUser(assignments).map((user) => hydrateUser(user, cognitoClient, userPoolId)),
  )

  return { users: users.filter((user): user is AdminUserSummary => user !== null) }
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
  user: { userId: string; tenantId: string; roleIds: string[] },
  cognitoClient: CognitoIdentityProviderClient,
  userPoolId: string,
): Promise<AdminUserSummary | null> {
  let cognitoUser
  try {
    cognitoUser = await cognitoClient.send(
      new AdminGetUserCommand({ UserPoolId: userPoolId, Username: user.userId }),
    )
  } catch (error) {
    // A role assignment can outlive its Cognito user (deleted via the
    // console/CLI rather than the admin API). One stale row must not 500
    // the entire listing -- caught live: the e2e suite's Cognito-only user
    // cleanup left assignments behind and the whole admin panel went blank.
    if (error instanceof Error && error.name === 'UserNotFoundException') {
      return null
    }
    throw error
  }

  const email = cognitoUser.UserAttributes?.find((attr) => attr.Name === 'email')?.Value

  return {
    userId: user.userId,
    tenantId: user.tenantId,
    roleIds: user.roleIds,
    email,
    enabled: cognitoUser.Enabled,
    userStatus: cognitoUser.UserStatus,
  }
}
