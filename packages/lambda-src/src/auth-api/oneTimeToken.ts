import { EncryptJWT, jwtDecrypt, type JWTPayload } from 'jose'

// The one-time token handed back to the RP's front-end at the end of the RP
// handoff (see doc/vendor-neutral-auth.md's "Login" sequence diagram). Unlike
// the identify/AS sessions in session.ts, this is a JWE (encrypted), not a JWS
// (signed): its payload carries the real Cognito AuthenticationResult, so it
// is not safe for the payload to be merely readable-but-tamper-evident like
// the other sessions -- it must be opaque to the browser and to the RP's
// front-end, which only relays it to the RP's back-end for the /token
// exchange. This is also why the plan's illustrative
// `jwe({user, redirect_uri, code_challenge, timestamp})` is extended here to
// carry `tokens` too: this Lambda is stateless (no server-side session store),
// so /token must be able to return real tokens from the one-time token alone,
// without a second round-trip to Cognito.
//
// `alg: dir` + `enc: A256GCM` means the token is encrypted directly with a
// 256-bit symmetric key (no per-token key-wrapping step) held only by this
// Lambda -- appropriate here because there is exactly one party that ever
// needs to decrypt it (this Lambda's own /token handler).

export interface OneTimeTokenPayload {
  userId: string
  redirectUri: string
  codeChallenge: string
  tokens: { accessToken: string; idToken: string; refreshToken: string; expiresAt: number }
}

export interface OneTimeTokenKey {
  /**
   * A stable identifier for this specific key value (the Secrets Manager
   * version id) -- embedded as the JWE's `kid` for traceability across a
   * rotation boundary (e.g. "which key version encrypted this one" when
   * debugging a /token failure). Not used to select a key during
   * verification -- see verifyOneTimeToken's doc comment.
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
function keyBytes(key: string): Uint8Array {
  const bytes = new TextEncoder().encode(key)
  if (bytes.length !== 32) {
    throw new Error(
      `One-time token key must be exactly 32 bytes for A256GCM, got ${bytes.length}. ` +
        'Check the value stored under ONE_TIME_TOKEN_KEY_SECRET_ID.',
    )
  }
  return bytes
}

/**
 * Encrypts `payload` into a `dir`/A256GCM JWE expiring `ttlSeconds` from now.
 * `now` (epoch ms) is injectable for deterministic tests.
 */
export async function mintOneTimeToken(
  payload: OneTimeTokenPayload,
  key: OneTimeTokenKey,
  ttlSeconds: number,
  now: number = Date.now(),
): Promise<string> {
  const iat = Math.floor(now / 1000)
  return await new EncryptJWT(payload as unknown as JWTPayload)
    .setProtectedHeader({ alg: 'dir', enc: 'A256GCM', kid: key.keyId })
    .setIssuedAt(iat)
    .setExpirationTime(iat + ttlSeconds)
    .encrypt(keyBytes(key.key))
}

/**
 * Decrypts a JWE produced by {@link mintOneTimeToken}. Resolves to the payload
 * when decryption succeeds and the token has not expired; resolves to null on
 * any tampering, malformed token, wrong key, or expiry -- mirroring
 * session.ts's verifySession's exact null-on-any-failure contract, so callers
 * make their own decision about what "invalid" means for their own error
 * type rather than this function throwing. `now` (epoch ms) is injectable.
 *
 * Accepts a *list* of candidate keys (in practice: the current and, if it
 * exists, the previous Secrets Manager version of the one-time-token key --
 * see handler.ts) and tries each in order, returning the payload from the
 * first that succeeds. This handles the narrow race where a token was minted
 * with the key that was AWSCURRENT a moment ago, and the key has since
 * rotated by the time /token verifies it.
 *
 * This deliberately does not read the token's own `kid` header to pick a
 * single matching key to try. GCM's authentication tag already makes an
 * attempt with the wrong key fail safely and cheaply, so there is no security
 * or meaningful performance benefit to kid-matching -- and it would be one
 * more piece of logic that could itself have a bug. The `kid` embedded by
 * mintOneTimeToken exists purely for operator traceability/debugging (e.g.
 * "which key version encrypted this one"), not as part of the verification
 * algorithm.
 */
export async function verifyOneTimeToken(
  token: string,
  candidateKeys: OneTimeTokenKey[],
  now: number = Date.now(),
): Promise<OneTimeTokenPayload | null> {
  // Validated up front, outside the try/catch below: a candidate's key being
  // the wrong byte length is a misconfiguration (e.g. a bad secret value),
  // not a decrypt failure, and must still fail loudly rather than be
  // silently swallowed as "this candidate didn't match, try the next one."
  const candidateKeyBytes = candidateKeys.map((candidate) => keyBytes(candidate.key))

  for (const bytes of candidateKeyBytes) {
    try {
      const { payload } = await jwtDecrypt(token, bytes, { currentDate: new Date(now) })
      return payload as unknown as OneTimeTokenPayload
    } catch {
      // Try the next candidate; only exhausting the whole list is failure.
    }
  }
  return null
}
