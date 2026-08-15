import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager'

const secretsManagerClient = new SecretsManagerClient({})

// Rotation (see the module's time_rotating resource) overwrites the secret
// in place every 30 days, but a Lambda execution environment can stay warm
// for much longer than that -- AWS doesn't recycle containers on any fixed
// schedule. Caching the value forever (keyed only to cold start) would mean
// a long-lived container keeps signing and verifying with a key that's been
// rotated out. A TTL bounds that staleness window to CACHE_TTL_MS regardless
// of how long the container lives, at the cost of one extra Secrets Manager
// call per container every TTL_MS -- cheap next to a 30-day rotation period.
const CACHE_TTL_MS = 5 * 60 * 1000

let cached: { value: Promise<string>; fetchedAt: number } | undefined

export async function getSessionSigningKey(secretId: string): Promise<string> {
  const isStale = cached === undefined || Date.now() - cached.fetchedAt > CACHE_TTL_MS

  // `cached` is reassigned inside the .catch() closure below, so TypeScript
  // can't narrow the module-level `let` back to non-undefined after this
  // block -- capture the entry we just ensured exists into a local instead.
  let entry = cached
  if (isStale || entry === undefined) {
    const fetchedAt = Date.now()
    const value = secretsManagerClient
      .send(new GetSecretValueCommand({ SecretId: secretId }))
      .then((result) => {
        if (!result.SecretString) {
          throw new Error(`Secret ${secretId} has no SecretString`)
        }
        return result.SecretString
      })
      .catch((error: unknown) => {
        // A failed fetch must not poison the cache -- the next invocation
        // (same or a new container) should retry rather than rethrow forever.
        cached = undefined
        throw error
      })
    entry = { value, fetchedAt }
    cached = entry
  }

  return entry.value
}

// Test-only: module-level caching means the value otherwise leaks across
// test cases within the same file.
export function __resetSessionSigningKeyCacheForTests(): void {
  cached = undefined
}
