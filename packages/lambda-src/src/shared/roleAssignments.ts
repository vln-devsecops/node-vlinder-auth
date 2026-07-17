import { PutCommand, type DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb'

/**
 * The assignments table's composite range key. A user may hold several roles
 * per tenant, so the row is keyed by `${tenantId}#${roleId}` (one row per
 * grant) rather than by tenantId alone.
 */
export function tenantRoleKey(tenantId: string, roleId: string): string {
  return `${tenantId}#${roleId}`
}

export interface CreateInitialRoleAssignmentParams {
  userId: string
  tenantId: string
  roleId: string
  tableName: string
  ddbDocClient: DynamoDBDocumentClient
}

/**
 * Writes the seed role assignment for a newly-confirmed user. Uses a
 * conditional write so a retried trigger invocation (Cognito may redeliver)
 * never duplicates the seeded grant. The condition guards the exact
 * (user, tenant, role) row, so it is idempotent for the seed role itself;
 * other roles an admin later adds are untouched.
 */
export async function createInitialRoleAssignment(
  params: CreateInitialRoleAssignmentParams,
): Promise<void> {
  const { userId, tenantId, roleId, tableName, ddbDocClient } = params

  try {
    await ddbDocClient.send(
      new PutCommand({
        TableName: tableName,
        // The seed role is a default (login) role -- it is "what you log in as".
        Item: {
          userId,
          tenantRole: tenantRoleKey(tenantId, roleId),
          tenantId,
          roleId,
          activation: 'default',
        },
        ConditionExpression: 'attribute_not_exists(userId)',
      }),
    )
  } catch (error) {
    if (error instanceof Error && error.name === 'ConditionalCheckFailedException') {
      return
    }
    throw error
  }
}
