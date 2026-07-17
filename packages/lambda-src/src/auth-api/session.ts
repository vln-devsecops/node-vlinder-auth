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
 * Verify an HS256 JWT produced by {@link signSession}. Resolves to the payload
 * when the signature is valid and the token has not expired; resolves to null
 * on any tampering, malformed token, or expiry. `now` (epoch ms) is injectable.
 */
export async function verifySession(
  token: string | undefined,
  key: string,
  now: number = Date.now(),
): Promise<JWTPayload | null> {
  if (!token) {
    return null
  }
  try {
    const { payload } = await jwtVerify(token, keyBytes(key), { currentDate: new Date(now) })
    return payload
  } catch {
    return null
  }
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
