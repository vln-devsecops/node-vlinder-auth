import { type DirJweKey, mintDirJwe, verifyDirJwe } from '../shared/dirJwe'

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
// needs to decrypt it (this Lambda's own /token handler). The actual
// mint/verify mechanics live in shared/dirJwe.ts, shared with
// refreshToken.ts, which needs the identical pattern.

export interface OneTimeTokenPayload {
  userId: string
  redirectUri: string
  codeChallenge: string
  tokens: { accessToken: string; idToken: string; refreshToken: string; expiresAt: number }
}

export type OneTimeTokenKey = DirJweKey

const CONTEXT = 'One-time token key'
const ENV_VAR_NAME = 'ONE_TIME_TOKEN_KEY_SECRET_ID'

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
  return await mintDirJwe(payload, key, ttlSeconds, CONTEXT, ENV_VAR_NAME, now)
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
 * See shared/dirJwe.ts's `verifyDirJwe` doc comment for why this deliberately
 * does not use the token's own `kid` header to pick a single candidate.
 */
export async function verifyOneTimeToken(
  token: string,
  candidateKeys: OneTimeTokenKey[],
  now: number = Date.now(),
): Promise<OneTimeTokenPayload | null> {
  return await verifyDirJwe<OneTimeTokenPayload>(token, candidateKeys, CONTEXT, ENV_VAR_NAME, now)
}
