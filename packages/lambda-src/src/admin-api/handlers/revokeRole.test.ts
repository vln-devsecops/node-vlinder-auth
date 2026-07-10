import { DynamoDBDocumentClient, DeleteCommand, QueryCommand } from '@aws-sdk/lib-dynamodb'
import { mockClient } from 'aws-sdk-client-mock'
import { beforeEach, describe, expect, it } from 'vitest'
import { ForbiddenError } from '../authz'
import { NotFoundError } from './getUser'
import { revokeRole } from './revokeRole'

const ddbMock = mockClient(DynamoDBDocumentClient)

beforeEach(() => {
  ddbMock.reset()
})

const commonParams = {
  ddbDocClient: ddbMock as unknown as DynamoDBDocumentClient,
  roleAssignmentsTableName: 'role-assignments-table',
}

describe('revokeRole', () => {
  it('deletes the role assignment for a user in the caller\'s own tenant', async () => {
    ddbMock
      .on(QueryCommand)
      .resolves({ Items: [{ userId: 'user-1', tenantId: 'acme-corp', roleId: 'tenant-admin' }] })
    ddbMock.on(DeleteCommand).resolves({})

    await revokeRole({
      caller: { tenantId: 'acme-corp', privileges: ['admin:users:write:own'] },
      targetUserId: 'user-1',
      ...commonParams,
    })

    const deleteCall = ddbMock.commandCalls(DeleteCommand)[0]
    expect(deleteCall.args[0].input).toMatchObject({
      TableName: 'role-assignments-table',
      Key: { userId: 'user-1', tenantId: 'acme-corp' },
    })
  })

  it('rejects an "own"-scoped caller acting on a different tenant\'s user', async () => {
    ddbMock
      .on(QueryCommand)
      .resolves({ Items: [{ userId: 'user-2', tenantId: 'globex', roleId: 'member' }] })

    await expect(
      revokeRole({
        caller: { tenantId: 'acme-corp', privileges: ['admin:users:write:own'] },
        targetUserId: 'user-2',
        ...commonParams,
      }),
    ).rejects.toThrow(ForbiddenError)

    expect(ddbMock.commandCalls(DeleteCommand)).toHaveLength(0)
  })

  it('throws NotFoundError when the target user has no existing role assignment', async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [] })

    await expect(
      revokeRole({
        caller: { tenantId: 'acme-corp', privileges: ['admin:users:write:*'] },
        targetUserId: 'ghost-user',
        ...commonParams,
      }),
    ).rejects.toThrow(NotFoundError)
  })
})
