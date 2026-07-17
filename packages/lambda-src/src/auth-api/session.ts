import { createHmac, timingSafeEqual } from 'node:crypto'

// Signed, self-contained session tokens for the vendor-neutral auth flow.
//
// These carry the in-flight state between /auth/identify and /auth/password
// (the "identify session") and, after a successful sign-in, the fact that a
// browser is authenticated at the auth component (the "AS session"). They are
// compact JWS (HS256): signed, not stored, so the auth Lambda stays stateless
// and a client cannot alter the payload and keep it valid. JWS is signed, not
// encrypted -- the payload is readable, so it must hold no secrets; see
// doc/vendor-neutral-auth.md. Delivery is always via an HttpOnly cookie so the
// token never reaches browser JavaScript.

export const IDENTIFY_SESSION_COOKIE = 'vln_auth_identify'
export const AS_SESSION_COOKIE = 'vln_auth_session'

function base64url(input: Buffer): string {
  return input.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64url(input: string): Buffer {
  return Buffer.from(input.replace(/-/g, '+').replace(/_/g, '/'), 'base64')
}

const HEADER = base64url(Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })))

function sign(signingInput: string, key: string): string {
  return base64url(createHmac('sha256', key).update(signingInput).digest())
}

/**
 * Sign a payload into a compact HS256 JWS with an expiry `ttlSeconds` from now
 * (a Unix-seconds `exp` claim). `now` is injectable for deterministic tests.
 */
export function signSession(
  payload: Record<string, unknown>,
  key: string,
  ttlSeconds: number,
  now: number = Date.now(),
): string {
  const exp = Math.floor(now / 1000) + ttlSeconds
  const body = base64url(Buffer.from(JSON.stringify({ ...payload, exp })))
  const signingInput = `${HEADER}.${body}`
  return `${signingInput}.${sign(signingInput, key)}`
}

/**
 * Verify a compact HS256 JWS produced by {@link signSession}. Returns the
 * payload (including `exp`) when the signature is valid and the token has not
 * expired; returns null on any tampering, malformed token, or expiry. Signature
 * comparison is constant-time.
 */
export function verifySession(
  token: string | undefined,
  key: string,
  now: number = Date.now(),
): Record<string, unknown> | null {
  if (!token) {
    return null
  }
  const parts = token.split('.')
  if (parts.length !== 3) {
    return null
  }
  const [header, body, signature] = parts
  const expected = sign(`${header}.${body}`, key)
  const given = Buffer.from(signature)
  const want = Buffer.from(expected)
  if (given.length !== want.length || !timingSafeEqual(given, want)) {
    return null
  }
  let payload: Record<string, unknown>
  try {
    payload = JSON.parse(fromBase64url(body).toString('utf8')) as Record<string, unknown>
  } catch {
    return null
  }
  if (typeof payload.exp !== 'number' || payload.exp < Math.floor(now / 1000)) {
    return null
  }
  return payload
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
