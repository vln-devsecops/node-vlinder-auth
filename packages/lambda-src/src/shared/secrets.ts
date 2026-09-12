import {
  GetSecretValueCommand,
  ResourceNotFoundException,
  SecretsManagerClient,
} from '@aws-sdk/client-secrets-manager'

let secretsManagerClient: SecretsManagerClient | undefined

// Exported so other handlers that talk to Secrets Manager (e.g.
// rotate-secret/handler.ts) reuse this same lazily-constructed singleton
// instead of each standing up their own client -- one client per Lambda
// execution environment is the point of the lazy-singleton pattern in the
// first place, and duplicating it per-handler would just be more code for
// the same result.
export function getSecretsManagerClient(): SecretsManagerClient {
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

export interface SecretVersion {
  value: string
  versionId: string
}

/**
 * Fetches a specific version stage of a secret (e.g. the one-time-token key's
 * `AWSCURRENT` and `AWSPREVIOUS` versions, needed to verify a token minted
 * just before a key rotation -- see oneTimeToken.ts). Deliberately bypasses
 * `cache` above: that cache is keyed only by secretId and is shared with
 * other secrets (e.g. SESSION_SIGNING_KEY_SECRET_ID) that have no notion of
 * version stages, so making it stage-aware would be a bigger, riskier change
 * to code other callers already depend on. Left uncached on purpose: this is
 * only called once per cold start, during config loading in handler(), never
 * on a hot per-request path, so there is no real cost to always hitting
 * Secrets Manager fresh.
 *
 * Returns undefined -- not an error -- when the requested version stage
 * doesn't exist yet, which is expected and normal for `AWSPREVIOUS` on a
 * secret that has never been rotated.
 */
export async function getSecretVersion(
  secretId: string,
  versionStage: 'AWSCURRENT' | 'AWSPREVIOUS',
): Promise<SecretVersion | undefined> {
  let response
  try {
    response = await getSecretsManagerClient().send(
      new GetSecretValueCommand({ SecretId: secretId, VersionStage: versionStage }),
    )
  } catch (error) {
    if (error instanceof ResourceNotFoundException) {
      return undefined
    }
    throw error
  }

  if (!response.SecretString) {
    throw new Error(`Secret ${secretId} (${versionStage}) has no SecretString value`)
  }
  if (!response.VersionId) {
    throw new Error(`Secret ${secretId} (${versionStage}) has no VersionId`)
  }

  return { value: response.SecretString, versionId: response.VersionId }
}
