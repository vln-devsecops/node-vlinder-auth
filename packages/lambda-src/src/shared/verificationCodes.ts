import { randomInt } from 'node:crypto'
import {
  DeleteCommand,
  GetCommand,
  PutCommand,
  UpdateCommand,
  type DynamoDBDocumentClient,
} from '@aws-sdk/lib-dynamodb'

const CODE_DIGITS = 6
const CODE_UPPER_BOUND = 10 ** CODE_DIGITS

/** Six-digit numeric code, zero-padded (e.g. "003219"). */
export function generateCode(): string {
  return randomInt(0, CODE_UPPER_BOUND).toString().padStart(CODE_DIGITS, '0')
}

interface VerificationCodeItem {
  code: string
  attempts: number
  expiresAt: number
}

function isExpired(item: VerificationCodeItem): boolean {
  return item.expiresAt <= Math.floor(Date.now() / 1000)
}

export interface GetOrCreateCodeParams {
  email: string
  purpose: string
  ddbDocClient: DynamoDBDocumentClient
  tableName: string
  ttlSeconds: number
}

/**
 * Idempotent while valid: a resend must not invalidate a code the user is
 * mid-typing, so an existing unexpired row is returned unchanged. Only
 * generates and stores a new code when the row is missing or expired.
 */
export async function getOrCreateCode(params: GetOrCreateCodeParams): Promise<string> {
  const { email, purpose, ddbDocClient, tableName, ttlSeconds } = params

  const existing = await ddbDocClient.send(
    new GetCommand({ TableName: tableName, Key: { email, purpose } }),
  )
  const item = existing.Item as VerificationCodeItem | undefined
  if (item && !isExpired(item)) {
    return item.code
  }

  const code = generateCode()
  await ddbDocClient.send(
    new PutCommand({
      TableName: tableName,
      Item: {
        email,
        purpose,
        code,
        attempts: 0,
        expiresAt: Math.floor(Date.now() / 1000) + ttlSeconds,
      },
    }),
  )
  return code
}

export interface HasPendingCodeParams {
  email: string
  purpose: string
  ddbDocClient: DynamoDBDocumentClient
  tableName: string
}

/**
 * Read-only existence check for a login gate: does an unexpired row for
 * (email, purpose) exist? Unlike verifyCode, this never mutates the row or
 * consumes an attempt.
 */
export async function hasPendingCode(params: HasPendingCodeParams): Promise<boolean> {
  const { email, purpose, ddbDocClient, tableName } = params

  const existing = await ddbDocClient.send(
    new GetCommand({ TableName: tableName, Key: { email, purpose } }),
  )
  const item = existing.Item as VerificationCodeItem | undefined
  return item !== undefined && !isExpired(item)
}

export interface VerifyCodeParams {
  email: string
  purpose: string
  submittedCode: string
  ddbDocClient: DynamoDBDocumentClient
  tableName: string
  maxAttempts: number
}

export type VerifyCodeResult = 'success' | 'invalid' | 'locked-out' | 'not-found'

/**
 * Validates a submitted code against the stored row, atomically capping
 * attempts at maxAttempts to guard against a race between concurrent
 * verify calls. Deletes the row on success (single-use) or once attempts
 * are exhausted (locked-out); an expired row is treated as not-found.
 */
export async function verifyCode(params: VerifyCodeParams): Promise<VerifyCodeResult> {
  const { email, purpose, submittedCode, ddbDocClient, tableName, maxAttempts } = params

  const existing = await ddbDocClient.send(
    new GetCommand({ TableName: tableName, Key: { email, purpose } }),
  )
  const item = existing.Item as VerificationCodeItem | undefined
  if (!item || isExpired(item)) {
    return 'not-found'
  }

  if (item.code === submittedCode) {
    await ddbDocClient.send(new DeleteCommand({ TableName: tableName, Key: { email, purpose } }))
    return 'success'
  }

  try {
    await ddbDocClient.send(
      new UpdateCommand({
        TableName: tableName,
        Key: { email, purpose },
        UpdateExpression: 'SET attempts = attempts + :one',
        ConditionExpression: 'attempts < :maxAttempts',
        ExpressionAttributeValues: { ':one': 1, ':maxAttempts': maxAttempts },
      }),
    )
    return 'invalid'
  } catch (error) {
    if (error instanceof Error && error.name === 'ConditionalCheckFailedException') {
      await ddbDocClient.send(
        new DeleteCommand({ TableName: tableName, Key: { email, purpose } }),
      )
      return 'locked-out'
    }
    throw error
  }
}
