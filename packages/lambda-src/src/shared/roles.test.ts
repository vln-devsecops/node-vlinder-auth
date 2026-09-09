import { DynamoDBDocumentClient, GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb'
import { mockClient } from 'aws-sdk-client-mock'
import { beforeEach, describe, expect, it } from 'vitest'
import { getRoleDefinition, resolveUserRoleAssignments } from './roles'

const ddbMock = mockClient(DynamoDBDocumentClient)

beforeEach(() => {
  ddbMock.reset()
})

describe('resolveUserRoleAssignments', () => {
  it('returns all of the user\'s roles within one tenant, with their activation', async () => {
    ddbMock.on(QueryCommand).resolves({
      Items: [
        { userId: 'user-123', tenantId: 'acme-corp', roleId: 'tenant-admin', activation: 'default' },
        { userId: 'user-123', tenantId: 'acme-corp', roleId: 'billing', activation: 'elevated' },
        // A legacy row without the attribute is treated as a default role.
        { userId: 'user-123', tenantId: 'acme-corp', roleId: 'legacy' },
      ],
    })

    const assignments = await resolveUserRoleAssignments({
      userId: 'user-123',
      tableName: 'role-assignments-table',
      ddbDocClient: ddbMock as unknown as DynamoDBDocumentClient,
    })

    expect(assignments).toEqual({
      userId: 'user-123',
      tenants: [
        {
          tenantId: 'acme-corp',
          roles: [
            { roleId: 'tenant-admin', activation: 'default' },
            { roleId: 'billing', activation: 'elevated' },
            { roleId: 'legacy', activation: 'default' },
          ],
        },
      ],
    })
    // No Limit -- must fetch every role the user holds.
    const queryCall = ddbMock.commandCalls(QueryCommand)[0]
    expect(queryCall.args[0].input).toMatchObject({
      TableName: 'role-assignments-table',
      ExpressionAttributeValues: { ':u': 'user-123' },
    })
    expect(queryCall.args[0].input.Limit).toBeUndefined()
  })

  it('groups roles by tenant when the user holds assignments in more than one', async () => {
    // A user logged in on more than one tenant at once: role rows span two
    // tenants under the same userId partition key.
    ddbMock.on(QueryCommand).resolves({
      Items: [
        { userId: 'user-123', tenantId: 'acme-corp', roleId: 'tenant-admin', activation: 'default' },
        { userId: 'user-123', tenantId: 'globex', roleId: 'member', activation: 'default' },
      ],
    })

    const assignments = await resolveUserRoleAssignments({
      userId: 'user-123',
      tableName: 'role-assignments-table',
      ddbDocClient: ddbMock as unknown as DynamoDBDocumentClient,
    })

    expect(assignments).toEqual({
      userId: 'user-123',
      tenants: [
        { tenantId: 'acme-corp', roles: [{ roleId: 'tenant-admin', activation: 'default' }] },
        { tenantId: 'globex', roles: [{ roleId: 'member', activation: 'default' }] },
      ],
    })
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
        privileges: ['read:acme-corp:users', 'write:acme-corp:users'],
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
      privileges: ['read:acme-corp:users', 'write:acme-corp:users'],
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
