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
      roleIds: ['tenant-admin'],
      privileges: ['users:read:own', 'users:write:own'],
    })
  })

  it('unions (deduped) the privileges of every role the user holds', async () => {
    ddbMock.on(QueryCommand).resolves({
      Items: [
        { userId: 'user-123', tenantId: 'acme-corp', roleId: 'reader' },
        { userId: 'user-123', tenantId: 'acme-corp', roleId: 'billing' },
      ],
    })
    ddbMock.on(GetCommand, { Key: { roleId: 'reader' } }).resolves({
      Item: { roleId: 'reader', privileges: ['users:read:own'], tenantScope: 'tenant' },
    })
    ddbMock.on(GetCommand, { Key: { roleId: 'billing' } }).resolves({
      Item: {
        roleId: 'billing',
        privileges: ['users:read:own', 'billing:write:own'],
        tenantScope: 'tenant',
      },
    })

    const resolved = await resolvePrivilegesForUser({
      userId: 'user-123',
      roleAssignmentsTableName: 'role-assignments-table',
      rolesTableName: 'roles-table',
      ddbDocClient: ddbMock as unknown as DynamoDBDocumentClient,
    })

    expect(resolved.tenantId).toBe('acme-corp')
    expect(resolved.roleIds).toEqual(['reader', 'billing'])
    expect([...resolved.privileges].sort()).toEqual(
      ['billing:write:own', 'users:read:own'].sort(),
    )
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
      roleIds: [],
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
