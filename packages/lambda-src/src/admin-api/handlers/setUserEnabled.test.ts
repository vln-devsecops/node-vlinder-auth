import {
  AdminDisableUserCommand,
  AdminEnableUserCommand,
  CognitoIdentityProviderClient,
} from '@aws-sdk/client-cognito-identity-provider'
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb'
import { mockClient } from 'aws-sdk-client-mock'
import { beforeEach, describe, expect, it } from 'vitest'
import { ForbiddenError } from '../authz'
import { NotFoundError } from './getUser'
import { setUserEnabled } from './setUserEnabled'

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

describe('setUserEnabled', () => {
  it('disables a user in the caller\'s own tenant', async () => {
    ddbMock
      .on(QueryCommand)
      .resolves({ Items: [{ userId: 'user-1', tenantId: 'acme-corp', roleId: 'member' }] })
    cognitoMock.on(AdminDisableUserCommand).resolves({})

    await setUserEnabled({
      caller: { tenantId: 'acme-corp', privileges: ['admin:users:write:own'] },
      targetUserId: 'user-1',
      enabled: false,
      ...commonParams,
    })

    const call = cognitoMock.commandCalls(AdminDisableUserCommand)[0]
    expect(call.args[0].input).toMatchObject({
      UserPoolId: 'us-east-1_example',
      Username: 'user-1',
    })
  })

  it('enables a user via AdminEnableUserCommand when enabled=true', async () => {
    ddbMock
      .on(QueryCommand)
      .resolves({ Items: [{ userId: 'user-1', tenantId: 'acme-corp', roleId: 'member' }] })
    cognitoMock.on(AdminEnableUserCommand).resolves({})

    await setUserEnabled({
      caller: { tenantId: 'acme-corp', privileges: ['admin:users:write:own'] },
      targetUserId: 'user-1',
      enabled: true,
      ...commonParams,
    })

    expect(cognitoMock.commandCalls(AdminEnableUserCommand)).toHaveLength(1)
    expect(cognitoMock.commandCalls(AdminDisableUserCommand)).toHaveLength(0)
  })

  it('rejects an "own"-scoped caller acting on a different tenant\'s user', async () => {
    ddbMock
      .on(QueryCommand)
      .resolves({ Items: [{ userId: 'user-2', tenantId: 'globex', roleId: 'member' }] })

    await expect(
      setUserEnabled({
        caller: { tenantId: 'acme-corp', privileges: ['admin:users:write:own'] },
        targetUserId: 'user-2',
        enabled: false,
        ...commonParams,
      }),
    ).rejects.toThrow(ForbiddenError)

    expect(cognitoMock.commandCalls(AdminDisableUserCommand)).toHaveLength(0)
  })

  it('rejects a caller holding only the read privilege, not write', async () => {
    ddbMock
      .on(QueryCommand)
      .resolves({ Items: [{ userId: 'user-1', tenantId: 'acme-corp', roleId: 'member' }] })

    await expect(
      setUserEnabled({
        caller: { tenantId: 'acme-corp', privileges: ['admin:users:read:own'] },
        targetUserId: 'user-1',
        enabled: false,
        ...commonParams,
      }),
    ).rejects.toThrow(ForbiddenError)
  })

  it('throws NotFoundError when the target user has no role assignment', async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [] })

    await expect(
      setUserEnabled({
        caller: { tenantId: 'acme-corp', privileges: ['admin:users:write:*'] },
        targetUserId: 'ghost-user',
        enabled: false,
        ...commonParams,
      }),
    ).rejects.toThrow(NotFoundError)
  })
})
