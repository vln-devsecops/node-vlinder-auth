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
 * other secrets that have no notion of version stages, so making it
 * stage-aware would be a bigger, riskier change to code other callers
 * already depend on. Left uncached on purpose -- see {@link getSecretVersions}
 * for why that matters, and how its callers avoid paying for it needlessly.
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

/**
 * Fetches the current version of a rotatable secret, plus the previous one
 * if it exists yet (a never-rotated secret has none) -- current always
 * first. Used wherever a rotation boundary needs tolerating: verifying
 * something signed/encrypted with whichever version was current a moment
 * ago, not just the one that's current right now (see session.ts's
 * `verifySession` and oneTimeToken.ts's `verifyOneTimeToken`).
 *
 * Deliberately **not called eagerly for every request** regardless of
 * route -- both `getSecretVersion` calls this makes are uncached by design
 * (a cached version would defeat the entire point: never actually seeing a
 * rotation without a cold start), so calling this from a shared prelude
 * that runs before every route dispatch would charge two live Secrets
 * Manager round-trips to requests that have nothing to do with the secret
 * in question. Call this only from the specific route handler(s) that
 * actually need it, so the cost lands only on the requests that need it.
 *
 * Throws if the secret has no `AWSCURRENT` at all -- that should never
 * happen for a secret this module provisions and seeds at creation.
 */
export async function getSecretVersions(secretId: string): Promise<[SecretVersion, ...SecretVersion[]]> {
  const current = await getSecretVersion(secretId, 'AWSCURRENT')
  if (!current) {
    throw new Error(`Secret ${secretId} has no AWSCURRENT version`)
  }
  const previous = await getSecretVersion(secretId, 'AWSPREVIOUS')
  return previous ? [current, previous] : [current]
}
