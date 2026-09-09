import {
  AdminGetUserCommand,
  type CognitoIdentityProviderClient,
} from '@aws-sdk/client-cognito-identity-provider'
import { QueryCommand, ScanCommand, type DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb'
import { resolveCallerTenantScope, ForbiddenError, type CallerContext } from '../authz'
import { ADMIN_USERS_READ } from '../privileges'
import type { AssignedRole, RoleActivation } from '../../shared/types'

export interface AdminUserSummary {
  userId: string
  tenantId: string
  roles: AssignedRole[]
  email?: string
  enabled?: boolean
  userStatus?: string
}

interface AssignmentRow {
  userId: string
  tenantId: string
  roleId: string
  activation?: RoleActivation
}

interface GroupedUser {
  userId: string
  tenantId: string
  roles: AssignedRole[]
}

/** Collapses per-role assignment rows into one entry per user, gathering roles. */
function groupByUser(rows: AssignmentRow[]): GroupedUser[] {
  const byUser = new Map<string, GroupedUser>()
  for (const row of rows) {
    const role: AssignedRole = { roleId: row.roleId, activation: row.activation ?? 'default' }
    const existing = byUser.get(row.userId)
    if (existing) {
      existing.roles.push(role)
    } else {
      byUser.set(row.userId, { userId: row.userId, tenantId: row.tenantId, roles: [role] })
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
 * Lists users the caller is permitted to see: the tenant(s) named by their
 * tenant-scoped grants (a caller can hold more than one), or every tenant
 * for a tenant-wildcard (super-admin) grant -- the same mechanism as the
 * token's privilege check, just applied to a listing instead of a single
 * target. This route takes no tenant parameter of its own, so there is
 * nothing for the grants to be checked against or overridden -- the grants
 * are simply the whole answer to "which tenants."
 */
export async function listUsers(params: ListUsersParams): Promise<ListUsersResult> {
  const { caller, ddbDocClient, cognitoClient, roleAssignmentsTableName, userPoolId } = params

  const granted = resolveCallerTenantScope(caller, ADMIN_USERS_READ)
  if (granted.scope === 'none') {
    throw new ForbiddenError(
      `Missing privilege ${ADMIN_USERS_READ.verb}:${ADMIN_USERS_READ.resource}`,
    )
  }

  const assignments =
    granted.scope === 'global'
      ? await scanAllAssignments(ddbDocClient, roleAssignmentsTableName)
      : await queryTenantsAssignments(ddbDocClient, roleAssignmentsTableName, granted.tenantIds)

  const users = await Promise.all(
    groupByUser(assignments).map((user) => hydrateUser(user, cognitoClient, userPoolId)),
  )

  return { users: users.filter((user): user is AdminUserSummary => user !== null) }
}

async function queryTenantAssignments(
  ddbDocClient: DynamoDBDocumentClient,
  tableName: string,
  tenantId: string,
): Promise<AssignmentRow[]> {
  const result = await ddbDocClient.send(
    new QueryCommand({
      TableName: tableName,
      IndexName: 'tenantId-index',
      KeyConditionExpression: 'tenantId = :t',
      ExpressionAttributeValues: { ':t': tenantId },
    }),
  )
  return (result.Items ?? []) as AssignmentRow[]
}

/** Queries each granted tenant independently and flattens the results. */
async function queryTenantsAssignments(
  ddbDocClient: DynamoDBDocumentClient,
  tableName: string,
  tenantIds: string[],
): Promise<AssignmentRow[]> {
  const perTenant = await Promise.all(
    tenantIds.map((tenantId) => queryTenantAssignments(ddbDocClient, tableName, tenantId)),
  )
  return perTenant.flat()
}

async function scanAllAssignments(
  ddbDocClient: DynamoDBDocumentClient,
  tableName: string,
): Promise<AssignmentRow[]> {
  const result = await ddbDocClient.send(new ScanCommand({ TableName: tableName }))
  return (result.Items ?? []) as AssignmentRow[]
}

async function hydrateUser(
  user: GroupedUser,
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
    roles: user.roles,
    email,
    enabled: cognitoUser.Enabled,
    userStatus: cognitoUser.UserStatus,
  }
}
