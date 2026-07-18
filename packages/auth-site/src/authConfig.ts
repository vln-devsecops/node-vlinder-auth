// Auth configuration helpers for the auth-site SPA.
// Runtime values (multiTenant) come from /config.json (see config.ts), not
// from Vite build-time env vars.

/** The token shape the SPA stores and the admin API's Bearer flow consumes. */
export interface CognitoTokens {
  accessToken: string
  idToken: string
  refreshToken: string
  expiresAt: number
}

/** Whether the current session uses multiple tenants (controls UI column visibility). */
export function isMultiTenant(value: boolean): boolean {
  return value
}
