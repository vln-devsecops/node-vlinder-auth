import { DynamoDBDocumentClient, GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb'
import type { PreTokenGenerationV2TriggerEvent } from 'aws-lambda'
import { mockClient } from 'aws-sdk-client-mock'
import { beforeEach, describe, expect, it } from 'vitest'
import * as recordingHook from './__fixtures__/recordingHook'
import { handler } from './handler'

const ddbMock = mockClient(DynamoDBDocumentClient)

const baseEnv = {
  ROLE_ASSIGNMENTS_TABLE_NAME: 'role-assignments-table',
  ROLES_TABLE_NAME: 'roles-table',
}

function buildEvent(): PreTokenGenerationV2TriggerEvent {
  return {
    version: '2',
    region: 'us-east-1',
    userPoolId: 'us-east-1_example',
    userName: 'jane@example.com',
    callerContext: { awsSdkVersion: '', clientId: '' },
    triggerSource: 'TokenGeneration_HostedAuth',
    request: {
      userAttributes: { sub: 'user-123', email: 'jane@example.com' },
      groupConfiguration: {},
    },
    response: {
      // Cognito really does send this as null in the live V2 event -- the
      // trigger must construct the whole object. A pre-populated fixture
      // here hid a null-dereference crash that only surfaced in the live
      // e2e suite; keep this matching reality.
      claimsAndScopeOverrideDetails: null,
    },
  } as unknown as PreTokenGenerationV2TriggerEvent
}

beforeEach(() => {
  ddbMock.reset()
  recordingHook.calls.length = 0
  process.env = { ...baseEnv }
})

describe('pre-token-generation handler', () => {
  it('injects identical scope and tenants claims on both tokens when every held role is default-activation', async () => {
    ddbMock.on(QueryCommand).resolves({
      Items: [{ userId: 'user-123', tenantId: 'acme-corp', roleId: 'tenant-admin' }],
    })
    ddbMock.on(GetCommand).resolves({
      Item: {
        roleId: 'tenant-admin',
        privileges: ['read:acme-corp:users', 'write:acme-corp:users'],
        tenantScope: 'tenant',
      },
    })

    const result = await handler(buildEvent())

    const idClaims =
      result.response.claimsAndScopeOverrideDetails.idTokenGeneration?.claimsToAddOrOverride
    const accessClaims =
      result.response.claimsAndScopeOverrideDetails.accessTokenGeneration?.claimsToAddOrOverride

    expect(idClaims).toEqual({
      scope: 'read:acme-corp:users write:acme-corp:users',
      tenants: 'acme-corp',
    })
    expect(accessClaims).toEqual({
      scope: 'read:acme-corp:users write:acme-corp:users',
      tenants: 'acme-corp',
    })
  })

  it('puts a held-but-inactive privilege on the ID token and never on the access token', async () => {
    ddbMock.on(QueryCommand).resolves({
      Items: [
        { userId: 'user-123', tenantId: 'acme-corp', roleId: 'reader', activation: 'default' },
        { userId: 'user-123', tenantId: 'acme-corp', roleId: 'superadmin', activation: 'elevated' },
      ],
    })
    ddbMock.on(GetCommand, { Key: { roleId: 'reader' } }).resolves({
      Item: { roleId: 'reader', privileges: ['read:acme-corp:users'], tenantScope: 'tenant' },
    })
    ddbMock.on(GetCommand, { Key: { roleId: 'superadmin' } }).resolves({
      Item: { roleId: 'superadmin', privileges: ['write:*:users'], tenantScope: 'global' },
    })

    const result = await handler(buildEvent())

    const idClaims =
      result.response.claimsAndScopeOverrideDetails.idTokenGeneration?.claimsToAddOrOverride
    const accessClaims =
      result.response.claimsAndScopeOverrideDetails.accessTokenGeneration?.claimsToAddOrOverride

    // Held-but-inactive (elevated) privilege: on the ID token...
    expect(idClaims?.scope).toContain('write:*:users')
    // ...and never on the access token.
    expect(accessClaims?.scope).not.toContain('write:*:users')
    expect(accessClaims?.scope).toBe('read:acme-corp:users')

    // The tenants claim is unaffected by activation state -- identical on both.
    expect(idClaims?.tenants).toBe(accessClaims?.tenants)
    expect(idClaims?.tenants).toBe('acme-corp')
  })

  it('space-joins the tenants claim for a user logged in on more than one tenant', async () => {
    ddbMock.on(QueryCommand).resolves({
      Items: [
        { userId: 'user-123', tenantId: 'acme-corp', roleId: 'tenant-admin' },
        { userId: 'user-123', tenantId: 'globex', roleId: 'member' },
      ],
    })
    ddbMock.on(GetCommand, { Key: { roleId: 'tenant-admin' } }).resolves({
      Item: { roleId: 'tenant-admin', privileges: ['read:users'], tenantScope: 'tenant' },
    })
    ddbMock.on(GetCommand, { Key: { roleId: 'member' } }).resolves({
      Item: { roleId: 'member', privileges: ['read:users'], tenantScope: 'tenant' },
    })

    const result = await handler(buildEvent())

    const idClaims =
      result.response.claimsAndScopeOverrideDetails.idTokenGeneration?.claimsToAddOrOverride
    expect(idClaims?.tenants).toBe('acme-corp globex')
    expect(idClaims?.scope).toBe('read:acme-corp:users read:globex:users')
  })

  it('never puts the role name itself into the token claims', async () => {
    ddbMock.on(QueryCommand).resolves({
      Items: [{ userId: 'user-123', tenantId: 'acme-corp', roleId: 'tenant-admin' }],
    })
    ddbMock.on(GetCommand).resolves({
      Item: { roleId: 'tenant-admin', privileges: ['read:acme-corp:users'], tenantScope: 'tenant' },
    })

    const result = await handler(buildEvent())

    const idClaims =
      result.response.claimsAndScopeOverrideDetails.idTokenGeneration?.claimsToAddOrOverride
    expect(Object.keys(idClaims ?? {})).not.toContain('role')
    expect(Object.values(idClaims ?? {})).not.toContain('tenant-admin')
  })

  it('sets no claims when the user has no role assignment', async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [] })

    const result = await handler(buildEvent())

    expect(
      result.response.claimsAndScopeOverrideDetails?.idTokenGeneration?.claimsToAddOrOverride,
    ).toBeUndefined()
  })

  it('invokes the configured optional hook with the event and resolved privileges', async () => {
    process.env.HOOK_MODULE_PATH = '../pre-token-generation/__fixtures__/recordingHook'
    ddbMock.on(QueryCommand).resolves({
      Items: [{ userId: 'user-123', tenantId: 'acme-corp', roleId: 'tenant-admin' }],
    })
    ddbMock.on(GetCommand).resolves({
      Item: { roleId: 'tenant-admin', privileges: ['read:acme-corp:users'], tenantScope: 'tenant' },
    })

    const event = buildEvent()
    await handler(event)

    expect(recordingHook.calls).toEqual([
      {
        event,
        context: {
          tenants: ['acme-corp'],
          roleIds: ['tenant-admin'],
          privileges: ['read:acme-corp:users'],
        },
      },
    ])
  })
})
