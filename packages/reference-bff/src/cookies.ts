import { parse, serialize } from 'cookie'
import type { BffConfig } from './config'
import { mintCsrfCookieValue } from './csrf'

// Cookie names and serialize/parse helpers for this BFF. Uses the `cookie`
// npm package (Express's own dependency, the de facto standard for a
// generic Node HTTP server) rather than hand-rolling parsing the way
// lambda-src/src/auth-api/session.ts does -- that hand-rolling is
// specifically because API Gateway v2 hands the Lambda a pre-split
// `event.cookies` string array with no generic `Cookie` header to parse; a
// plain Express server has no such shape and gets a real `Cookie` header
// like any other HTTP server.
//
// Pinned to `cookie` ^1.1.1, not the current 2.x major: v2 dropped the
// `parse`/`serialize` names entirely in favor of `parseCookie`/
// `stringifySetCookie`. 1.1.1 is the last line to export both -- the new
// names as aliases alongside the old ones -- so this stays on a version that
// still has `parse`/`serialize` without giving up a reasonably current
// release.

export const REFRESH_COOKIE = 'vln_bff_refresh'
export const ACCESS_COOKIE = 'vln_bff_access'
// Name and flags fixed by terraform-modules/.../doc/admin-api-csrf.md, which
// this BFF is the first implementation of: `Secure` + `SameSite=Strict`,
// deliberately NOT `HttpOnly` so front-end JS can read it and echo it back
// in the X-Vln-Csrf-Token header. See src/csrf.ts.
export const CSRF_COOKIE = 'vln_auth_csrf'

export interface CookieOptions {
  maxAgeSeconds: number
  path?: string
  httpOnly?: boolean
}

/**
 * Serializes a cookie with this codebase's standard flags (Secure,
 * SameSite=Strict, explicit Path and Max-Age -- see session.ts's
 * serializeSessionCookie for the precedent). `httpOnly` defaults to `true`;
 * the CSRF cookie is the one deliberate exception and passes `false`.
 */
export function serializeBffCookie(name: string, value: string, opts: CookieOptions): string {
  return serialize(name, value, {
    path: opts.path ?? '/',
    maxAge: opts.maxAgeSeconds,
    httpOnly: opts.httpOnly ?? true,
    secure: true,
    sameSite: 'strict',
  })
}

/** A `Set-Cookie` value that clears `name` immediately. */
export function clearBffCookie(name: string, opts: Pick<CookieOptions, 'path' | 'httpOnly'> = {}): string {
  return serialize(name, '', {
    path: opts.path ?? '/',
    maxAge: 0,
    httpOnly: opts.httpOnly ?? true,
    secure: true,
    sameSite: 'strict',
  })
}

/**
 * Parses the incoming `Cookie` header into a name -> value map. `cookie`'s
 * own `parse` types values as possibly `undefined` (a malformed pair with no
 * `=`); callers here only ever look a specific name up and treat a missing
 * entry as absent either way, so that distinction collapses cleanly.
 */
export function parseCookieHeader(header: string | undefined): Record<string, string | undefined> {
  if (!header) {
    return {}
  }
  return parse(header)
}

/**
 * Builds the `Set-Cookie` values for a freshly-minted (or rotated) session:
 * the refresh-token cookie, its derived CSRF cookie, and (if
 * `accessTokenDelivery` is 'cookie') the access-token cookie. Shared by
 * /login/callback and /refresh, which mint/rotate the exact same triple --
 * factored out so the "compute Max-Age once, reuse for both the refresh and
 * CSRF cookies" invariant (see handler.ts's redirectMaxAgeSeconds comment
 * for why this matters) lives in one place instead of two call sites that
 * could drift apart.
 */
export function sessionCookies(
  config: Pick<BffConfig, 'csrfSecret' | 'accessTokenDelivery' | 'refreshCookieMaxAgeSeconds'>,
  tokens: { accessToken: string; refreshToken: string; expiresAt: number },
  now: number = Date.now(),
): string[] {
  const refreshMaxAgeSeconds = config.refreshCookieMaxAgeSeconds
  return [
    serializeBffCookie(REFRESH_COOKIE, tokens.refreshToken, { maxAgeSeconds: refreshMaxAgeSeconds }),
    serializeBffCookie(CSRF_COOKIE, mintCsrfCookieValue(config.csrfSecret, tokens.refreshToken), {
      maxAgeSeconds: refreshMaxAgeSeconds,
      httpOnly: false,
    }),
    ...(config.accessTokenDelivery === 'cookie'
      ? [
          serializeBffCookie(ACCESS_COOKIE, tokens.accessToken, {
            maxAgeSeconds: Math.max(0, Math.floor((tokens.expiresAt - now) / 1000)),
          }),
        ]
      : []),
  ]
}

/** `Set-Cookie` values that clear all three of this BFF's cookies (refresh, CSRF, access). */
export function clearSessionCookies(): string[] {
  return [
    clearBffCookie(REFRESH_COOKIE),
    clearBffCookie(CSRF_COOKIE, { httpOnly: false }),
    clearBffCookie(ACCESS_COOKIE),
  ]
}
