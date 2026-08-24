import {
  AdminGetUserCommand,
  AdminSetUserPasswordCommand,
  CognitoIdentityProviderClient,
  InvalidPasswordException,
  UserNotFoundException,
} from '@aws-sdk/client-cognito-identity-provider'
import { SendEmailCommand, SESv2Client } from '@aws-sdk/client-sesv2'
import { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb'
import { mockClient } from 'aws-sdk-client-mock'
import { beforeEach, describe, expect, it } from 'vitest'
import { CognitoClientError } from '../cognitoError'
import { InvalidVerificationCodeError } from '../verificationCodeError'
import { confirmForgotPassword, forgotPassword } from './recovery'

const cognitoMock = mockClient(CognitoIdentityProviderClient)
const ddbMock = mockClient(DynamoDBDocumentClient)
const sesMock = mockClient(SESv2Client)

const nowSeconds = Math.floor(Date.now() / 1000)
const FUTURE_EXPIRY = nowSeconds + 600

beforeEach(() => {
  cognitoMock.reset()
  ddbMock.reset()
  sesMock.reset()
})

const base = {
  cognitoClient: cognitoMock as unknown as CognitoIdentityProviderClient,
  userPoolId: 'us-east-1_example',
  ddbDocClient: ddbMock as unknown as DynamoDBDocumentClient,
  tableName: 'verification-codes',
}

const sesClient = sesMock as unknown as SESv2Client

describe('forgotPassword', () => {
  it('sends a code when the account exists', async () => {
    cognitoMock.on(AdminGetUserCommand).resolves({ Username: 'jane@x.com' })
    ddbMock.on(GetCommand).resolves({})
    ddbMock.on(PutCommand).resolves({})
    sesMock.on(SendEmailCommand).resolves({})

    await forgotPassword({
      ...base,
      email: 'jane@x.com',
      ttlSeconds: 600,
      sesClient,
      fromAddress: 'no-reply@vlinder.example',
    })

    expect(sesMock.commandCalls(SendEmailCommand)).toHaveLength(1)
  })

  it('responds identically (no code sent) when the account does not exist', async () => {
    cognitoMock
      .on(AdminGetUserCommand)
      .rejects(new UserNotFoundException({ message: 'no', $metadata: {} }))

    await expect(
      forgotPassword({
        ...base,
        email: 'nobody@x.com',
        ttlSeconds: 600,
        sesClient,
        fromAddress: 'no-reply@vlinder.example',
      }),
    ).resolves.toBeUndefined()

    expect(sesMock.commandCalls(SendEmailCommand)).toHaveLength(0)
    expect(ddbMock.commandCalls(PutCommand)).toHaveLength(0)
  })
})

describe('confirmForgotPassword', () => {
  it('sets the new password permanently once the code checks out', async () => {
    ddbMock.on(GetCommand).resolves({
      Item: {
        email: 'jane@x.com',
        purpose: 'password-reset',
        code: '123456',
        attempts: 0,
        expiresAt: FUTURE_EXPIRY,
      },
    })
    cognitoMock.on(AdminSetUserPasswordCommand).resolves({})

    await confirmForgotPassword({
      ...base,
      email: 'jane@x.com',
      code: '123456',
      newPassword: 'new-pw',
      maxAttempts: 5,
    })

    expect(cognitoMock.commandCalls(AdminSetUserPasswordCommand)[0].args[0].input).toMatchObject({
      UserPoolId: 'us-east-1_example',
      Username: 'jane@x.com',
      Password: 'new-pw',
      Permanent: true,
    })
  })

  it('rejects a wrong code without touching Cognito', async () => {
    ddbMock.on(GetCommand).resolves({
      Item: {
        email: 'jane@x.com',
        purpose: 'password-reset',
        code: '123456',
        attempts: 0,
        expiresAt: FUTURE_EXPIRY,
      },
    })
    ddbMock.on(UpdateCommand).resolves({})

    await expect(
      confirmForgotPassword({
        ...base,
        email: 'jane@x.com',
        code: '000000',
        newPassword: 'new-pw',
        maxAttempts: 5,
      }),
    ).rejects.toThrow(InvalidVerificationCodeError)
    expect(cognitoMock.commandCalls(AdminSetUserPasswordCommand)).toHaveLength(0)
  })

  it('maps a weak-password rejection from Cognito to a CognitoClientError', async () => {
    ddbMock.on(GetCommand).resolves({
      Item: {
        email: 'jane@x.com',
        purpose: 'password-reset',
        code: '123456',
        attempts: 0,
        expiresAt: FUTURE_EXPIRY,
      },
    })
    cognitoMock
      .on(AdminSetUserPasswordCommand)
      .rejects(new InvalidPasswordException({ message: 'Password too weak', $metadata: {} }))

    await expect(
      confirmForgotPassword({
        ...base,
        email: 'jane@x.com',
        code: '123456',
        newPassword: 'weak',
        maxAttempts: 5,
      }),
    ).rejects.toThrow(CognitoClientError)
  })
})
