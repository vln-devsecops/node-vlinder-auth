import { DynamoDBDocumentClient, GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb'
import { mockClient } from 'aws-sdk-client-mock'
import { beforeEach, describe, expect, it } from 'vitest'
import { resolvePrivilegesForUser } from './privileges'

const ddbMock = mockClient(DynamoDBDocumentClient)

beforeEach(() => {
  ddbMock.reset()
})

describe('resolvePrivilegesForUser', () => {
  it('binds a tenant-scoped role\'s catalog privileges to the caller\'s resolved tenant', async () => {
    ddbMock.on(QueryCommand).resolves({
      Items: [{ userId: 'user-123', tenantId: 'acme-corp', roleId: 'tenant-admin' }],
    })
    ddbMock.on(GetCommand).resolves({
      Item: {
        roleId: 'tenant-admin',
        // The catalog stores tenant-scoped roles in tenant-irrelevant form --
        // the concrete tenant is bound at resolution time from the caller's
        // actual assignment, not baked into the catalog entry.
        privileges: ['read:users', 'write:users', 'read:users'],
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
      privileges: ['read:acme-corp:users', 'write:acme-corp:users'],
    })
  })

  it('binds the same catalog role to a different tenant for a different user', async () => {
    ddbMock.on(QueryCommand).resolves({
      Items: [{ userId: 'user-456', tenantId: 'globex', roleId: 'tenant-admin' }],
    })
    ddbMock.on(GetCommand).resolves({
      Item: { roleId: 'tenant-admin', privileges: ['read:users'], tenantScope: 'tenant' },
    })

    const resolved = await resolvePrivilegesForUser({
      userId: 'user-456',
      roleAssignmentsTableName: 'role-assignments-table',
      rolesTableName: 'roles-table',
      ddbDocClient: ddbMock as unknown as DynamoDBDocumentClient,
    })

    // Same role catalog entry, bound to a different caller's real tenant --
    // proves the tenant comes from the assignment, not something baked into
    // the role definition.
    expect(resolved.privileges).toEqual(['read:globex:users'])
  })

  it('leaves a global-scoped role\'s privileges untouched (already tenant-wildcard)', async () => {
    ddbMock.on(QueryCommand).resolves({
      Items: [{ userId: 'user-123', tenantId: 'acme-corp', roleId: 'superadmin' }],
    })
    ddbMock.on(GetCommand).resolves({
      Item: { roleId: 'superadmin', privileges: ['write:*:users'], tenantScope: 'global' },
    })

    const resolved = await resolvePrivilegesForUser({
      userId: 'user-123',
      roleAssignmentsTableName: 'role-assignments-table',
      rolesTableName: 'roles-table',
      ddbDocClient: ddbMock as unknown as DynamoDBDocumentClient,
    })

    expect(resolved.privileges).toEqual(['write:*:users'])
  })

  it('unions (deduped) the privileges of every role the user holds', async () => {
    ddbMock.on(QueryCommand).resolves({
      Items: [
        { userId: 'user-123', tenantId: 'acme-corp', roleId: 'reader' },
        { userId: 'user-123', tenantId: 'acme-corp', roleId: 'billing' },
      ],
    })
    ddbMock.on(GetCommand, { Key: { roleId: 'reader' } }).resolves({
      Item: { roleId: 'reader', privileges: ['read:users'], tenantScope: 'tenant' },
    })
    ddbMock.on(GetCommand, { Key: { roleId: 'billing' } }).resolves({
      Item: {
        roleId: 'billing',
        privileges: ['read:users', 'write:billing'],
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
      ['write:acme-corp:billing', 'read:acme-corp:users'].sort(),
    )
  })

  it('unions only the default (login) roles, excluding elevated ones', async () => {
    ddbMock.on(QueryCommand).resolves({
      Items: [
        { userId: 'user-123', tenantId: 'acme-corp', roleId: 'reader', activation: 'default' },
        { userId: 'user-123', tenantId: 'acme-corp', roleId: 'superadmin', activation: 'elevated' },
      ],
    })
    ddbMock.on(GetCommand, { Key: { roleId: 'reader' } }).resolves({
      Item: { roleId: 'reader', privileges: ['read:users'], tenantScope: 'tenant' },
    })
    ddbMock.on(GetCommand, { Key: { roleId: 'superadmin' } }).resolves({
      Item: { roleId: 'superadmin', privileges: ['write:*:users'], tenantScope: 'global' },
    })

    const resolved = await resolvePrivilegesForUser({
      userId: 'user-123',
      roleAssignmentsTableName: 'role-assignments-table',
      rolesTableName: 'roles-table',
      ddbDocClient: ddbMock as unknown as DynamoDBDocumentClient,
    })

    // superadmin is held but elevated -> its privileges must NOT be in the login token.
    expect(resolved.roleIds).toEqual(['reader'])
    expect(resolved.privileges).toEqual(['read:acme-corp:users'])
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
