import {
  AdminGetUserCommand,
  AdminSetUserPasswordCommand,
  UserNotFoundException,
  type CognitoIdentityProviderClient,
} from '@aws-sdk/client-cognito-identity-provider'
import type { SESv2Client } from '@aws-sdk/client-sesv2'
import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb'
import { rethrowCognitoError } from '../cognitoError'
import { sendVerificationCode } from '../../shared/email'
import { getOrCreateCode, verifyCode } from '../../shared/verificationCodes'
import { assertVerified } from '../verificationCodeError'

// Self-service password recovery, wrapping Cognito's client-facing operations
// server-side. Same first-party contract as registration.ts, and the same
// "this app owns the code, not Cognito" shift.

const RESET_PURPOSE = 'password-reset'

export interface ForgotPasswordParams {
  email: string
  cognitoClient: CognitoIdentityProviderClient
  userPoolId: string
  ddbDocClient: DynamoDBDocumentClient
  tableName: string
  ttlSeconds: number
  sesClient: SESv2Client
  fromAddress: string
}

/**
 * Responds identically whether or not the account exists, to avoid leaking
 * which emails are registered -- a code is only generated and sent when
 * AdminGetUser confirms the account is real.
 */
export async function forgotPassword(params: ForgotPasswordParams): Promise<void> {
  const { email, cognitoClient, userPoolId, ddbDocClient, tableName, ttlSeconds, sesClient, fromAddress } =
    params

  try {
    await cognitoClient.send(new AdminGetUserCommand({ UserPoolId: userPoolId, Username: email }))
  } catch (error) {
    if (error instanceof UserNotFoundException) {
      return
    }
    throw error
  }

  const code = await getOrCreateCode({ email, purpose: RESET_PURPOSE, ddbDocClient, tableName, ttlSeconds })
  await sendVerificationCode({ email, code, purpose: RESET_PURPOSE, sesClient, fromAddress })
}

export interface ConfirmForgotPasswordParams {
  email: string
  code: string
  newPassword: string
  cognitoClient: CognitoIdentityProviderClient
  userPoolId: string
  ddbDocClient: DynamoDBDocumentClient
  tableName: string
  maxAttempts: number
}

export async function confirmForgotPassword(params: ConfirmForgotPasswordParams): Promise<void> {
  const { email, code, newPassword, cognitoClient, userPoolId, ddbDocClient, tableName, maxAttempts } = params

  const result = await verifyCode({
    email,
    purpose: RESET_PURPOSE,
    submittedCode: code,
    ddbDocClient,
    tableName,
    maxAttempts,
  })
  assertVerified(result)

  try {
    await cognitoClient.send(
      new AdminSetUserPasswordCommand({
        UserPoolId: userPoolId,
        Username: email,
        Password: newPassword,
        Permanent: true,
      }),
    )
  } catch (error) {
    rethrowCognitoError(error)
  }
}
