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
  it('deletes only the named role, keying by the (tenant, role) composite', async () => {
    ddbMock
      .on(QueryCommand)
      .resolves({ Items: [{ userId: 'user-1', tenantId: 'acme-corp', roleId: 'billing' }] })
    ddbMock.on(DeleteCommand).resolves({})

    await revokeRole({
      caller: { tenantId: 'acme-corp', privileges: ['admin:users:write:own'] },
      targetUserId: 'user-1',
      roleId: 'billing',
      ...commonParams,
    })

    const deleteCall = ddbMock.commandCalls(DeleteCommand)[0]
    expect(deleteCall.args[0].input).toMatchObject({
      TableName: 'role-assignments-table',
      Key: { userId: 'user-1', tenantRole: 'acme-corp#billing' },
    })
  })

  it('leaves the user\'s other roles untouched (deletes exactly one row)', async () => {
    ddbMock.on(QueryCommand).resolves({
      Items: [
        { userId: 'user-1', tenantId: 'acme-corp', roleId: 'reader' },
        { userId: 'user-1', tenantId: 'acme-corp', roleId: 'billing' },
      ],
    })
    ddbMock.on(DeleteCommand).resolves({})

    await revokeRole({
      caller: { tenantId: 'acme-corp', privileges: ['admin:users:write:own'] },
      targetUserId: 'user-1',
      roleId: 'reader',
      ...commonParams,
    })

    expect(ddbMock.commandCalls(DeleteCommand)).toHaveLength(1)
    expect(ddbMock.commandCalls(DeleteCommand)[0].args[0].input.Key).toEqual({
      userId: 'user-1',
      tenantRole: 'acme-corp#reader',
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
        roleId: 'member',
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
        roleId: 'member',
        ...commonParams,
      }),
    ).rejects.toThrow(NotFoundError)
  })
})
