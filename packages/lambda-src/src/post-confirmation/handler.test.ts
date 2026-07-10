import {
  AdminAddUserToGroupCommand,
  CognitoIdentityProviderClient,
} from '@aws-sdk/client-cognito-identity-provider'
import { DynamoDBDocumentClient, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb'
import type { PostConfirmationTriggerEvent } from 'aws-lambda'
import { mockClient } from 'aws-sdk-client-mock'
import { beforeEach, describe, expect, it } from 'vitest'
import * as recordingHook from './__fixtures__/recordingHook'
import { handler } from './handler'

const ddbMock = mockClient(DynamoDBDocumentClient)
const cognitoMock = mockClient(CognitoIdentityProviderClient)

const baseEnv = {
  DEFAULT_TENANT_ID: 'default',
  DEFAULT_ROLE_ID: 'member',
  TENANTS_TABLE_NAME: 'tenants-table',
  ROLE_ASSIGNMENTS_TABLE_NAME: 'role-assignments-table',
  USER_POOL_ID: 'us-east-1_example',
  BASELINE_GROUPS: 'members',
}

function buildEvent(
  overrides: Partial<PostConfirmationTriggerEvent> = {},
): PostConfirmationTriggerEvent {
  return {
    version: '1',
    region: 'us-east-1',
    userPoolId: 'us-east-1_example',
    userName: 'jane@example.com',
    callerContext: { awsSdkVersion: '', clientId: '' },
    triggerSource: 'PostConfirmation_ConfirmSignUp',
    request: {
      userAttributes: {
        sub: 'user-123',
        email: 'jane@example.com',
      },
    },
    response: {},
    ...overrides,
  } as PostConfirmationTriggerEvent
}

beforeEach(() => {
  ddbMock.reset()
  cognitoMock.reset()
  recordingHook.calls.length = 0
  process.env = { ...baseEnv }
})

describe('post-confirmation handler', () => {
  it('single-tenant mode: assigns the default tenant, writes a role assignment, and assigns baseline groups', async () => {
    ddbMock.on(PutCommand).resolves({})
    cognitoMock.on(AdminAddUserToGroupCommand).resolves({})

    await handler(buildEvent())

    expect(ddbMock.commandCalls(QueryCommand)).toHaveLength(0)
    const putCall = ddbMock.commandCalls(PutCommand)[0]
    expect(putCall.args[0].input).toMatchObject({
      TableName: 'role-assignments-table',
      Item: { userId: 'user-123', tenantId: 'default', roleId: 'member' },
    })

    const groupCall = cognitoMock.commandCalls(AdminAddUserToGroupCommand)[0]
    expect(groupCall.args[0].input).toMatchObject({
      UserPoolId: 'us-east-1_example',
      Username: 'jane@example.com',
      GroupName: 'members',
    })
  })

  it('multi-tenant mode: resolves the tenant via the configured lookup before writing the role assignment', async () => {
    process.env.TENANCY_MODE = 'multi'
    ddbMock.on(QueryCommand).resolves({ Items: [{ tenantId: 'acme-corp' }] })
    ddbMock.on(PutCommand).resolves({})
    cognitoMock.on(AdminAddUserToGroupCommand).resolves({})

    await handler(buildEvent())

    const putCall = ddbMock.commandCalls(PutCommand)[0]
    expect(putCall.args[0].input).toMatchObject({
      Item: { userId: 'user-123', tenantId: 'acme-corp', roleId: 'member' },
    })
  })

  it('ignores trigger sources other than PostConfirmation_ConfirmSignUp', async () => {
    const event = buildEvent({
      triggerSource: 'PostConfirmation_ConfirmForgotPassword',
    })

    const result = await handler(event)

    expect(result).toBe(event)
    expect(ddbMock.commandCalls(PutCommand)).toHaveLength(0)
    expect(cognitoMock.commandCalls(AdminAddUserToGroupCommand)).toHaveLength(0)
  })

  it('invokes the configured optional hook with the event and resolved tenant/role context', async () => {
    // Dynamic import() inside the shared hook.ts helper resolves relative to
    // its own location (src/shared/), not the handler's directory -- hence
    // the "../post-confirmation" hop back to this fixture.
    process.env.HOOK_MODULE_PATH = '../post-confirmation/__fixtures__/recordingHook'
    ddbMock.on(PutCommand).resolves({})
    cognitoMock.on(AdminAddUserToGroupCommand).resolves({})

    const event = buildEvent()
    await handler(event)

    expect(recordingHook.calls).toEqual([
      { event, context: { tenantId: 'default', roleId: 'member' } },
    ])
  })
})
