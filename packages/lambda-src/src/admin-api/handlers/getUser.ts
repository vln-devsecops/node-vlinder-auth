import {
  AdminGetUserCommand,
  type CognitoIdentityProviderClient,
} from '@aws-sdk/client-cognito-identity-provider'
import { QueryCommand, type DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb'
import { assertTenantAccess, type CallerContext } from '../authz'
import { ADMIN_USERS_READ } from '../privileges'
import type { AssignedRole, RoleActivation } from '../../shared/types'
import type { AdminUserSummary } from './listUsers'

export class NotFoundError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'NotFoundError'
  }
}

export interface GetUserParams {
  caller: CallerContext
  targetUserId: string
  ddbDocClient: DynamoDBDocumentClient
  cognitoClient: CognitoIdentityProviderClient
  roleAssignmentsTableName: string
  userPoolId: string
}

/** Fetches a single user, enforcing the same own/global tenant scope as listUsers. */
export async function getUser(params: GetUserParams): Promise<AdminUserSummary> {
  const { caller, targetUserId, ddbDocClient, cognitoClient, roleAssignmentsTableName, userPoolId } =
    params

  const result = await ddbDocClient.send(
    new QueryCommand({
      TableName: roleAssignmentsTableName,
      KeyConditionExpression: 'userId = :u',
      ExpressionAttributeValues: { ':u': targetUserId },
    }),
  )

  const rows = (result.Items ?? []) as Array<{
    tenantId: string
    roleId: string
    activation?: RoleActivation
  }>
  if (rows.length === 0) {
    throw new NotFoundError(`No user found with id ${targetUserId}`)
  }

  const tenantId = rows[0].tenantId
  const roles: AssignedRole[] = rows
    .filter((row) => row.tenantId === tenantId)
    .map((row) => ({ roleId: row.roleId, activation: row.activation ?? 'default' }))

  assertTenantAccess(caller, ADMIN_USERS_READ, tenantId)

  const cognitoUser = await cognitoClient.send(
    new AdminGetUserCommand({ UserPoolId: userPoolId, Username: targetUserId }),
  )
  const email = cognitoUser.UserAttributes?.find((attr) => attr.Name === 'email')?.Value

  return {
    userId: targetUserId,
    tenantId,
    roles,
    email,
    enabled: cognitoUser.Enabled,
    userStatus: cognitoUser.UserStatus,
  }
}
