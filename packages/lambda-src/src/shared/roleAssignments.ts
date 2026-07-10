import { PutCommand, type DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb'

export interface CreateInitialRoleAssignmentParams {
  userId: string
  tenantId: string
  roleId: string
  tableName: string
  ddbDocClient: DynamoDBDocumentClient
}

/**
 * Writes the first role assignment for a newly-confirmed user. Uses a
 * conditional write so a retried trigger invocation (Cognito may redeliver)
 * never clobbers a role an admin has since changed.
 */
export async function createInitialRoleAssignment(
  params: CreateInitialRoleAssignmentParams,
): Promise<void> {
  const { userId, tenantId, roleId, tableName, ddbDocClient } = params

  try {
    await ddbDocClient.send(
      new PutCommand({
        TableName: tableName,
        Item: { userId, tenantId, roleId },
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
