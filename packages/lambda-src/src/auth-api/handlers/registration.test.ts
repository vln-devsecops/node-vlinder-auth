import {
  CognitoIdentityProviderClient,
  ConfirmSignUpCommand,
  ResendConfirmationCodeCommand,
  SignUpCommand,
  UsernameExistsException,
} from '@aws-sdk/client-cognito-identity-provider'
import { mockClient } from 'aws-sdk-client-mock'
import { beforeEach, describe, expect, it } from 'vitest'
import { CognitoClientError } from '../cognitoError'
import { confirmSignUp, resendConfirmation, signUp } from './registration'

const cognitoMock = mockClient(CognitoIdentityProviderClient)

beforeEach(() => {
  cognitoMock.reset()
})

const base = {
  cognitoClient: cognitoMock as unknown as CognitoIdentityProviderClient,
  clientId: 'client-abc',
}

describe('signUp', () => {
  it('signs up with the client id and required name attributes', async () => {
    cognitoMock.on(SignUpCommand).resolves({ UserSub: 'sub-1' })

    await signUp({ ...base, email: 'jane@x.com', password: 'pw', givenName: 'Jane', familyName: 'Doe' })

    expect(cognitoMock.commandCalls(SignUpCommand)[0].args[0].input).toEqual({
      ClientId: 'client-abc',
      Username: 'jane@x.com',
      Password: 'pw',
      UserAttributes: [
        { Name: 'given_name', Value: 'Jane' },
        { Name: 'family_name', Value: 'Doe' },
      ],
    })
  })

  it('maps a Cognito client-fault exception to a CognitoClientError', async () => {
    cognitoMock
      .on(SignUpCommand)
      .rejects(new UsernameExistsException({ message: 'User already exists', $metadata: {} }))

    await expect(
      signUp({ ...base, email: 'jane@x.com', password: 'pw', givenName: 'Jane', familyName: 'Doe' }),
    ).rejects.toThrow(CognitoClientError)
  })
})

describe('confirmSignUp', () => {
  it('confirms with the code', async () => {
    cognitoMock.on(ConfirmSignUpCommand).resolves({})

    await confirmSignUp({ ...base, email: 'jane@x.com', code: '123456' })

    expect(cognitoMock.commandCalls(ConfirmSignUpCommand)[0].args[0].input).toMatchObject({
      ClientId: 'client-abc',
      Username: 'jane@x.com',
      ConfirmationCode: '123456',
    })
  })
})

describe('resendConfirmation', () => {
  it('resends the confirmation code', async () => {
    cognitoMock.on(ResendConfirmationCodeCommand).resolves({})

    await resendConfirmation({ ...base, email: 'jane@x.com' })

    expect(cognitoMock.commandCalls(ResendConfirmationCodeCommand)[0].args[0].input).toMatchObject({
      ClientId: 'client-abc',
      Username: 'jane@x.com',
    })
  })
})
