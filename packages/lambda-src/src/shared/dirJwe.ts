import { EncryptJWT, jwtDecrypt, type JWTPayload } from 'jose'

// Generic `dir`/A256GCM JWE mint/verify pair, extracted from oneTimeToken.ts
// (the RP-handoff one-time token) because refreshToken.ts needs exactly the
// same shape: encrypt directly with a single 256-bit symmetric key (no
// per-token key-wrapping step), because there is exactly one party that ever
// decrypts either kind of token (this Lambda itself). Both call sites
// parameterize the key-length error message with their own context string
// and env var name, so a misconfigured secret still fails loudly with a
// message that names the actual problem rather than a generic one.

export interface DirJweKey {
  /**
   * A stable identifier for this specific key value (the Secrets Manager
   * version id) -- embedded as the JWE's `kid` for traceability across a
   * rotation boundary. Not used to select a key during verification -- see
   * {@link verifyDirJwe}'s doc comment.
   */
  keyId: string
  key: string
}

/**
 * `dir`/A256GCM requires exactly 32 raw key bytes. `jose` throws its own
 * (fairly opaque) error if given the wrong length; this checks up front and
 * fails loudly with a message that names the actual problem, matching this
 * codebase's convention of not letting a misconfigured secret surface as a
 * cryptic low-level exception (see e.g. privileges.ts, tenants.ts).
 */
function keyBytes(key: string, context: string, envVarName: string): Uint8Array {
  const bytes = new TextEncoder().encode(key)
  if (bytes.length !== 32) {
    throw new Error(
      `${context} must be exactly 32 bytes for A256GCM, got ${bytes.length}. ` +
        `Check the value stored under ${envVarName}.`,
    )
  }
  return bytes
}

/**
 * Encrypts `payload` into a `dir`/A256GCM JWE expiring `ttlSeconds` from now.
 * `now` (epoch ms) is injectable for deterministic tests.
 */
export async function mintDirJwe<T extends object>(
  payload: T,
  key: DirJweKey,
  ttlSeconds: number,
  context: string,
  envVarName: string,
  now: number = Date.now(),
): Promise<string> {
  const iat = Math.floor(now / 1000)
  return await new EncryptJWT(payload as unknown as JWTPayload)
    .setProtectedHeader({ alg: 'dir', enc: 'A256GCM', kid: key.keyId })
    .setIssuedAt(iat)
    .setExpirationTime(iat + ttlSeconds)
    .encrypt(keyBytes(key.key, context, envVarName))
}

/**
 * Decrypts a JWE produced by {@link mintDirJwe}. Resolves to the payload
 * when decryption succeeds and the token has not expired; resolves to null on
 * any tampering, malformed token, wrong key, or expiry -- mirroring
 * session.ts's verifySession's exact null-on-any-failure contract, so callers
 * make their own decision about what "invalid" means for their own error
 * type rather than this function throwing. `now` (epoch ms) is injectable.
 *
 * Accepts a *list* of candidate keys (in practice: the current and, if it
 * exists, the previous Secrets Manager version of the relevant key -- see
 * handler.ts) and tries each in order, returning the payload from the first
 * that succeeds. This handles the narrow race where a token was minted with
 * the key that was AWSCURRENT a moment ago, and the key has since rotated by
 * the time verification runs.
 *
 * This deliberately does not read the token's own `kid` header to pick a
 * single matching key to try. GCM's authentication tag already makes an
 * attempt with the wrong key fail safely and cheaply, so there is no security
 * or meaningful performance benefit to kid-matching -- and it would be one
 * more piece of logic that could itself have a bug. The `kid` embedded by
 * mintDirJwe exists purely for operator traceability/debugging (e.g. "which
 * key version encrypted this one"), not as part of the verification
 * algorithm.
 */
export async function verifyDirJwe<T>(
  token: string,
  candidateKeys: DirJweKey[],
  context: string,
  envVarName: string,
  now: number = Date.now(),
): Promise<T | null> {
  // Validated up front, outside the try/catch below: a candidate's key being
  // the wrong byte length is a misconfiguration (e.g. a bad secret value),
  // not a decrypt failure, and must still fail loudly rather than be
  // silently swallowed as "this candidate didn't match, try the next one."
  const candidateKeyBytes = candidateKeys.map((candidate) => keyBytes(candidate.key, context, envVarName))

  for (const bytes of candidateKeyBytes) {
    try {
      const { payload } = await jwtDecrypt(token, bytes, { currentDate: new Date(now) })
      return payload as unknown as T
    } catch {
      // Try the next candidate; only exhausting the whole list is failure.
    }
  }
  return null
}
