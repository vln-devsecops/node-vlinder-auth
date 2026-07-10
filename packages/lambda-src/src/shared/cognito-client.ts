import { CognitoIdentityProviderClient } from '@aws-sdk/client-cognito-identity-provider'

let cognitoClient: CognitoIdentityProviderClient | undefined

export function getCognitoClient(): CognitoIdentityProviderClient {
  if (!cognitoClient) {
    cognitoClient = new CognitoIdentityProviderClient({})
  }
  return cognitoClient
}
