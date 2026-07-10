import { describe, expect, it } from 'vitest'
import { buildOidcConfig, isMultiTenant } from './oidcConfig'

const env = {
  VITE_OIDC_AUTHORITY: 'https://auth-example.devsecops.vlinder.ca',
  VITE_OIDC_CLIENT_ID: 'admin-panel-client',
  VITE_OIDC_REDIRECT_URI: 'https://admin.example.com/callback',
  VITE_ADMIN_API_BASE_URL: 'https://admin-api.example.com',
}

describe('buildOidcConfig', () => {
  it('builds an authorization-code UserManager config from the env', () => {
    const config = buildOidcConfig(env)

    expect(config).toMatchObject({
      authority: env.VITE_OIDC_AUTHORITY,
      client_id: env.VITE_OIDC_CLIENT_ID,
      redirect_uri: env.VITE_OIDC_REDIRECT_URI,
      response_type: 'code',
      automaticSilentRenew: true,
    })
  })

  it('requests only the scopes the admin panel needs', () => {
    const config = buildOidcConfig(env)
    expect(config.scope).toBe('openid email profile')
  })
})

describe('isMultiTenant', () => {
  it('defaults to false when VITE_MULTI_TENANT is unset', () => {
    expect(isMultiTenant(env)).toBe(false)
  })

  it('is true only when VITE_MULTI_TENANT is exactly "true"', () => {
    expect(isMultiTenant({ ...env, VITE_MULTI_TENANT: 'true' })).toBe(true)
    expect(isMultiTenant({ ...env, VITE_MULTI_TENANT: 'yes' })).toBe(false)
  })
})
