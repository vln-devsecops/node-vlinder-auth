// Auth configuration helpers for the auth-site SPA.
// buildInitiateAuthBody/parseAuthResult are pure functions for the
// USER_PASSWORD_AUTH Cognito direct-IDP-API flow. Runtime values
// (userPoolClientId, multiTenant) come from /config.json (see config.ts),
// not from Vite build-time env vars.

export interface CognitoTokens {
  accessToken: string
  idToken: string
  refreshToken: string
  expiresAt: number
}

/** Build the Cognito InitiateAuth request body for USER_PASSWORD_AUTH flow. */
export function buildInitiateAuthBody(
  clientId: string,
  email: string,
  password: string,
): Record<string, unknown> {
  return {
    AuthFlow: 'USER_PASSWORD_AUTH',
    ClientId: clientId,
    AuthParameters: { USERNAME: email, PASSWORD: password },
  }
}

/** Parse an InitiateAuth success response into tokens. */
export function parseAuthResult(
  result: Record<string, Record<string, unknown>>,
): CognitoTokens {
  const r = result['AuthenticationResult'] as Record<string, unknown>
  const expiresIn = (r['ExpiresIn'] as number) ?? 3600
  return {
    accessToken: r['AccessToken'] as string,
    idToken: r['IdToken'] as string,
    refreshToken: r['RefreshToken'] as string,
    expiresAt: Date.now() + expiresIn * 1000,
  }
}

/** Whether the current session uses multiple tenants (controls UI column visibility). */
export function isMultiTenant(value: boolean): boolean {
  return value
}

