import {
  AdminGetUserCommand,
  type CognitoIdentityProviderClient,
} from '@aws-sdk/client-cognito-identity-provider'
import { QueryCommand, type DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb'
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

/**
 * Collapses per-role assignment rows into one entry per (user, tenant),
 * gathering roles. Keyed on the pair, not just userId: a caller can now
 * query more than one tenant at once (a tenant-wildcard grant, or several
 * tenant-scoped ones), and the same user can hold assignments in more than
 * one of them -- collapsing solely on userId would silently merge a second
 * tenant's roles into the first tenant's entry, misattributing which tenant
 * granted them.
 */
function groupByUser(rows: AssignmentRow[]): GroupedUser[] {
  const byUserAndTenant = new Map<string, GroupedUser>()
  for (const row of rows) {
    const role: AssignedRole = { roleId: row.roleId, activation: row.activation ?? 'default' }
    const key = `${row.userId}#${row.tenantId}`
    const existing = byUserAndTenant.get(key)
    if (existing) {
      existing.roles.push(role)
    } else {
      byUserAndTenant.set(key, { userId: row.userId, tenantId: row.tenantId, roles: [role] })
    }
  }
  return [...byUserAndTenant.values()]
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
 * tenant-scoped grants, capped to the tenants the caller is actually
 * authenticated against even for a tenant-wildcard (super-admin) grant --
 * the same mechanism as the token's privilege check, just applied to a
 * listing instead of a single target. This route takes no tenant parameter
 * of its own, so there is nothing for the grants to be checked against or
 * overridden -- the grants are simply the whole answer to "which tenants."
 * There is deliberately no "every tenant in the system" listing: a
 * tenant-wildcard grant reaches only tenants the caller has actually
 * authenticated to, never tenants they haven't.
 */
export async function listUsers(params: ListUsersParams): Promise<ListUsersResult> {
  const { caller, ddbDocClient, cognitoClient, roleAssignmentsTableName, userPoolId } = params

  const granted = resolveCallerTenantScope(caller, ADMIN_USERS_READ)
  if (granted.scope === 'none') {
    throw new ForbiddenError(
      `Missing privilege ${ADMIN_USERS_READ.verb}:${ADMIN_USERS_READ.resource}`,
    )
  }

  const assignments = await queryTenantsAssignments(
    ddbDocClient,
    roleAssignmentsTableName,
    granted.tenantIds,
  )

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
