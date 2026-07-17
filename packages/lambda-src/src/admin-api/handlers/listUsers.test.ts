import {
  AdminGetUserCommand,
  CognitoIdentityProviderClient,
} from '@aws-sdk/client-cognito-identity-provider'
import { DynamoDBDocumentClient, QueryCommand, ScanCommand } from '@aws-sdk/lib-dynamodb'
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
  it('queries only the caller\'s own tenant when scoped to "own"', async () => {
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
      caller: { tenantId: 'acme-corp', privileges: ['admin:users:read:own'] },
      ddbDocClient: ddbMock as unknown as DynamoDBDocumentClient,
      cognitoClient: cognitoMock as unknown as CognitoIdentityProviderClient,
      roleAssignmentsTableName: 'role-assignments-table',
      userPoolId: 'us-east-1_example',
    })

    expect(ddbMock.commandCalls(ScanCommand)).toHaveLength(0)
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
      caller: { tenantId: 'acme-corp', privileges: ['admin:users:read:own'] },
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
      caller: { tenantId: 'acme-corp', privileges: ['admin:users:read:own'] },
      ddbDocClient: ddbMock as unknown as DynamoDBDocumentClient,
      cognitoClient: cognitoMock as unknown as CognitoIdentityProviderClient,
      roleAssignmentsTableName: 'role-assignments-table',
      userPoolId: 'us-east-1_example',
    })

    // One stale row (user deleted via console/CLI, assignment left behind)
    // must not fail the whole listing.
    expect(result.users.map((user) => user.userId)).toEqual(['user-1'])
  })

  it('scans across all tenants when scoped to "global"', async () => {
    ddbMock.on(ScanCommand).resolves({
      Items: [
        { userId: 'user-1', tenantId: 'acme-corp', roleId: 'member' },
        { userId: 'user-2', tenantId: 'globex', roleId: 'tenant-admin' },
      ],
    })
    cognitoMock.on(AdminGetUserCommand).resolves({
      Username: 'ignored',
      Enabled: true,
      UserStatus: 'CONFIRMED',
      UserAttributes: [{ Name: 'email', Value: 'someone@example.com' }],
    })

    const result = await listUsers({
      caller: { tenantId: 'acme-corp', privileges: ['admin:users:read:*'] },
      ddbDocClient: ddbMock as unknown as DynamoDBDocumentClient,
      cognitoClient: cognitoMock as unknown as CognitoIdentityProviderClient,
      roleAssignmentsTableName: 'role-assignments-table',
      userPoolId: 'us-east-1_example',
    })

    expect(ddbMock.commandCalls(QueryCommand)).toHaveLength(0)
    expect(ddbMock.commandCalls(ScanCommand)).toHaveLength(1)
    expect(result.users).toHaveLength(2)
    expect(result.users.map((u) => u.tenantId)).toEqual(['acme-corp', 'globex'])
  })

  it('rejects a caller with neither the "own" nor "*" read privilege', async () => {
    await expect(
      listUsers({
        caller: { tenantId: 'acme-corp', privileges: [] },
        ddbDocClient: ddbMock as unknown as DynamoDBDocumentClient,
        cognitoClient: cognitoMock as unknown as CognitoIdentityProviderClient,
        roleAssignmentsTableName: 'role-assignments-table',
        userPoolId: 'us-east-1_example',
      }),
    ).rejects.toThrow(ForbiddenError)

    expect(ddbMock.commandCalls(QueryCommand)).toHaveLength(0)
    expect(ddbMock.commandCalls(ScanCommand)).toHaveLength(0)
  })

  it('rejects an "own"-scoped caller with no tenantId claim', async () => {
    await expect(
      listUsers({
        caller: { tenantId: undefined, privileges: ['admin:users:read:own'] },
        ddbDocClient: ddbMock as unknown as DynamoDBDocumentClient,
        cognitoClient: cognitoMock as unknown as CognitoIdentityProviderClient,
        roleAssignmentsTableName: 'role-assignments-table',
        userPoolId: 'us-east-1_example',
      }),
    ).rejects.toThrow(ForbiddenError)
  })
})
