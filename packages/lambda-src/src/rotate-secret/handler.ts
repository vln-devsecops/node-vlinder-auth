import { GetRandomPasswordCommand, PutSecretValueCommand } from '@aws-sdk/client-secrets-manager'
import { getSecretsManagerClient } from '../shared/secrets'

export interface RotateSecretEvent {
  secretId: string
  passwordLength: number
}

/**
 * Scheduled rotation for the secrets this system versions itself around --
 * the session-signing key and the RP-handoff one-time-token key (see
 * shared/secrets.ts's `getSecretVersion` and auth-api/oneTimeToken.ts's
 * `verifyOneTimeToken`, both of which already tolerate a rotation boundary
 * by trying AWSCURRENT then AWSPREVIOUS). Previously these only rotated when
 * an adopter ran `terraform apply` (a `time_rotating` resource plus a
 * local-exec reseed script); this Lambda lets that happen on a schedule
 * instead, without requiring a redeploy. One handler serves both secrets --
 * two separate EventBridge schedules invoke it with different `secretId`/
 * `passwordLength` event payloads, rather than hardcoding either value here.
 *
 * `GetRandomPassword`'s flags deliberately mirror the Terraform
 * local-exec script's `aws secretsmanager get-random-password
 * --exclude-punctuation --password-length N --require-each-included-type`
 * exactly, not just "similar enough" flags: excluding punctuation keeps the
 * result all-ASCII, which is what makes `PasswordLength` equal to byte
 * length. That equality matters for the one-time-token key specifically --
 * it must be exactly 32 raw bytes for AES-256-GCM's `dir` mode (see
 * oneTimeToken.ts's `keyBytes()`), and a password generator that permitted
 * multi-byte characters could produce a string of the right *length* but
 * wrong *byte count*.
 *
 * Writing the new value via `PutSecretValue` with no explicit
 * `VersionStages` override is itself load-bearing: Secrets Manager
 * automatically promotes the new version to `AWSCURRENT` and demotes the
 * previous `AWSCURRENT` to `AWSPREVIOUS`, which is exactly the versioning
 * `getSecretVersion`/`verifyOneTimeToken` already depend on -- no extra
 * bookkeeping needed here to make that happen.
 *
 * Deliberately has no return value and no try/catch: the invoking schedule
 * doesn't consume a response, and letting any failure (from either SDK
 * call) propagate is what makes a bad rotation show up as a failed/erroring
 * CloudWatch invocation instead of silently doing nothing.
 */
export async function handler(event: RotateSecretEvent): Promise<void> {
  const client = getSecretsManagerClient()

  const randomPasswordResponse = await client.send(
    new GetRandomPasswordCommand({
      ExcludePunctuation: true,
      PasswordLength: event.passwordLength,
      RequireEachIncludedType: true,
    }),
  )

  if (!randomPasswordResponse.RandomPassword) {
    throw new Error(`GetRandomPassword returned no RandomPassword value for secret ${event.secretId}`)
  }

  await client.send(
    new PutSecretValueCommand({
      SecretId: event.secretId,
      SecretString: randomPasswordResponse.RandomPassword,
    }),
  )
}
