import {
  CodeMismatchException,
  CognitoIdentityProviderClient,
  ConfirmForgotPasswordCommand,
  ForgotPasswordCommand,
} from '@aws-sdk/client-cognito-identity-provider'
import { mockClient } from 'aws-sdk-client-mock'
import { beforeEach, describe, expect, it } from 'vitest'
import { CognitoClientError } from '../cognitoError'
import { confirmForgotPassword, forgotPassword } from './recovery'

const cognitoMock = mockClient(CognitoIdentityProviderClient)

beforeEach(() => {
  cognitoMock.reset()
})

const base = {
  cognitoClient: cognitoMock as unknown as CognitoIdentityProviderClient,
  clientId: 'client-abc',
}

describe('forgotPassword', () => {
  it('starts the reset by client id and username', async () => {
    cognitoMock.on(ForgotPasswordCommand).resolves({})

    await forgotPassword({ ...base, email: 'jane@x.com' })

    expect(cognitoMock.commandCalls(ForgotPasswordCommand)[0].args[0].input).toMatchObject({
      ClientId: 'client-abc',
      Username: 'jane@x.com',
    })
  })
})

describe('confirmForgotPassword', () => {
  it('confirms the reset with the code and new password', async () => {
    cognitoMock.on(ConfirmForgotPasswordCommand).resolves({})

    await confirmForgotPassword({
      ...base,
      email: 'jane@x.com',
      code: '123456',
      newPassword: 'new-pw',
    })

    expect(cognitoMock.commandCalls(ConfirmForgotPasswordCommand)[0].args[0].input).toMatchObject({
      ClientId: 'client-abc',
      Username: 'jane@x.com',
      ConfirmationCode: '123456',
      Password: 'new-pw',
    })
  })

  it('maps a mismatched code to a CognitoClientError', async () => {
    cognitoMock
      .on(ConfirmForgotPasswordCommand)
      .rejects(new CodeMismatchException({ message: 'Invalid code', $metadata: {} }))

    await expect(
      confirmForgotPassword({ ...base, email: 'jane@x.com', code: 'wrong', newPassword: 'new-pw' }),
    ).rejects.toThrow(CognitoClientError)
  })
})
