import { DynamoDBDocumentClient, GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb'
import { mockClient } from 'aws-sdk-client-mock'
import { beforeEach, describe, expect, it } from 'vitest'
import { resolvePrivilegesForUser } from './privileges'

const ddbMock = mockClient(DynamoDBDocumentClient)

beforeEach(() => {
  ddbMock.reset()
})

describe('resolvePrivilegesForUser', () => {
  it('resolves the tenantId and deduped privilege list for an assigned user', async () => {
    ddbMock.on(QueryCommand).resolves({
      Items: [{ userId: 'user-123', tenantId: 'acme-corp', roleId: 'tenant-admin' }],
    })
    ddbMock.on(GetCommand).resolves({
      Item: {
        roleId: 'tenant-admin',
        privileges: ['users:read:own', 'users:write:own', 'users:read:own'],
        tenantScope: 'tenant',
      },
    })

    const resolved = await resolvePrivilegesForUser({
      userId: 'user-123',
      roleAssignmentsTableName: 'role-assignments-table',
      rolesTableName: 'roles-table',
      ddbDocClient: ddbMock as unknown as DynamoDBDocumentClient,
    })

    expect(resolved).toEqual({
      tenantId: 'acme-corp',
      roleId: 'tenant-admin',
      privileges: ['users:read:own', 'users:write:own'],
    })
  })

  it('returns no tenant/privileges when the user has no role assignment', async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [] })

    const resolved = await resolvePrivilegesForUser({
      userId: 'user-without-role',
      roleAssignmentsTableName: 'role-assignments-table',
      rolesTableName: 'roles-table',
      ddbDocClient: ddbMock as unknown as DynamoDBDocumentClient,
    })

    expect(resolved).toEqual({
      tenantId: undefined,
      roleId: undefined,
      privileges: [],
    })
  })

  it('returns no privileges when the assigned role no longer exists in the catalog', async () => {
    ddbMock.on(QueryCommand).resolves({
      Items: [{ userId: 'user-123', tenantId: 'acme-corp', roleId: 'deleted-role' }],
    })
    ddbMock.on(GetCommand).resolves({})

    const resolved = await resolvePrivilegesForUser({
      userId: 'user-123',
      roleAssignmentsTableName: 'role-assignments-table',
      rolesTableName: 'roles-table',
      ddbDocClient: ddbMock as unknown as DynamoDBDocumentClient,
    })

    expect(resolved.privileges).toEqual([])
  })
})
