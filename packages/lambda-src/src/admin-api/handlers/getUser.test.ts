import {
  AdminGetUserCommand,
  CognitoIdentityProviderClient,
} from '@aws-sdk/client-cognito-identity-provider'
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb'
import { mockClient } from 'aws-sdk-client-mock'
import { beforeEach, describe, expect, it } from 'vitest'
import { ForbiddenError } from '../authz'
import { getUser, NotFoundError } from './getUser'

const ddbMock = mockClient(DynamoDBDocumentClient)
const cognitoMock = mockClient(CognitoIdentityProviderClient)

beforeEach(() => {
  ddbMock.reset()
  cognitoMock.reset()
})

const commonParams = {
  ddbDocClient: ddbMock as unknown as DynamoDBDocumentClient,
  cognitoClient: cognitoMock as unknown as CognitoIdentityProviderClient,
  roleAssignmentsTableName: 'role-assignments-table',
  userPoolId: 'us-east-1_example',
}

describe('getUser', () => {
  it('returns the user when an "own"-scoped caller targets their own tenant', async () => {
    ddbMock
      .on(QueryCommand)
      .resolves({ Items: [{ userId: 'user-1', tenantId: 'acme-corp', roleId: 'member' }] })
    cognitoMock.on(AdminGetUserCommand).resolves({
      Enabled: true,
      UserStatus: 'CONFIRMED',
      UserAttributes: [{ Name: 'email', Value: 'user1@acme.com' }],
    })

    const user = await getUser({
      caller: { tenantId: 'acme-corp', privileges: ['admin:users:read:own'] },
      targetUserId: 'user-1',
      ...commonParams,
    })

    expect(user).toEqual({
      userId: 'user-1',
      tenantId: 'acme-corp',
      roles: [{ roleId: 'member', activation: 'default' }],
      email: 'user1@acme.com',
      enabled: true,
      userStatus: 'CONFIRMED',
    })
  })

  it('returns every role the user holds, with its activation', async () => {
    ddbMock.on(QueryCommand).resolves({
      Items: [
        { userId: 'user-1', tenantId: 'acme-corp', roleId: 'member', activation: 'default' },
        { userId: 'user-1', tenantId: 'acme-corp', roleId: 'billing', activation: 'elevated' },
      ],
    })
    cognitoMock.on(AdminGetUserCommand).resolves({
      Enabled: true,
      UserStatus: 'CONFIRMED',
      UserAttributes: [{ Name: 'email', Value: 'user1@acme.com' }],
    })

    const user = await getUser({
      caller: { tenantId: 'acme-corp', privileges: ['admin:users:read:own'] },
      targetUserId: 'user-1',
      ...commonParams,
    })

    expect(user.roles).toEqual([
      { roleId: 'member', activation: 'default' },
      { roleId: 'billing', activation: 'elevated' },
    ])
  })

  it('rejects an "own"-scoped caller targeting a user in a different tenant', async () => {
    ddbMock
      .on(QueryCommand)
      .resolves({ Items: [{ userId: 'user-2', tenantId: 'globex', roleId: 'member' }] })

    await expect(
      getUser({
        caller: { tenantId: 'acme-corp', privileges: ['admin:users:read:own'] },
        targetUserId: 'user-2',
        ...commonParams,
      }),
    ).rejects.toThrow(ForbiddenError)
  })

  it('allows a "*"-scoped caller to fetch a user in any tenant', async () => {
    ddbMock
      .on(QueryCommand)
      .resolves({ Items: [{ userId: 'user-2', tenantId: 'globex', roleId: 'member' }] })
    cognitoMock.on(AdminGetUserCommand).resolves({
      Enabled: true,
      UserStatus: 'CONFIRMED',
      UserAttributes: [{ Name: 'email', Value: 'user2@globex.com' }],
    })

    const user = await getUser({
      caller: { tenantId: 'acme-corp', privileges: ['admin:users:read:*'] },
      targetUserId: 'user-2',
      ...commonParams,
    })

    expect(user.tenantId).toBe('globex')
  })

  it('throws NotFoundError when the target user has no role assignment', async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [] })

    await expect(
      getUser({
        caller: { tenantId: 'acme-corp', privileges: ['admin:users:read:*'] },
        targetUserId: 'ghost-user',
        ...commonParams,
      }),
    ).rejects.toThrow(NotFoundError)
  })
})
