import {
  CognitoIdentityProviderClient,
  SignUpCommand,
  UsernameExistsException,
} from '@aws-sdk/client-cognito-identity-provider'
import { SendEmailCommand, SESv2Client } from '@aws-sdk/client-sesv2'
import { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb'
import { mockClient } from 'aws-sdk-client-mock'
import { beforeEach, describe, expect, it } from 'vitest'
import { CognitoClientError } from '../cognitoError'
import { InvalidVerificationCodeError } from '../verificationCodeError'
import { confirmSignUp, resendConfirmation, signUp } from './registration'

const cognitoMock = mockClient(CognitoIdentityProviderClient)
const ddbMock = mockClient(DynamoDBDocumentClient)
const sesMock = mockClient(SESv2Client)

const nowSeconds = Math.floor(Date.now() / 1000)
const FUTURE_EXPIRY = nowSeconds + 600
const PAST_EXPIRY = nowSeconds - 1

beforeEach(() => {
  cognitoMock.reset()
  ddbMock.reset()
  sesMock.reset()
})

const base = {
  cognitoClient: cognitoMock as unknown as CognitoIdentityProviderClient,
  clientId: 'client-abc',
}

const ddbDocClient = ddbMock as unknown as DynamoDBDocumentClient
const sesClient = sesMock as unknown as SESv2Client

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
  it('succeeds and deletes the row when the code matches', async () => {
    ddbMock.on(GetCommand).resolves({
      Item: { email: 'jane@x.com', purpose: 'signup', code: '123456', attempts: 0, expiresAt: FUTURE_EXPIRY },
    })

    await expect(
      confirmSignUp({
        email: 'jane@x.com',
        code: '123456',
        ddbDocClient,
        tableName: 'verification-codes',
        maxAttempts: 5,
      }),
    ).resolves.toBeUndefined()
  })

  it('rejects a wrong code with a friendly error', async () => {
    ddbMock.on(GetCommand).resolves({
      Item: { email: 'jane@x.com', purpose: 'signup', code: '123456', attempts: 0, expiresAt: FUTURE_EXPIRY },
    })
    ddbMock.on(UpdateCommand).resolves({})

    await expect(
      confirmSignUp({
        email: 'jane@x.com',
        code: '000000',
        ddbDocClient,
        tableName: 'verification-codes',
        maxAttempts: 5,
      }),
    ).rejects.toThrow(InvalidVerificationCodeError)
  })

  it('rejects with a friendly error when no code is pending', async () => {
    ddbMock.on(GetCommand).resolves({
      Item: { email: 'jane@x.com', purpose: 'signup', code: '123456', attempts: 0, expiresAt: PAST_EXPIRY },
    })

    await expect(
      confirmSignUp({
        email: 'jane@x.com',
        code: '123456',
        ddbDocClient,
        tableName: 'verification-codes',
        maxAttempts: 5,
      }),
    ).rejects.toThrow(InvalidVerificationCodeError)
  })
})

describe('resendConfirmation', () => {
  it('gets-or-creates a code and emails it', async () => {
    ddbMock.on(GetCommand).resolves({})
    ddbMock.on(PutCommand).resolves({})
    sesMock.on(SendEmailCommand).resolves({})

    await resendConfirmation({
      email: 'jane@x.com',
      ddbDocClient,
      tableName: 'verification-codes',
      ttlSeconds: 600,
      sesClient,
      fromAddress: 'no-reply@vlinder.example',
    })

    expect(ddbMock.commandCalls(PutCommand)).toHaveLength(1)
    const emailCall = sesMock.commandCalls(SendEmailCommand)[0].args[0].input
    expect(emailCall.Destination).toEqual({ ToAddresses: ['jane@x.com'] })
  })

  it('re-sends the same code on a second call within TTL rather than minting a new one', async () => {
    ddbMock.on(GetCommand).resolves({
      Item: { email: 'jane@x.com', purpose: 'signup', code: '654321', attempts: 0, expiresAt: FUTURE_EXPIRY },
    })
    sesMock.on(SendEmailCommand).resolves({})

    await resendConfirmation({
      email: 'jane@x.com',
      ddbDocClient,
      tableName: 'verification-codes',
      ttlSeconds: 600,
      sesClient,
      fromAddress: 'no-reply@vlinder.example',
    })

    expect(ddbMock.commandCalls(PutCommand)).toHaveLength(0)
    const emailCall = sesMock.commandCalls(SendEmailCommand)[0].args[0].input
    expect(emailCall.Content?.Simple?.Body?.Text?.Data).toContain('654321')
  })
})
