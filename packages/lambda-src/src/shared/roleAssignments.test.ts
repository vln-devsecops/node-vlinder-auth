import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb'
import { mockClient } from 'aws-sdk-client-mock'
import { beforeEach, describe, expect, it } from 'vitest'
import { createInitialRoleAssignment } from './roleAssignments'

const ddbMock = mockClient(DynamoDBDocumentClient)

beforeEach(() => {
  ddbMock.reset()
})

describe('createInitialRoleAssignment', () => {
  it('writes a role assignment row keyed by userId and tenantId', async () => {
    ddbMock.on(PutCommand).resolves({})

    await createInitialRoleAssignment({
      userId: 'user-123',
      tenantId: 'default',
      roleId: 'member',
      tableName: 'role-assignments-table',
      ddbDocClient: ddbMock as unknown as DynamoDBDocumentClient,
    })

    const putCall = ddbMock.commandCalls(PutCommand)[0]
    expect(putCall.args[0].input).toMatchObject({
      TableName: 'role-assignments-table',
      Item: { userId: 'user-123', tenantId: 'default', roleId: 'member' },
    })
  })

  it('does not overwrite an existing assignment for the same user and tenant', async () => {
    ddbMock.on(PutCommand).resolves({})

    await createInitialRoleAssignment({
      userId: 'user-123',
      tenantId: 'default',
      roleId: 'member',
      tableName: 'role-assignments-table',
      ddbDocClient: ddbMock as unknown as DynamoDBDocumentClient,
    })

    const putCall = ddbMock.commandCalls(PutCommand)[0]
    expect(putCall.args[0].input.ConditionExpression).toBe(
      'attribute_not_exists(userId)',
    )
  })

  it('swallows the conditional-check failure when an assignment already exists', async () => {
    const conditionalError = new Error('ConditionalCheckFailedException')
    conditionalError.name = 'ConditionalCheckFailedException'
    ddbMock.on(PutCommand).rejects(conditionalError)

    await expect(
      createInitialRoleAssignment({
        userId: 'user-123',
        tenantId: 'default',
        roleId: 'member',
        tableName: 'role-assignments-table',
        ddbDocClient: ddbMock as unknown as DynamoDBDocumentClient,
      }),
    ).resolves.toBeUndefined()
  })
})
