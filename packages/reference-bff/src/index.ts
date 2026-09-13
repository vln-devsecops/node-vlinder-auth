// The package's "." export: server-side, Express-based. Never imported by a
// front-end bundle -- see client/index.ts (exported as "./client") for the
// browser-safe half.

export { createApp } from './app'
export type { AccessTokenDelivery, BffConfig } from './config'
export { loadConfig } from './config'

export { ACCESS_COOKIE, CSRF_COOKIE, LOGIN_NONCE_COOKIE, REFRESH_COOKIE } from './cookies'
export { CSRF_HEADER } from './app'

export { loginRoute, LOGIN_STATE_TTL_SECONDS } from './routes/login'
export { callbackRoute } from './routes/callback'
export { refreshRoute } from './routes/refresh'
export { relayRoute } from './routes/relay'
export type { RelayRouteOptions } from './routes/relay'

export { generateCodeVerifier, codeChallengeFor } from './pkce'
export { mintState, verifyState } from './stateJwe'
export type { StatePayload } from './stateJwe'
export { mintCsrfCookieValue, verifyCsrfToken } from './csrf'
