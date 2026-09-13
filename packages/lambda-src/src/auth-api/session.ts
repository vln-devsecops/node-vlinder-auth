import { SignJWT, jwtVerify, type JWTPayload } from 'jose'

// Signed, self-contained session tokens for the vendor-neutral auth flow.
//
// These carry the in-flight state between /auth/identify and /auth/password
// (the "identify session") and, after a successful sign-in, the fact that a
// browser is authenticated at the auth component (the "AS session"). They are
// HS256 JWTs (jose): signed, not stored, so the auth Lambda stays stateless and
// a client cannot alter the payload and keep it valid. A JWT is signed, not
// encrypted -- the payload is readable, so it must hold no secrets; see
// doc/vendor-neutral-auth.md. Delivery is always via an HttpOnly cookie so the
// token never reaches browser JavaScript.

export const IDENTIFY_SESSION_COOKIE = 'vln_auth_identify'
export const AS_SESSION_COOKIE = 'vln_auth_session'
// Records how the current AS session authenticated ('local' | 'federated').
// Deliberately a *separate* cookie from AS_SESSION_COOKIE rather than a field
// folded into it: AS_SESSION_COOKIE's value is the raw Cognito access token
// itself, lifted verbatim into `Authorization: Bearer <value>` by the admin
// API's edge rewrite (terraform-modules/.../admin_api_rewrite.js). Changing
// that cookie's format to carry structured data would break that already-
// shipped bearer-lift. Step 9 (sudo/step-up) depends on knowing this fact.
export const AUTH_METHOD_COOKIE = 'vln_auth_method'

function keyBytes(key: string): Uint8Array {
  return new TextEncoder().encode(key)
}

/**
 * Sign a payload into an HS256 JWT expiring `ttlSeconds` from now. `now`
 * (epoch ms) is injectable for deterministic tests.
 */
export async function signSession(
  payload: JWTPayload,
  key: string,
  ttlSeconds: number,
  now: number = Date.now(),
): Promise<string> {
  const iat = Math.floor(now / 1000)
  return await new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt(iat)
    .setExpirationTime(iat + ttlSeconds)
    .sign(keyBytes(key))
}

/**
 * Verify an HS256 JWT produced by {@link signSession} against a list of
 * candidate keys, tried in order (in practice: the session-signing key's
 * current Secrets Manager version, then its previous one if it exists --
 * see shared/secrets.ts's `getSecretVersions`). More than one candidate
 * matters here because the identify-session this most often verifies has a
 * 300-second TTL -- long enough for a real (if narrow) chance of a user's
 * `/identify` and `/password` calls straddling a key rotation, unlike
 * signing, which always uses only the current key. Resolves to the payload
 * from the first candidate that verifies; resolves to null if every
 * candidate fails, the token is tampered/malformed, or it has expired.
 * `now` (epoch ms) is injectable.
 */
export async function verifySession(
  token: string | undefined,
  keys: string[],
  now: number = Date.now(),
): Promise<JWTPayload | null> {
  if (!token) {
    return null
  }
  for (const key of keys) {
    try {
      const { payload } = await jwtVerify(token, keyBytes(key), { currentDate: new Date(now) })
      return payload
    } catch {
      // Try the next candidate; only exhausting the whole list is failure.
    }
  }
  return null
}

export interface CookieOptions {
  maxAgeSeconds: number
  path?: string
}

/**
 * Serialize an HttpOnly, Secure, SameSite=Strict session cookie. SameSite=Strict
 * is safe because every consumer of these cookies is same-origin with the auth
 * component (see doc/vendor-neutral-auth.md); cross-origin apps never receive
 * them.
 */
export function serializeSessionCookie(name: string, value: string, opts: CookieOptions): string {
  const path = opts.path ?? '/api/v1/auth'
  return [
    `${name}=${value}`,
    `Path=${path}`,
    `Max-Age=${opts.maxAgeSeconds}`,
    'HttpOnly',
    'Secure',
    'SameSite=Strict',
  ].join('; ')
}

/** A cookie string that clears `name` (Max-Age=0). */
export function clearSessionCookie(name: string, path = '/api/v1/auth'): string {
  return `${name}=; Path=${path}; Max-Age=0; HttpOnly; Secure; SameSite=Strict`
}

/** Parse the API Gateway v2 `event.cookies` array into a name→value map. */
export function parseCookies(cookies: string[] | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  for (const cookie of cookies ?? []) {
    const eq = cookie.indexOf('=')
    if (eq > 0) {
      out[cookie.slice(0, eq).trim()] = cookie.slice(eq + 1).trim()
    }
  }
  return out
}
