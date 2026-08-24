import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager'

let secretsManagerClient: SecretsManagerClient | undefined

function getSecretsManagerClient(): SecretsManagerClient {
  if (!secretsManagerClient) {
    secretsManagerClient = new SecretsManagerClient({})
  }
  return secretsManagerClient
}

// Populated on cold start, reused across warm invocations -- standard Lambda
// pattern for values that don't change within a running instance's lifetime.
const cache = new Map<string, string>()

export async function getSecret(secretId: string): Promise<string> {
  const cached = cache.get(secretId)
  if (cached !== undefined) {
    return cached
  }

  const response = await getSecretsManagerClient().send(
    new GetSecretValueCommand({ SecretId: secretId }),
  )
  if (!response.SecretString) {
    throw new Error(`Secret ${secretId} has no SecretString value`)
  }

  cache.set(secretId, response.SecretString)
  return response.SecretString
}
