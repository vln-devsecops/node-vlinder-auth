import {
  AdminInitiateAuthCommand,
  CognitoIdentityProviderClient,
  NotAuthorizedException,
  UserNotFoundException,
} from '@aws-sdk/client-cognito-identity-provider'
import { mockClient } from 'aws-sdk-client-mock'
import { beforeEach, describe, expect, it } from 'vitest'
import { signSession, verifySession } from '../session'
import { AuthFailedError, InvalidSessionError, password } from './password'

const KEY = 'test-signing-key-000000000000000000000000'
const cognitoMock = mockClient(CognitoIdentityProviderClient)

beforeEach(() => {
  cognitoMock.reset()
})

const base = {
  cognitoClient: cognitoMock as unknown as CognitoIdentityProviderClient,
  clientId: 'client-abc',
  userPoolId: 'us-east-1_example',
  signingKey: KEY,
}

function identifySessionFor(identifier: string): string {
  return signSession({ identifier, method: 'password' }, KEY, 300)
}

describe('password', () => {
  it('authenticates valid credentials and establishes an AS session', async () => {
    cognitoMock
      .on(AdminInitiateAuthCommand)
      .resolves({ AuthenticationResult: { AccessToken: 'a', IdToken: 'i', RefreshToken: 'r' } })

    const result = await password({
      ...base,
      identifySession: identifySessionFor('jane@example.com'),
      password: 'correct horse',
    })

    expect(result.status).toBe('authenticated')
    if (result.status !== 'authenticated') return
    expect(result.username).toBe('jane@example.com')
    expect(verifySession(result.asSession, KEY)).toMatchObject({
      username: 'jane@example.com',
      typ: 'as',
    })

    const call = cognitoMock.commandCalls(AdminInitiateAuthCommand)[0]
    expect(call.args[0].input).toMatchObject({
      UserPoolId: 'us-east-1_example',
      ClientId: 'client-abc',
      AuthFlow: 'ADMIN_USER_PASSWORD_AUTH',
      AuthParameters: { USERNAME: 'jane@example.com', PASSWORD: 'correct horse' },
    })
  })

  it('surfaces a Cognito challenge instead of an AS session', async () => {
    cognitoMock
      .on(AdminInitiateAuthCommand)
      .resolves({ ChallengeName: 'NEW_PASSWORD_REQUIRED', Session: 'cognito-session-token' })

    const result = await password({
      ...base,
      identifySession: identifySessionFor('jane@example.com'),
      password: 'temp',
    })

    expect(result).toEqual({
      status: 'challenge',
      challengeName: 'NEW_PASSWORD_REQUIRED',
      challengeSession: 'cognito-session-token',
    })
  })

  it('rejects a missing or expired identify session', async () => {
    await expect(
      password({ ...base, identifySession: undefined, password: 'x' }),
    ).rejects.toThrow(InvalidSessionError)
    expect(cognitoMock.commandCalls(AdminInitiateAuthCommand)).toHaveLength(0)
  })

  it('collapses wrong-password and unknown-user into one opaque failure', async () => {
    cognitoMock
      .on(AdminInitiateAuthCommand)
      .rejectsOnce(new NotAuthorizedException({ message: 'nope', $metadata: {} }))
      .rejectsOnce(new UserNotFoundException({ message: 'nope', $metadata: {} }))

    for (let i = 0; i < 2; i++) {
      await expect(
        password({
          ...base,
          identifySession: identifySessionFor('jane@example.com'),
          password: 'wrong',
        }),
      ).rejects.toThrow(AuthFailedError)
    }
  })
})
