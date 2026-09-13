import { type DirJweKey, mintDirJwe, verifyDirJwe } from '../shared/dirJwe'

// The refresh token handed back to the BFF at the end of /token and /refresh
// (see doc/vendor-neutral-auth.md's Token model and Refresh sections). Like
// the RP-handoff one-time token, this is a JWE (encrypted), not a JWS
// (signed): it carries the real Cognito refresh token, and must be opaque to
// the BFF holding it -- the BFF forwards it unmodified and never decrypts it
// itself. `alg: dir` + `enc: A256GCM`, same reasoning and same mechanics as
// oneTimeToken.ts, factored out into shared/dirJwe.ts.
//
// `elevatedGrants` rides inside this payload rather than a server-side store
// so that step-up (sudo, step 9 of doc/plan.md, unbuilt) can piggyback on the
// rotation that already happens on every refresh instead of adding one (see
// doc/rationale.md). Nothing populates it yet -- every caller in this step
// passes `[]` -- but decayElevatedGrants must be correct now, since step 9
// will rely on it without re-deriving or re-reviewing it.

export interface ElevatedGrant {
  privilege: string
  expiresAt: number // epoch ms
}

export interface RefreshTokenPayload {
  cognitoRefreshToken: string
  elevatedGrants: ElevatedGrant[]
}

export type RefreshTokenKey = DirJweKey

const CONTEXT = 'Refresh token key'
const ENV_VAR_NAME = 'REFRESH_TOKEN_KEY_SECRET_ID'

/**
 * Encrypts `payload` into a `dir`/A256GCM JWE expiring `ttlSeconds` from now.
 * `now` (epoch ms) is injectable for deterministic tests. `ttlSeconds` is the
 * JWE's own expiry, independent of (and expected to be no shorter than) how
 * long the underlying raw Cognito refresh token stays valid -- that is a
 * Terraform-side concern (Cognito's `refresh_token_validity`), not this
 * module's; see handler.ts's REFRESH_TOKEN_TTL_SECONDS.
 */
export async function mintRefreshToken(
  payload: RefreshTokenPayload,
  key: RefreshTokenKey,
  ttlSeconds: number,
  now: number = Date.now(),
): Promise<string> {
  return await mintDirJwe(payload, key, ttlSeconds, CONTEXT, ENV_VAR_NAME, now)
}

/**
 * Decrypts a JWE produced by {@link mintRefreshToken}. Resolves to the
 * payload when decryption succeeds and the token has not expired; resolves
 * to null on any tampering, malformed token, wrong key, or expiry -- see
 * shared/dirJwe.ts's `verifyDirJwe` doc comment for the full contract and why
 * a candidate-key list (current + previous) is accepted.
 */
export async function verifyRefreshToken(
  token: string,
  candidateKeys: RefreshTokenKey[],
  now: number = Date.now(),
): Promise<RefreshTokenPayload | null> {
  return await verifyDirJwe<RefreshTokenPayload>(token, candidateKeys, CONTEXT, ENV_VAR_NAME, now)
}

/**
 * Drops any elevated grant that has expired by wall-clock time (`expiresAt`
 * is epoch ms), per doc/rationale.md's "Elevated grants decay by wall-clock
 * expiry, not a refresh countdown". Pure function: does not mutate `grants`.
 * `now` (epoch ms) is injectable for deterministic tests.
 */
export function decayElevatedGrants(grants: ElevatedGrant[], now: number = Date.now()): ElevatedGrant[] {
  return grants.filter((grant) => grant.expiresAt > now)
}
