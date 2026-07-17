import { DynamoDBDocumentClient, GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb'
import { mockClient } from 'aws-sdk-client-mock'
import { beforeEach, describe, expect, it } from 'vitest'
import { getRoleDefinition, resolveUserRoleAssignments } from './roles'

const ddbMock = mockClient(DynamoDBDocumentClient)

beforeEach(() => {
  ddbMock.reset()
})

describe('resolveUserRoleAssignments', () => {
  it('returns all of the user\'s roles within their tenant', async () => {
    ddbMock.on(QueryCommand).resolves({
      Items: [
        { userId: 'user-123', tenantId: 'acme-corp', roleId: 'tenant-admin' },
        { userId: 'user-123', tenantId: 'acme-corp', roleId: 'billing' },
      ],
    })

    const assignments = await resolveUserRoleAssignments({
      userId: 'user-123',
      tableName: 'role-assignments-table',
      ddbDocClient: ddbMock as unknown as DynamoDBDocumentClient,
    })

    expect(assignments).toEqual({
      userId: 'user-123',
      tenantId: 'acme-corp',
      roleIds: ['tenant-admin', 'billing'],
    })
    // No Limit -- must fetch every role the user holds.
    const queryCall = ddbMock.commandCalls(QueryCommand)[0]
    expect(queryCall.args[0].input).toMatchObject({
      TableName: 'role-assignments-table',
      ExpressionAttributeValues: { ':u': 'user-123' },
    })
    expect(queryCall.args[0].input.Limit).toBeUndefined()
  })

  it('returns undefined when the user has no role assignments', async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [] })

    const assignments = await resolveUserRoleAssignments({
      userId: 'user-without-role',
      tableName: 'role-assignments-table',
      ddbDocClient: ddbMock as unknown as DynamoDBDocumentClient,
    })

    expect(assignments).toBeUndefined()
  })
})

describe('getRoleDefinition', () => {
  it('returns the privileges and tenant scope for a role', async () => {
    ddbMock.on(GetCommand).resolves({
      Item: {
        roleId: 'tenant-admin',
        privileges: ['users:read:own', 'users:write:own'],
        tenantScope: 'tenant',
      },
    })

    const role = await getRoleDefinition({
      roleId: 'tenant-admin',
      tableName: 'roles-table',
      ddbDocClient: ddbMock as unknown as DynamoDBDocumentClient,
    })

    expect(role).toEqual({
      roleId: 'tenant-admin',
      privileges: ['users:read:own', 'users:write:own'],
      tenantScope: 'tenant',
    })
  })

  it('returns undefined when the role does not exist', async () => {
    ddbMock.on(GetCommand).resolves({})

    const role = await getRoleDefinition({
      roleId: 'missing-role',
      tableName: 'roles-table',
      ddbDocClient: ddbMock as unknown as DynamoDBDocumentClient,
    })

    expect(role).toBeUndefined()
  })
})
