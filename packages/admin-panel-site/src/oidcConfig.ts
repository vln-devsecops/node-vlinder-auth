import type { UserManagerSettings } from 'oidc-client-ts'

export interface AdminPanelEnv {
  VITE_OIDC_AUTHORITY: string
  VITE_OIDC_CLIENT_ID: string
  VITE_OIDC_REDIRECT_URI: string
  VITE_ADMIN_API_BASE_URL: string
  VITE_MULTI_TENANT?: string
}

/**
 * The admin panel is hosted-UI-only (no self-signup client), so this is a
 * plain authorization-code config -- no PKCE opt-out, no implicit flow.
 */
export function buildOidcConfig(env: AdminPanelEnv): UserManagerSettings {
  return {
    authority: env.VITE_OIDC_AUTHORITY,
    client_id: env.VITE_OIDC_CLIENT_ID,
    redirect_uri: env.VITE_OIDC_REDIRECT_URI,
    response_type: 'code',
    scope: 'openid email profile',
    automaticSilentRenew: true,
  }
}

/** Single-tenant (the default) hides the tenant column/switcher entirely. */
export function isMultiTenant(env: Pick<AdminPanelEnv, 'VITE_MULTI_TENANT'>): boolean {
  return env.VITE_MULTI_TENANT === 'true'
}
