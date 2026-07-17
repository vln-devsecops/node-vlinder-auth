import { PutCommand, QueryCommand, type DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb'
import { assertTenantAccess, type CallerContext } from '../authz'
import { tenantRoleKey } from '../../shared/roleAssignments'
import type { RoleActivation } from '../../shared/types'
import { NotFoundError } from './getUser'

const PRIVILEGE_FAMILY = 'admin:users:write'

export interface AssignRoleParams {
  caller: CallerContext
  targetUserId: string
  roleId: string
  /** Defaults to `elevated`: a newly-granted role is held for sudo, not active at login. */
  activation?: RoleActivation
  ddbDocClient: DynamoDBDocumentClient
  roleAssignmentsTableName: string
}

/**
 * Adds a role to a user within their existing tenant. A user may hold several
 * roles per tenant, so this *adds* the role rather than replacing the set; it
 * is idempotent (re-adding a held role updates its activation). A newly-granted
 * role defaults to `elevated` -- held for a sudo step-up rather than active at
 * login -- so a grant never silently widens someone's everyday privileges;
 * pass `activation: 'default'` to make it a login role. A user's tenant is
 * fixed at signup (see lambda-src/post-confirmation), so this looks up an
 * existing assignment to find and authorize against that tenant. A user with no
 * assignments has no discoverable tenant -- adding a role back to a fully
 * stripped user is out of v1 scope.
 */
export async function assignRole(params: AssignRoleParams): Promise<void> {
  const {
    caller,
    targetUserId,
    roleId,
    activation = 'elevated',
    ddbDocClient,
    roleAssignmentsTableName,
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

  assertTenantAccess(caller, PRIVILEGE_FAMILY, assignment.tenantId)

  await ddbDocClient.send(
    new PutCommand({
      TableName: roleAssignmentsTableName,
      Item: {
        userId: targetUserId,
        tenantRole: tenantRoleKey(assignment.tenantId, roleId),
        tenantId: assignment.tenantId,
        roleId,
        activation,
      },
    }),
  )
}
