import {
  AdminDisableUserCommand,
  AdminEnableUserCommand,
  type CognitoIdentityProviderClient,
} from '@aws-sdk/client-cognito-identity-provider'
import { QueryCommand, type DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb'
import { assertTenantAccess, type CallerContext } from '../authz'
import { NotFoundError } from './getUser'

const REQUIRED_PRIVILEGE = { verb: 'write', resource: 'admin/users' }

export interface SetUserEnabledParams {
  caller: CallerContext
  targetUserId: string
  enabled: boolean
  ddbDocClient: DynamoDBDocumentClient
  cognitoClient: CognitoIdentityProviderClient
  roleAssignmentsTableName: string
  userPoolId: string
}

/** Enables or disables a user, enforcing the same own/global tenant scope as getUser. */
export async function setUserEnabled(params: SetUserEnabledParams): Promise<void> {
  const {
    caller,
    targetUserId,
    enabled,
    ddbDocClient,
    cognitoClient,
    roleAssignmentsTableName,
    userPoolId,
  } = params

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

  assertTenantAccess(caller, REQUIRED_PRIVILEGE, assignment.tenantId)

  const command = enabled
    ? new AdminEnableUserCommand({ UserPoolId: userPoolId, Username: targetUserId })
    : new AdminDisableUserCommand({ UserPoolId: userPoolId, Username: targetUserId })

  await cognitoClient.send(command)
}
