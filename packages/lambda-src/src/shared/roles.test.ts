import { DynamoDBDocumentClient, GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb'
import { mockClient } from 'aws-sdk-client-mock'
import { beforeEach, describe, expect, it } from 'vitest'
import { getRoleDefinition, resolveUserRoleAssignment } from './roles'

const ddbMock = mockClient(DynamoDBDocumentClient)

beforeEach(() => {
  ddbMock.reset()
})

describe('resolveUserRoleAssignment', () => {
  it('returns the user\'s role assignment when one exists', async () => {
    ddbMock.on(QueryCommand).resolves({
      Items: [{ userId: 'user-123', tenantId: 'acme-corp', roleId: 'tenant-admin' }],
    })

    const assignment = await resolveUserRoleAssignment({
      userId: 'user-123',
      tableName: 'role-assignments-table',
      ddbDocClient: ddbMock as unknown as DynamoDBDocumentClient,
    })

    expect(assignment).toEqual({
      userId: 'user-123',
      tenantId: 'acme-corp',
      roleId: 'tenant-admin',
    })
    const queryCall = ddbMock.commandCalls(QueryCommand)[0]
    expect(queryCall.args[0].input).toMatchObject({
      TableName: 'role-assignments-table',
      ExpressionAttributeValues: { ':u': 'user-123' },
    })
  })

  it('returns undefined when the user has no role assignment', async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [] })

    const assignment = await resolveUserRoleAssignment({
      userId: 'user-without-role',
      tableName: 'role-assignments-table',
      ddbDocClient: ddbMock as unknown as DynamoDBDocumentClient,
    })

    expect(assignment).toBeUndefined()
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
