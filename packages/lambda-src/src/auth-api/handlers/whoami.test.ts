import {
  CognitoIdentityProviderClient,
  GetUserCommand,
  NotAuthorizedException,
} from '@aws-sdk/client-cognito-identity-provider'
import { DynamoDBDocumentClient, GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb'
import { mockClient } from 'aws-sdk-client-mock'
import { beforeEach, describe, expect, it } from 'vitest'
import { InvalidAccessTokenError } from '../../shared/currentUser'
import { MissingAccessTokenError, whoami } from './whoami'

const cognitoMock = mockClient(CognitoIdentityProviderClient)
const ddbMock = mockClient(DynamoDBDocumentClient)

beforeEach(() => {
  cognitoMock.reset()
  ddbMock.reset()
})

const base = {
  cognitoClient: cognitoMock as unknown as CognitoIdentityProviderClient,
  roleAssignmentsTableName: 'role-assignments',
  rolesTableName: 'roles',
  tenantsTableName: 'tenants-table',
  authAppTenantId: 'auth',
  ddbDocClient: ddbMock as unknown as DynamoDBDocumentClient,
}

function mockValidUser(sub = 'user-sub-123'): void {
  cognitoMock.on(GetUserCommand).resolves({
    Username: sub,
    UserAttributes: [{ Name: 'sub', Value: sub }],
  })
}

describe('whoami', () => {
  it('throws MissingAccessTokenError when no cookie was presented', async () => {
    await expect(whoami({ ...base, accessToken: undefined })).rejects.toBeInstanceOf(
      MissingAccessTokenError,
    )
    expect(cognitoMock.commandCalls(GetUserCommand)).toHaveLength(0)
  })

  it('throws InvalidAccessTokenError when Cognito rejects the token', async () => {
    cognitoMock.on(GetUserCommand).rejects(new NotAuthorizedException({ message: 'bad', $metadata: {} }))

    await expect(whoami({ ...base, accessToken: 'bad-token' })).rejects.toBeInstanceOf(
      InvalidAccessTokenError,
    )
  })

  it('returns active/held privileges split and an empty profile when no row exists', async () => {
    mockValidUser()
    ddbMock.on(QueryCommand).resolves({
      Items: [
        { userId: 'user-sub-123', tenantRole: 'acme#viewer', tenantId: 'acme', roleId: 'viewer', activation: 'default' },
        { userId: 'user-sub-123', tenantRole: 'acme#admin', tenantId: 'acme', roleId: 'admin', activation: 'elevated' },
      ],
    })
    ddbMock.on(GetCommand).resolves({
      Item: { roleId: 'viewer', tenantScope: 'tenant', privileges: ['read:*:orders'] },
    })
    // Distinguish role-definition lookups by roleId via callback matching.
    ddbMock
      .on(GetCommand, { TableName: 'roles', Key: { roleId: 'viewer' } })
      .resolves({ Item: { roleId: 'viewer', tenantScope: 'tenant', privileges: ['read:*:orders'] } })
    ddbMock
      .on(GetCommand, { TableName: 'roles', Key: { roleId: 'admin' } })
      .resolves({ Item: { roleId: 'admin', tenantScope: 'tenant', privileges: ['refund:*:orders'] } })
    // No profile row.
    ddbMock
      .on(GetCommand, { TableName: 'tenants-table', Key: { tenantId: 'auth', sk: 'USERPROFILE#user-sub-123' } })
      .resolves({})

    const result = await whoami({ ...base, accessToken: 'good-token' })

    expect(result.active).toEqual(['read:acme:orders'])
    expect(result.held).toEqual(['refund:acme:orders'])
    // held must never repeat anything already active.
    expect(result.held).not.toContain('read:acme:orders')
    expect(result.profile).toEqual({})
  })

  it('excludes an identically-named privilege from held when also active', async () => {
    mockValidUser()
    ddbMock.on(QueryCommand).resolves({
      Items: [
        { userId: 'user-sub-123', tenantRole: 'acme#viewer', tenantId: 'acme', roleId: 'viewer', activation: 'default' },
        { userId: 'user-sub-123', tenantRole: 'acme#viewer2', tenantId: 'acme', roleId: 'viewer2', activation: 'elevated' },
      ],
    })
    ddbMock
      .on(GetCommand, { TableName: 'roles', Key: { roleId: 'viewer' } })
      .resolves({ Item: { roleId: 'viewer', tenantScope: 'tenant', privileges: ['read:*:orders'] } })
    ddbMock
      .on(GetCommand, { TableName: 'roles', Key: { roleId: 'viewer2' } })
      .resolves({ Item: { roleId: 'viewer2', tenantScope: 'tenant', privileges: ['read:*:orders'] } })
    ddbMock
      .on(GetCommand, { TableName: 'tenants-table', Key: { tenantId: 'auth', sk: 'USERPROFILE#user-sub-123' } })
      .resolves({})

    const result = await whoami({ ...base, accessToken: 'good-token' })

    expect(result.active).toEqual(['read:acme:orders'])
    expect(result.held).toEqual([])
  })

  it('returns the profile row when one exists', async () => {
    mockValidUser()
    ddbMock.on(QueryCommand).resolves({ Items: [] })
    ddbMock
      .on(GetCommand, { TableName: 'tenants-table', Key: { tenantId: 'auth', sk: 'USERPROFILE#user-sub-123' } })
      .resolves({
        Item: {
          tenantId: 'auth',
          sk: 'USERPROFILE#user-sub-123',
          displayName: 'Jane Doe',
          avatarUrl: 'https://example.com/a.png',
        },
      })

    const result = await whoami({ ...base, accessToken: 'good-token' })

    expect(result.active).toEqual([])
    expect(result.held).toEqual([])
    expect(result.profile).toEqual({ displayName: 'Jane Doe', avatarUrl: 'https://example.com/a.png' })
  })
})
