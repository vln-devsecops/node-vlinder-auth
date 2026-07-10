import {
  AdminAddUserToGroupCommand,
  CognitoIdentityProviderClient,
} from '@aws-sdk/client-cognito-identity-provider'
import { mockClient } from 'aws-sdk-client-mock'
import { beforeEach, describe, expect, it } from 'vitest'
import { assignBaselineGroups } from './cognitoGroups'

const cognitoMock = mockClient(CognitoIdentityProviderClient)

beforeEach(() => {
  cognitoMock.reset()
})

describe('assignBaselineGroups', () => {
  it('assigns every configured baseline group to the user', async () => {
    cognitoMock.on(AdminAddUserToGroupCommand).resolves({})

    await assignBaselineGroups({
      userPoolId: 'us-east-1_example',
      username: 'jane@example.com',
      groups: ['members', 'registered-users'],
      cognitoClient: cognitoMock as unknown as CognitoIdentityProviderClient,
    })

    const calls = cognitoMock.commandCalls(AdminAddUserToGroupCommand)
    expect(calls).toHaveLength(2)
    expect(calls[0].args[0].input).toMatchObject({
      UserPoolId: 'us-east-1_example',
      Username: 'jane@example.com',
      GroupName: 'members',
    })
    expect(calls[1].args[0].input).toMatchObject({
      GroupName: 'registered-users',
    })
  })

  it('does nothing when no baseline groups are configured', async () => {
    await assignBaselineGroups({
      userPoolId: 'us-east-1_example',
      username: 'jane@example.com',
      groups: [],
      cognitoClient: cognitoMock as unknown as CognitoIdentityProviderClient,
    })

    expect(cognitoMock.commandCalls(AdminAddUserToGroupCommand)).toHaveLength(0)
  })
})
