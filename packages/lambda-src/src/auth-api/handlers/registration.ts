import {
  ConfirmSignUpCommand,
  ResendConfirmationCodeCommand,
  SignUpCommand,
  type CognitoIdentityProviderClient,
} from '@aws-sdk/client-cognito-identity-provider'
import { rethrowCognitoError } from '../cognitoError'

// Self-service registration, wrapping Cognito's client-facing operations
// server-side so the SPA speaks only our first-party /api/v1/auth surface --
// no ClientId, no X-Amz-Target, no Cognito envelopes reach the browser.

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
  cognitoClient: CognitoIdentityProviderClient
  clientId: string
}

export async function confirmSignUp(params: ConfirmSignUpParams): Promise<void> {
  try {
    await params.cognitoClient.send(
      new ConfirmSignUpCommand({
        ClientId: params.clientId,
        Username: params.email,
        ConfirmationCode: params.code,
      }),
    )
  } catch (error) {
    rethrowCognitoError(error)
  }
}

export interface ResendConfirmationParams {
  email: string
  cognitoClient: CognitoIdentityProviderClient
  clientId: string
}

export async function resendConfirmation(params: ResendConfirmationParams): Promise<void> {
  try {
    await params.cognitoClient.send(
      new ResendConfirmationCodeCommand({
        ClientId: params.clientId,
        Username: params.email,
      }),
    )
  } catch (error) {
    rethrowCognitoError(error)
  }
}
