// Loads and validates this BFF's configuration from environment variables.
// Mirrors lambda-src/src/auth-api/handler.ts's requireEnv: fail loudly, at
// startup, with a message that names the missing variable -- not a cryptic
// downstream crash the first time a route touches an undefined value.

export type AccessTokenDelivery = 'cookie' | 'body'

export interface BffConfig {
  /** Base URL of `auth.<zone>`, e.g. "https://auth.example.com". No trailing slash. */
  authServiceBaseUrl: string
  /** This RP's OAuth client_id, registered with the auth service. */
  rpClientId: string
  /** This RP's own /login/callback URL, registered in the client's redirect_uri allowlist. */
  rpRedirectUri: string
  /**
   * 32-byte (as UTF-8) symmetric key for this BFF's own `state` JWE
   * (dir/A256GCM). Independent of, and never shared with, the auth
   * service's own JWE keys -- this is a separate trust boundary; see
   * stateJwe.ts.
   */
  stateJweKey: string
  /** HMAC secret for minting/verifying the double-submit CSRF cookie; see csrf.ts. */
  csrfSecret: string
  /**
   * Where the access token is delivered to the front-end. Defaults to
   * 'cookie' (the safer default -- see doc/rationale.md's "Token delivery").
   */
  accessTokenDelivery: AccessTokenDelivery
  /**
   * Max-Age (seconds) for the refresh-token cookie (and, in lockstep, the
   * CSRF cookie -- see csrf.ts). Defaults to 2592000 (30 days), matching the
   * auth service's own REFRESH_TOKEN_TTL_SECONDS default (see
   * lambda-src/src/auth-api/handler.ts). An adopter changing one should
   * change the other: this cookie outliving the underlying refresh token
   * just means an extra round-trip that fails with 401; the reverse
   * (clearing the cookie before the token actually expires) forces
   * unnecessary re-logins.
   */
  refreshCookieMaxAgeSeconds: number
  /** Port for the standalone `server.ts` entrypoint. Not used by createApp itself. */
  port: number
}

function requireEnv(key: string): string {
  const value = process.env[key]
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`)
  }
  return value
}

/**
 * Requires a positive integer, not merely a finite number -- both consumers
 * (PORT, REFRESH_COOKIE_MAX_AGE_SECONDS) end up passed to APIs (`net.Server
 * .listen`, the `cookie` package's `serialize`) that reject a non-integer or
 * negative value themselves, but only once a request/listen actually
 * happens. Catching it here instead keeps this module's "fail loudly at
 * startup" promise instead of a cryptic downstream TypeError the first time
 * a route touches the bad value.
 */
function optionalEnvInt(key: string, fallback: number): number {
  const value = process.env[key]
  if (value === undefined || value === '') {
    return fallback
  }
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`Environment variable ${key} must be a non-negative integer, got: ${value}`)
  }
  return parsed
}

function accessTokenDeliveryFromEnv(): AccessTokenDelivery {
  const value = process.env.ACCESS_TOKEN_DELIVERY
  if (value === undefined || value === '') {
    return 'cookie'
  }
  if (value !== 'cookie' && value !== 'body') {
    throw new Error(`ACCESS_TOKEN_DELIVERY must be 'cookie' or 'body', got: ${value}`)
  }
  return value
}

/** Loads config from `process.env`, throwing loudly on any missing required variable. */
export function loadConfig(): BffConfig {
  return {
    authServiceBaseUrl: requireEnv('AUTH_SERVICE_BASE_URL').replace(/\/+$/, ''),
    rpClientId: requireEnv('RP_CLIENT_ID'),
    rpRedirectUri: requireEnv('RP_REDIRECT_URI'),
    stateJweKey: requireEnv('STATE_JWE_KEY'),
    csrfSecret: requireEnv('CSRF_SECRET'),
    accessTokenDelivery: accessTokenDeliveryFromEnv(),
    refreshCookieMaxAgeSeconds: optionalEnvInt('REFRESH_COOKIE_MAX_AGE_SECONDS', 2592000),
    port: optionalEnvInt('PORT', 3000),
  }
}
