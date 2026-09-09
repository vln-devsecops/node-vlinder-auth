import {
  AdminGetUserCommand,
  CognitoIdentityProviderClient,
} from '@aws-sdk/client-cognito-identity-provider'
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb'
import { mockClient } from 'aws-sdk-client-mock'
import { beforeEach, describe, expect, it } from 'vitest'
import { ForbiddenError } from '../authz'
import { listUsers } from './listUsers'

const ddbMock = mockClient(DynamoDBDocumentClient)
const cognitoMock = mockClient(CognitoIdentityProviderClient)

beforeEach(() => {
  ddbMock.reset()
  cognitoMock.reset()
})

describe('listUsers', () => {
  it('queries only the caller\'s own tenant for a tenant-scoped grant', async () => {
    ddbMock.on(QueryCommand).resolves({
      Items: [{ userId: 'user-1', tenantId: 'acme-corp', roleId: 'member' }],
    })
    cognitoMock.on(AdminGetUserCommand).resolves({
      Username: 'user-1',
      Enabled: true,
      UserStatus: 'CONFIRMED',
      UserAttributes: [{ Name: 'email', Value: 'user1@acme.com' }],
    })

    const result = await listUsers({
      caller: { tenants: ['acme-corp'], scopes: ['read:acme-corp:admin/users'] },
      ddbDocClient: ddbMock as unknown as DynamoDBDocumentClient,
      cognitoClient: cognitoMock as unknown as CognitoIdentityProviderClient,
      roleAssignmentsTableName: 'role-assignments-table',
      userPoolId: 'us-east-1_example',
    })

    const queryCall = ddbMock.commandCalls(QueryCommand)[0]
    expect(queryCall.args[0].input).toMatchObject({
      TableName: 'role-assignments-table',
      IndexName: 'tenantId-index',
      ExpressionAttributeValues: { ':t': 'acme-corp' },
    })

    expect(result.users).toEqual([
      {
        userId: 'user-1',
        tenantId: 'acme-corp',
        roles: [{ roleId: 'member', activation: 'default' }],
        email: 'user1@acme.com',
        enabled: true,
        userStatus: 'CONFIRMED',
      },
    ])
  })

  it('collapses a user\'s multiple role rows into one entry with all roles', async () => {
    ddbMock.on(QueryCommand).resolves({
      Items: [
        { userId: 'user-1', tenantId: 'acme-corp', roleId: 'member', activation: 'default' },
        { userId: 'user-1', tenantId: 'acme-corp', roleId: 'billing', activation: 'elevated' },
      ],
    })
    cognitoMock.on(AdminGetUserCommand).resolves({
      Username: 'user-1',
      Enabled: true,
      UserStatus: 'CONFIRMED',
      UserAttributes: [{ Name: 'email', Value: 'user1@acme.com' }],
    })

    const result = await listUsers({
      caller: { tenants: ['acme-corp'], scopes: ['read:acme-corp:admin/users'] },
      ddbDocClient: ddbMock as unknown as DynamoDBDocumentClient,
      cognitoClient: cognitoMock as unknown as CognitoIdentityProviderClient,
      roleAssignmentsTableName: 'role-assignments-table',
      userPoolId: 'us-east-1_example',
    })

    expect(result.users).toHaveLength(1)
    expect(result.users[0].roles).toEqual([
      { roleId: 'member', activation: 'default' },
      { roleId: 'billing', activation: 'elevated' },
    ])
    // Cognito hydrated once per user, not once per role row.
    expect(cognitoMock.commandCalls(AdminGetUserCommand)).toHaveLength(1)
  })

  it('skips role assignments whose Cognito user no longer exists', async () => {
    ddbMock.on(QueryCommand).resolves({
      Items: [
        { userId: 'user-gone', tenantId: 'acme-corp', roleId: 'member' },
        { userId: 'user-1', tenantId: 'acme-corp', roleId: 'member' },
      ],
    })
    const notFound = new Error('User does not exist.')
    notFound.name = 'UserNotFoundException'
    cognitoMock
      .on(AdminGetUserCommand, { UserPoolId: 'us-east-1_example', Username: 'user-gone' })
      .rejects(notFound)
    cognitoMock
      .on(AdminGetUserCommand, { UserPoolId: 'us-east-1_example', Username: 'user-1' })
      .resolves({
        Username: 'user-1',
        Enabled: true,
        UserStatus: 'CONFIRMED',
        UserAttributes: [{ Name: 'email', Value: 'user1@acme.com' }],
      })

    const result = await listUsers({
      caller: { tenants: ['acme-corp'], scopes: ['read:acme-corp:admin/users'] },
      ddbDocClient: ddbMock as unknown as DynamoDBDocumentClient,
      cognitoClient: cognitoMock as unknown as CognitoIdentityProviderClient,
      roleAssignmentsTableName: 'role-assignments-table',
      userPoolId: 'us-east-1_example',
    })

    // One stale row (user deleted via console/CLI, assignment left behind)
    // must not fail the whole listing.
    expect(result.users.map((user) => user.userId)).toEqual(['user-1'])
  })

  it('caps a tenant-wildcard grant to exactly the tenants the caller is authenticated against', async () => {
    ddbMock
      .on(QueryCommand, { ExpressionAttributeValues: { ':t': 'acme-corp' } })
      .resolves({ Items: [{ userId: 'user-1', tenantId: 'acme-corp', roleId: 'member' }] })
    ddbMock
      .on(QueryCommand, { ExpressionAttributeValues: { ':t': 'globex' } })
      .resolves({ Items: [{ userId: 'user-2', tenantId: 'globex', roleId: 'tenant-admin' }] })
    cognitoMock.on(AdminGetUserCommand).resolves({
      Username: 'ignored',
      Enabled: true,
      UserStatus: 'CONFIRMED',
      UserAttributes: [{ Name: 'email', Value: 'someone@example.com' }],
    })

    const result = await listUsers({
      // Holds a super-admin-style wildcard grant, but is only authenticated
      // against two of the tenants that might exist in the system.
      caller: { tenants: ['acme-corp', 'globex'], scopes: ['read:*:admin/users'] },
      ddbDocClient: ddbMock as unknown as DynamoDBDocumentClient,
      cognitoClient: cognitoMock as unknown as CognitoIdentityProviderClient,
      roleAssignmentsTableName: 'role-assignments-table',
      userPoolId: 'us-east-1_example',
    })

    expect(result.users).toHaveLength(2)
    expect(result.users.map((u) => u.tenantId).sort()).toEqual(['acme-corp', 'globex'])
  })

  it('rejects a wildcard-granted caller authenticated against no tenant at all', async () => {
    await expect(
      listUsers({
        caller: { tenants: [], scopes: ['read:*:admin/users'] },
        ddbDocClient: ddbMock as unknown as DynamoDBDocumentClient,
        cognitoClient: cognitoMock as unknown as CognitoIdentityProviderClient,
        roleAssignmentsTableName: 'role-assignments-table',
        userPoolId: 'us-east-1_example',
      }),
    ).rejects.toThrow(ForbiddenError)

    expect(ddbMock.commandCalls(QueryCommand)).toHaveLength(0)
  })

  it('rejects a caller with no matching read scope', async () => {
    await expect(
      listUsers({
        caller: { tenants: ['acme-corp'], scopes: [] },
        ddbDocClient: ddbMock as unknown as DynamoDBDocumentClient,
        cognitoClient: cognitoMock as unknown as CognitoIdentityProviderClient,
        roleAssignmentsTableName: 'role-assignments-table',
        userPoolId: 'us-east-1_example',
      }),
    ).rejects.toThrow(ForbiddenError)

    expect(ddbMock.commandCalls(QueryCommand)).toHaveLength(0)
  })

  it('unions results across every tenant named by a caller holding several tenant-scoped grants', async () => {
    ddbMock
      .on(QueryCommand, { ExpressionAttributeValues: { ':t': 'acme-corp' } })
      .resolves({ Items: [{ userId: 'user-1', tenantId: 'acme-corp', roleId: 'member' }] })
    ddbMock
      .on(QueryCommand, { ExpressionAttributeValues: { ':t': 'globex' } })
      .resolves({ Items: [{ userId: 'user-2', tenantId: 'globex', roleId: 'member' }] })
    cognitoMock.on(AdminGetUserCommand).resolves({
      Enabled: true,
      UserStatus: 'CONFIRMED',
      UserAttributes: [{ Name: 'email', Value: 'someone@example.com' }],
    })

    const result = await listUsers({
      caller: {
        tenants: ['acme-corp', 'globex'],
        scopes: ['read:acme-corp:admin/users', 'read:globex:admin/users'],
      },
      ddbDocClient: ddbMock as unknown as DynamoDBDocumentClient,
      cognitoClient: cognitoMock as unknown as CognitoIdentityProviderClient,
      roleAssignmentsTableName: 'role-assignments-table',
      userPoolId: 'us-east-1_example',
    })

    expect(result.users.map((u) => u.tenantId).sort()).toEqual(['acme-corp', 'globex'])
  })

  it('excludes a tenant-scoped grant naming a tenant the caller is not authenticated against', async () => {
    const result = await listUsers({
      // Grant names globex, but this session never authenticated to it.
      caller: { tenants: ['acme-corp'], scopes: ['read:globex:admin/users'] },
      ddbDocClient: ddbMock as unknown as DynamoDBDocumentClient,
      cognitoClient: cognitoMock as unknown as CognitoIdentityProviderClient,
      roleAssignmentsTableName: 'role-assignments-table',
      userPoolId: 'us-east-1_example',
    }).catch((error) => error)

    expect(result).toBeInstanceOf(ForbiddenError)
    expect(ddbMock.commandCalls(QueryCommand)).toHaveLength(0)
  })

  it('does not merge one user\'s roles across tenants when they hold assignments in more than one queried tenant', async () => {
    ddbMock
      .on(QueryCommand, { ExpressionAttributeValues: { ':t': 'acme-corp' } })
      .resolves({ Items: [{ userId: 'user-1', tenantId: 'acme-corp', roleId: 'tenant-admin' }] })
    ddbMock
      .on(QueryCommand, { ExpressionAttributeValues: { ':t': 'globex' } })
      .resolves({ Items: [{ userId: 'user-1', tenantId: 'globex', roleId: 'member' }] })
    cognitoMock.on(AdminGetUserCommand).resolves({
      Enabled: true,
      UserStatus: 'CONFIRMED',
      UserAttributes: [{ Name: 'email', Value: 'user1@example.com' }],
    })

    const result = await listUsers({
      caller: { tenants: ['acme-corp', 'globex'], scopes: ['read:*:admin/users'] },
      ddbDocClient: ddbMock as unknown as DynamoDBDocumentClient,
      cognitoClient: cognitoMock as unknown as CognitoIdentityProviderClient,
      roleAssignmentsTableName: 'role-assignments-table',
      userPoolId: 'us-east-1_example',
    })

    // Same person, two separate tenant memberships -- each with only its
    // own tenant's role, not merged into one entry under one tenantId.
    expect(result.users).toHaveLength(2)
    const byTenant = new Map(result.users.map((u) => [u.tenantId, u]))
    expect(byTenant.get('acme-corp')?.roles).toEqual([
      { roleId: 'tenant-admin', activation: 'default' },
    ])
    expect(byTenant.get('globex')?.roles).toEqual([{ roleId: 'member', activation: 'default' }])
  })
})
