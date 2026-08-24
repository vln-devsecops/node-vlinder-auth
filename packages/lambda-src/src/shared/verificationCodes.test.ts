import {
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb'
import { mockClient } from 'aws-sdk-client-mock'
import { beforeEach, describe, expect, it } from 'vitest'
import { generateCode, getOrCreateCode, hasPendingCode, verifyCode } from './verificationCodes'

const ddbMock = mockClient(DynamoDBDocumentClient)
const ddbDocClient = ddbMock as unknown as DynamoDBDocumentClient

const nowSeconds = Math.floor(Date.now() / 1000)
const FUTURE_EXPIRY = nowSeconds + 600
const PAST_EXPIRY = nowSeconds - 1

beforeEach(() => {
  ddbMock.reset()
})

describe('generateCode', () => {
  it('generates a 6-digit numeric code', () => {
    for (let i = 0; i < 20; i++) {
      expect(generateCode()).toMatch(/^\d{6}$/)
    }
  })
})

describe('getOrCreateCode', () => {
  it('generates and stores a new code when none exists', async () => {
    ddbMock.on(GetCommand).resolves({})
    ddbMock.on(PutCommand).resolves({})

    const code = await getOrCreateCode({
      email: 'jane@x.com',
      purpose: 'signup',
      ddbDocClient,
      tableName: 'verification-codes',
      ttlSeconds: 600,
    })

    expect(code).toMatch(/^\d{6}$/)
    const putCall = ddbMock.commandCalls(PutCommand)[0]
    expect(putCall.args[0].input).toMatchObject({
      TableName: 'verification-codes',
      Item: { email: 'jane@x.com', purpose: 'signup', code, attempts: 0 },
    })
  })

  it('returns the existing code unchanged on a second call within TTL', async () => {
    ddbMock.on(GetCommand).resolves({
      Item: { email: 'jane@x.com', purpose: 'signup', code: '123456', attempts: 0, expiresAt: FUTURE_EXPIRY },
    })

    const code = await getOrCreateCode({
      email: 'jane@x.com',
      purpose: 'signup',
      ddbDocClient,
      tableName: 'verification-codes',
      ttlSeconds: 600,
    })

    expect(code).toBe('123456')
    expect(ddbMock.commandCalls(PutCommand)).toHaveLength(0)
  })

  it('generates a new code once the existing one has expired', async () => {
    ddbMock.on(GetCommand).resolves({
      Item: { email: 'jane@x.com', purpose: 'signup', code: '123456', attempts: 0, expiresAt: PAST_EXPIRY },
    })
    ddbMock.on(PutCommand).resolves({})

    const code = await getOrCreateCode({
      email: 'jane@x.com',
      purpose: 'signup',
      ddbDocClient,
      tableName: 'verification-codes',
      ttlSeconds: 600,
    })

    expect(ddbMock.commandCalls(PutCommand)).toHaveLength(1)
    expect(code).toMatch(/^\d{6}$/)
  })
})

describe('hasPendingCode', () => {
  it('returns true for an unexpired row', async () => {
    ddbMock.on(GetCommand).resolves({
      Item: { email: 'jane@x.com', purpose: 'signup', code: '123456', attempts: 0, expiresAt: FUTURE_EXPIRY },
    })

    await expect(
      hasPendingCode({ email: 'jane@x.com', purpose: 'signup', ddbDocClient, tableName: 'verification-codes' }),
    ).resolves.toBe(true)
  })

  it('returns false for a missing row', async () => {
    ddbMock.on(GetCommand).resolves({})

    await expect(
      hasPendingCode({ email: 'jane@x.com', purpose: 'signup', ddbDocClient, tableName: 'verification-codes' }),
    ).resolves.toBe(false)
  })

  it('returns false for an expired row, without deleting it', async () => {
    ddbMock.on(GetCommand).resolves({
      Item: { email: 'jane@x.com', purpose: 'signup', code: '123456', attempts: 0, expiresAt: PAST_EXPIRY },
    })

    await expect(
      hasPendingCode({ email: 'jane@x.com', purpose: 'signup', ddbDocClient, tableName: 'verification-codes' }),
    ).resolves.toBe(false)
    expect(ddbMock.commandCalls(DeleteCommand)).toHaveLength(0)
  })
})

describe('verifyCode', () => {
  it('deletes the row and succeeds when the submitted code matches', async () => {
    ddbMock.on(GetCommand).resolves({
      Item: { email: 'jane@x.com', purpose: 'signup', code: '123456', attempts: 0, expiresAt: FUTURE_EXPIRY },
    })
    ddbMock.on(DeleteCommand).resolves({})

    const result = await verifyCode({
      email: 'jane@x.com',
      purpose: 'signup',
      submittedCode: '123456',
      ddbDocClient,
      tableName: 'verification-codes',
      maxAttempts: 5,
    })

    expect(result).toBe('success')
    expect(ddbMock.commandCalls(DeleteCommand)[0].args[0].input).toMatchObject({
      TableName: 'verification-codes',
      Key: { email: 'jane@x.com', purpose: 'signup' },
    })
  })

  it('increments attempts without deleting the row when the code is wrong', async () => {
    ddbMock.on(GetCommand).resolves({
      Item: { email: 'jane@x.com', purpose: 'signup', code: '123456', attempts: 1, expiresAt: FUTURE_EXPIRY },
    })
    ddbMock.on(UpdateCommand).resolves({})

    const result = await verifyCode({
      email: 'jane@x.com',
      purpose: 'signup',
      submittedCode: '000000',
      ddbDocClient,
      tableName: 'verification-codes',
      maxAttempts: 5,
    })

    expect(result).toBe('invalid')
    expect(ddbMock.commandCalls(DeleteCommand)).toHaveLength(0)
    const updateCall = ddbMock.commandCalls(UpdateCommand)[0]
    expect(updateCall.args[0].input).toMatchObject({
      TableName: 'verification-codes',
      Key: { email: 'jane@x.com', purpose: 'signup' },
      ConditionExpression: 'attempts < :maxAttempts',
    })
  })

  it('locks out and deletes the row once attempts are exhausted', async () => {
    ddbMock.on(GetCommand).resolves({
      Item: { email: 'jane@x.com', purpose: 'signup', code: '123456', attempts: 5, expiresAt: FUTURE_EXPIRY },
    })
    const conditionalError = new Error('ConditionalCheckFailedException')
    conditionalError.name = 'ConditionalCheckFailedException'
    ddbMock.on(UpdateCommand).rejects(conditionalError)
    ddbMock.on(DeleteCommand).resolves({})

    const result = await verifyCode({
      email: 'jane@x.com',
      purpose: 'signup',
      submittedCode: '000000',
      ddbDocClient,
      tableName: 'verification-codes',
      maxAttempts: 5,
    })

    expect(result).toBe('locked-out')
    expect(ddbMock.commandCalls(DeleteCommand)[0].args[0].input).toMatchObject({
      TableName: 'verification-codes',
      Key: { email: 'jane@x.com', purpose: 'signup' },
    })
  })

  it('treats an expired row as not-found', async () => {
    ddbMock.on(GetCommand).resolves({
      Item: { email: 'jane@x.com', purpose: 'signup', code: '123456', attempts: 0, expiresAt: PAST_EXPIRY },
    })

    const result = await verifyCode({
      email: 'jane@x.com',
      purpose: 'signup',
      submittedCode: '123456',
      ddbDocClient,
      tableName: 'verification-codes',
      maxAttempts: 5,
    })

    expect(result).toBe('not-found')
    expect(ddbMock.commandCalls(UpdateCommand)).toHaveLength(0)
    expect(ddbMock.commandCalls(DeleteCommand)).toHaveLength(0)
  })

  it('treats a missing row as not-found', async () => {
    ddbMock.on(GetCommand).resolves({})

    const result = await verifyCode({
      email: 'jane@x.com',
      purpose: 'signup',
      submittedCode: '123456',
      ddbDocClient,
      tableName: 'verification-codes',
      maxAttempts: 5,
    })

    expect(result).toBe('not-found')
  })
})
