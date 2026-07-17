import { DynamoDBDocumentClient, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb'
import { mockClient } from 'aws-sdk-client-mock'
import { beforeEach, describe, expect, it } from 'vitest'
import { ForbiddenError } from '../authz'
import { assignRole } from './assignRole'
import { NotFoundError } from './getUser'

const ddbMock = mockClient(DynamoDBDocumentClient)

beforeEach(() => {
  ddbMock.reset()
})

const commonParams = {
  ddbDocClient: ddbMock as unknown as DynamoDBDocumentClient,
  roleAssignmentsTableName: 'role-assignments-table',
}

describe('assignRole', () => {
  it('adds a role (composite key) for a user in the caller\'s own tenant', async () => {
    ddbMock
      .on(QueryCommand)
      .resolves({ Items: [{ userId: 'user-1', tenantId: 'acme-corp', roleId: 'member' }] })
    ddbMock.on(PutCommand).resolves({})

    await assignRole({
      caller: { tenantId: 'acme-corp', privileges: ['admin:users:write:own'] },
      targetUserId: 'user-1',
      roleId: 'tenant-admin',
      ...commonParams,
    })

    const putCall = ddbMock.commandCalls(PutCommand)[0]
    expect(putCall.args[0].input).toMatchObject({
      TableName: 'role-assignments-table',
      Item: {
        userId: 'user-1',
        tenantRole: 'acme-corp#tenant-admin',
        tenantId: 'acme-corp',
        roleId: 'tenant-admin',
      },
    })
    // Idempotent add, not a conditional create.
    expect(putCall.args[0].input.ConditionExpression).toBeUndefined()
  })

  it('rejects an "own"-scoped caller acting on a different tenant\'s user', async () => {
    ddbMock
      .on(QueryCommand)
      .resolves({ Items: [{ userId: 'user-2', tenantId: 'globex', roleId: 'member' }] })

    await expect(
      assignRole({
        caller: { tenantId: 'acme-corp', privileges: ['admin:users:write:own'] },
        targetUserId: 'user-2',
        roleId: 'tenant-admin',
        ...commonParams,
      }),
    ).rejects.toThrow(ForbiddenError)

    expect(ddbMock.commandCalls(PutCommand)).toHaveLength(0)
  })

  it('throws NotFoundError when the target user has no existing role assignment', async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [] })

    await expect(
      assignRole({
        caller: { tenantId: 'acme-corp', privileges: ['admin:users:write:*'] },
        targetUserId: 'ghost-user',
        roleId: 'tenant-admin',
        ...commonParams,
      }),
    ).rejects.toThrow(NotFoundError)
  })
})
