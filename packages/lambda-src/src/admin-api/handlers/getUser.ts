import {
  AdminGetUserCommand,
  type CognitoIdentityProviderClient,
} from '@aws-sdk/client-cognito-identity-provider'
import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb'
import { assertTenantAccess, type CallerContext } from '../authz'
import { ADMIN_USERS_READ } from '../privileges'
import { loadTargetUsersSoleTenant } from '../targetTenant'
import type { AssignedRole } from '../../shared/types'
import type { AdminUserSummary } from './listUsers'

export { NotFoundError } from '../targetTenant'

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

  const { tenantId, rows } = await loadTargetUsersSoleTenant(
    ddbDocClient,
    roleAssignmentsTableName,
    targetUserId,
  )
  const roles: AssignedRole[] = rows.map((row) => ({
    roleId: row.roleId,
    activation: row.activation ?? 'default',
  }))

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
