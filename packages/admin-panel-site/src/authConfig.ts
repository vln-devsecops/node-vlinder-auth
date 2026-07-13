// Direct Cognito IDP API auth configuration for the admin panel SPA.
// This replaces the previous oidc-client-ts/UserManager redirect-based flow:
// instead of redirecting the browser to an authorization endpoint, the SPA
// calls Cognito's regional IDP API directly via the /idp CloudFront path
// (USER_PASSWORD_AUTH flow -- see cognito_auth module design notes).

export interface AuthSiteEnv {
  /** Cognito user pool client ID (auth_site_client_id module output). */
  VITE_USER_POOL_CLIENT_ID: string
  /** Base URL for the admin API (admin_api_invoke_url module output), served
   *  same-origin at /admin/api by CloudFront -- only the client ID is strictly
   *  needed for auth; this env var drives the apiClient separately. */
  VITE_ADMIN_API_BASE_URL: string
  VITE_MULTI_TENANT?: string
}

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
export function isMultiTenant(env: Pick<AuthSiteEnv, 'VITE_MULTI_TENANT'>): boolean {
  return env.VITE_MULTI_TENANT === 'true'
}

