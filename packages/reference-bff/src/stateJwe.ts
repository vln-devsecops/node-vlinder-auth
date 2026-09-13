import { EncryptJWT, jwtDecrypt } from 'jose'

// This BFF's own `state` JWE: dir/A256GCM, following the identical pattern
// to lambda-src/src/shared/dirJwe.ts (same construction: mint = encrypt
// directly with a single 256-bit symmetric key, verify = decrypt-or-null),
// but deliberately independent code, not a shared import. The BFF is a
// separate deployable with no access to lambda-src's internals, and this key
// must never be shared with the auth service: the auth service never sees
// this JWE's plaintext or its key, only round-trips the opaque `state`
// string back to the BFF via the browser redirect (see
// doc/vendor-neutral-auth.md's Login sequence diagram and
// doc/rationale.md's "`state` is a JWE, not a JWS").
//
// Unlike lambda-src's refresh/one-time-token keys, there is no
// candidate-key-list/rotation machinery here: this key is adopter-managed
// with no built-in rotation cron (out of scope for a minimal reference). A
// key rotation here simply invalidates any login in flight at that instant,
// which is an acceptable adopter-operations concern, not a security gap.

export interface StatePayload {
  codeVerifier: string
  issuedAt: number // epoch ms
}

/**
 * `dir`/A256GCM requires exactly 32 raw key bytes. Checked up front so a
 * misconfigured STATE_JWE_KEY fails with a message naming the actual
 * problem, rather than a cryptic error from `jose` -- matching
 * lambda-src/src/shared/dirJwe.ts's convention.
 */
function keyBytes(key: string): Uint8Array {
  const bytes = new TextEncoder().encode(key)
  if (bytes.length !== 32) {
    throw new Error(
      `STATE_JWE_KEY must be exactly 32 bytes for A256GCM, got ${bytes.length}. ` +
        'Check the value stored under STATE_JWE_KEY.',
    )
  }
  return bytes
}

/** Encrypts `payload` into a dir/A256GCM JWE expiring `ttlSeconds` from now. `now` (epoch ms) is injectable. */
export async function mintState(
  payload: StatePayload,
  key: string,
  ttlSeconds: number,
  now: number = Date.now(),
): Promise<string> {
  const iat = Math.floor(now / 1000)
  return await new EncryptJWT({ codeVerifier: payload.codeVerifier, issuedAt: payload.issuedAt })
    .setProtectedHeader({ alg: 'dir', enc: 'A256GCM' })
    .setIssuedAt(iat)
    .setExpirationTime(iat + ttlSeconds)
    .encrypt(keyBytes(key))
}

/**
 * Decrypts a JWE produced by {@link mintState}. Resolves to the payload on
 * success; resolves to null on any tampering, malformed token, wrong key, or
 * expiry -- mirroring lambda-src's null-on-any-failure contract. `now`
 * (epoch ms) is injectable.
 */
export async function verifyState(
  token: string,
  key: string,
  now: number = Date.now(),
): Promise<StatePayload | null> {
  // Validated outside the try/catch below: a misconfigured STATE_JWE_KEY is
  // not a decrypt failure and must fail loudly rather than be silently
  // swallowed as "invalid token" -- see lambda-src's verifyOneTimeToken for
  // the identical reasoning (and the bug this mirrors, caught and fixed
  // there earlier).
  const bytes = keyBytes(key)
  try {
    const { payload } = await jwtDecrypt(token, bytes, { currentDate: new Date(now) })
    if (typeof payload.codeVerifier !== 'string' || typeof payload.issuedAt !== 'number') {
      return null
    }
    return { codeVerifier: payload.codeVerifier, issuedAt: payload.issuedAt }
  } catch {
    return null
  }
}
