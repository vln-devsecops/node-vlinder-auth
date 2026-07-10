import {
  AdminGetUserCommand,
  type CognitoIdentityProviderClient,
} from '@aws-sdk/client-cognito-identity-provider'
import { QueryCommand, type DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb'
import { assertTenantAccess, type CallerContext } from '../authz'
import type { AdminUserSummary } from './listUsers'

const PRIVILEGE_FAMILY = 'admin:users:read'

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
      Limit: 1,
    }),
  )

  const assignment = result.Items?.[0] as
    | { userId: string; tenantId: string; roleId: string }
    | undefined

  if (!assignment) {
    throw new NotFoundError(`No user found with id ${targetUserId}`)
  }

  assertTenantAccess(caller, PRIVILEGE_FAMILY, assignment.tenantId)

  const cognitoUser = await cognitoClient.send(
    new AdminGetUserCommand({ UserPoolId: userPoolId, Username: targetUserId }),
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
