import { SignUpCommand, type CognitoIdentityProviderClient } from '@aws-sdk/client-cognito-identity-provider'
import type { SESv2Client } from '@aws-sdk/client-sesv2'
import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb'
import { rethrowCognitoError } from '../cognitoError'
import { sendVerificationCode } from '../../shared/email'
import { getOrCreateCode, verifyCode } from '../../shared/verificationCodes'
import { assertVerified } from '../verificationCodeError'

// Self-service registration, wrapping Cognito's client-facing operations
// server-side so the SPA speaks only our first-party /api/v1/auth surface --
// no ClientId, no X-Amz-Target, no Cognito envelopes reach the browser.
//
// Confirmation no longer touches Cognito at all: the pre-sign-up trigger
// auto-confirms every account instantly (see pre-sign-up/handler.ts), so
// this app owns generating, storing, emailing, and validating the signup
// code itself, entirely against the verification_codes table.

const SIGNUP_PURPOSE = 'signup'

export interface SignUpParams {
  email: string
  password: string
  givenName: string
  familyName: string
  cognitoClient: CognitoIdentityProviderClient
  clientId: string
}

export async function signUp(params: SignUpParams): Promise<void> {
  try {
    await params.cognitoClient.send(
      new SignUpCommand({
        ClientId: params.clientId,
        Username: params.email,
        Password: params.password,
        // given_name/family_name are required attributes in vlinder_auth's
        // (doxchange-derived) pool schema -- SignUp is rejected without them.
        UserAttributes: [
          { Name: 'given_name', Value: params.givenName },
          { Name: 'family_name', Value: params.familyName },
        ],
      }),
    )
  } catch (error) {
    rethrowCognitoError(error)
  }
}

export interface ConfirmSignUpParams {
  email: string
  code: string
  ddbDocClient: DynamoDBDocumentClient
  tableName: string
  maxAttempts: number
}

export async function confirmSignUp(params: ConfirmSignUpParams): Promise<void> {
  const { email, code, ddbDocClient, tableName, maxAttempts } = params

  const result = await verifyCode({
    email,
    purpose: SIGNUP_PURPOSE,
    submittedCode: code,
    ddbDocClient,
    tableName,
    maxAttempts,
  })
  assertVerified(result)
}

export interface ResendConfirmationParams {
  email: string
  ddbDocClient: DynamoDBDocumentClient
  tableName: string
  ttlSeconds: number
  sesClient: SESv2Client
  fromAddress: string
}

/**
 * Gets-or-creates the pending signup code and (re-)sends it. Also used for
 * the very first send, right after signUp() -- getOrCreateCode's idempotency
 * means calling this twice in a row (once from the signup route, once from
 * an explicit resend) is safe.
 */
export async function resendConfirmation(params: ResendConfirmationParams): Promise<void> {
  const { email, ddbDocClient, tableName, ttlSeconds, sesClient, fromAddress } = params

  const code = await getOrCreateCode({ email, purpose: SIGNUP_PURPOSE, ddbDocClient, tableName, ttlSeconds })
  await sendVerificationCode({ email, code, purpose: SIGNUP_PURPOSE, sesClient, fromAddress })
}
