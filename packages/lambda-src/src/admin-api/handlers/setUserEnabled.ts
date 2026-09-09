import {
  AdminDisableUserCommand,
  AdminEnableUserCommand,
  type CognitoIdentityProviderClient,
} from '@aws-sdk/client-cognito-identity-provider'
import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb'
import { assertTenantAccess, type CallerContext } from '../authz'
import { ADMIN_USERS_WRITE } from '../privileges'
import { loadTargetUsersSoleTenant } from '../targetTenant'

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

  const { tenantId } = await loadTargetUsersSoleTenant(
    ddbDocClient,
    roleAssignmentsTableName,
    targetUserId,
  )

  assertTenantAccess(caller, ADMIN_USERS_WRITE, tenantId)

  const command = enabled
    ? new AdminEnableUserCommand({ UserPoolId: userPoolId, Username: targetUserId })
    : new AdminDisableUserCommand({ UserPoolId: userPoolId, Username: targetUserId })

  await cognitoClient.send(command)
}
