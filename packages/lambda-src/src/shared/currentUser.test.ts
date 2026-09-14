import {
  CognitoIdentityProviderClient,
  GetUserCommand,
  NotAuthorizedException,
} from '@aws-sdk/client-cognito-identity-provider'
import { mockClient } from 'aws-sdk-client-mock'
import { beforeEach, describe, expect, it } from 'vitest'
import { InvalidAccessTokenError, resolveCurrentUser } from './currentUser'

const cognitoMock = mockClient(CognitoIdentityProviderClient)

beforeEach(() => {
  cognitoMock.reset()
})

describe('resolveCurrentUser', () => {
  it('resolves the sub attribute for a valid access token', async () => {
    cognitoMock.on(GetUserCommand).resolves({
      Username: 'jane@example.com',
      UserAttributes: [
        { Name: 'sub', Value: 'user-sub-123' },
        { Name: 'email', Value: 'jane@example.com' },
      ],
    })

    const result = await resolveCurrentUser(
      'access-token',
      cognitoMock as unknown as CognitoIdentityProviderClient,
    )

    expect(result).toEqual({ userId: 'user-sub-123' })
    const call = cognitoMock.commandCalls(GetUserCommand)[0]
    expect(call.args[0].input).toEqual({ AccessToken: 'access-token' })
  })

  it('rethrows a Cognito rejection as InvalidAccessTokenError', async () => {
    cognitoMock.on(GetUserCommand).rejects(new NotAuthorizedException({ message: 'invalid', $metadata: {} }))

    await expect(
      resolveCurrentUser('bad-token', cognitoMock as unknown as CognitoIdentityProviderClient),
    ).rejects.toBeInstanceOf(InvalidAccessTokenError)
  })

  it('throws InvalidAccessTokenError when the response carries no sub attribute', async () => {
    cognitoMock.on(GetUserCommand).resolves({
      Username: 'jane@example.com',
      UserAttributes: [{ Name: 'email', Value: 'jane@example.com' }],
    })

    await expect(
      resolveCurrentUser('access-token', cognitoMock as unknown as CognitoIdentityProviderClient),
    ).rejects.toBeInstanceOf(InvalidAccessTokenError)
  })
})
