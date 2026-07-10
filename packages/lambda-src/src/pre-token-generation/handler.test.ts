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
      claimsAndScopeOverrideDetails: {
        idTokenGeneration: {},
        accessTokenGeneration: {},
      },
    },
  } as PreTokenGenerationV2TriggerEvent
}

beforeEach(() => {
  ddbMock.reset()
  recordingHook.calls.length = 0
  process.env = { ...baseEnv }
})

describe('pre-token-generation handler', () => {
  it('injects the resolved privileges and tenantId as claims on both the id and access tokens', async () => {
    ddbMock.on(QueryCommand).resolves({
      Items: [{ userId: 'user-123', tenantId: 'acme-corp', roleId: 'tenant-admin' }],
    })
    ddbMock.on(GetCommand).resolves({
      Item: {
        roleId: 'tenant-admin',
        privileges: ['users:read:own', 'users:write:own'],
        tenantScope: 'tenant',
      },
    })

    const result = await handler(buildEvent())

    const idClaims =
      result.response.claimsAndScopeOverrideDetails.idTokenGeneration?.claimsToAddOrOverride
    const accessClaims =
      result.response.claimsAndScopeOverrideDetails.accessTokenGeneration?.claimsToAddOrOverride

    expect(idClaims).toEqual({
      permissions: 'users:read:own,users:write:own',
      tenantId: 'acme-corp',
    })
    expect(accessClaims).toEqual({
      permissions: 'users:read:own,users:write:own',
      tenantId: 'acme-corp',
    })
  })

  it('never puts the role name itself into the token claims', async () => {
    ddbMock.on(QueryCommand).resolves({
      Items: [{ userId: 'user-123', tenantId: 'acme-corp', roleId: 'tenant-admin' }],
    })
    ddbMock.on(GetCommand).resolves({
      Item: { roleId: 'tenant-admin', privileges: ['users:read:own'], tenantScope: 'tenant' },
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
      result.response.claimsAndScopeOverrideDetails.idTokenGeneration?.claimsToAddOrOverride,
    ).toBeUndefined()
  })

  it('invokes the configured optional hook with the event and resolved privileges', async () => {
    process.env.HOOK_MODULE_PATH = '../pre-token-generation/__fixtures__/recordingHook'
    ddbMock.on(QueryCommand).resolves({
      Items: [{ userId: 'user-123', tenantId: 'acme-corp', roleId: 'tenant-admin' }],
    })
    ddbMock.on(GetCommand).resolves({
      Item: { roleId: 'tenant-admin', privileges: ['users:read:own'], tenantScope: 'tenant' },
    })

    const event = buildEvent()
    await handler(event)

    expect(recordingHook.calls).toEqual([
      {
        event,
        context: { tenantId: 'acme-corp', roleId: 'tenant-admin', privileges: ['users:read:own'] },
      },
    ])
  })
})
