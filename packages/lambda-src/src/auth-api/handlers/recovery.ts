import {
  ConfirmForgotPasswordCommand,
  ForgotPasswordCommand,
  type CognitoIdentityProviderClient,
} from '@aws-sdk/client-cognito-identity-provider'
import { rethrowCognitoError } from '../cognitoError'

// Self-service password recovery, wrapping Cognito's client-facing operations
// server-side. Same first-party contract as registration.ts.

export interface ForgotPasswordParams {
  email: string
  cognitoClient: CognitoIdentityProviderClient
  clientId: string
}

export async function forgotPassword(params: ForgotPasswordParams): Promise<void> {
  try {
    await params.cognitoClient.send(
      new ForgotPasswordCommand({ ClientId: params.clientId, Username: params.email }),
    )
  } catch (error) {
    rethrowCognitoError(error)
  }
}

export interface ConfirmForgotPasswordParams {
  email: string
  code: string
  newPassword: string
  cognitoClient: CognitoIdentityProviderClient
  clientId: string
}

export async function confirmForgotPassword(params: ConfirmForgotPasswordParams): Promise<void> {
  try {
    await params.cognitoClient.send(
      new ConfirmForgotPasswordCommand({
        ClientId: params.clientId,
        Username: params.email,
        ConfirmationCode: params.code,
        Password: params.newPassword,
      }),
    )
  } catch (error) {
    rethrowCognitoError(error)
  }
}
