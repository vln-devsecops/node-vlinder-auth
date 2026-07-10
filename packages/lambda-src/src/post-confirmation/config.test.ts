import { describe, expect, it } from 'vitest'
import { loadPostConfirmationConfig } from './config'

describe('loadPostConfirmationConfig', () => {
  it('defaults to single-tenant mode when TENANCY_MODE is unset', () => {
    const config = loadPostConfirmationConfig({
      DEFAULT_TENANT_ID: 'default',
      DEFAULT_ROLE_ID: 'member',
      TENANTS_TABLE_NAME: 'tenants',
      ROLE_ASSIGNMENTS_TABLE_NAME: 'role-assignments',
      USER_POOL_ID: 'us-east-1_example',
      BASELINE_GROUPS: 'members',
    })

    expect(config.tenancyMode).toBe('single')
  })

  it('reads multi-tenant mode and splits the baseline groups list', () => {
    const config = loadPostConfirmationConfig({
      TENANCY_MODE: 'multi',
      DEFAULT_TENANT_ID: 'default',
      DEFAULT_ROLE_ID: 'member',
      TENANTS_TABLE_NAME: 'tenants',
      ROLE_ASSIGNMENTS_TABLE_NAME: 'role-assignments',
      USER_POOL_ID: 'us-east-1_example',
      BASELINE_GROUPS: 'members,registered-users',
      HOOK_MODULE_PATH: '/opt/hooks/on-signup.js',
    })

    expect(config.tenancyMode).toBe('multi')
    expect(config.baselineGroups).toEqual(['members', 'registered-users'])
    expect(config.hookModulePath).toBe('/opt/hooks/on-signup.js')
  })

  it('treats an unset BASELINE_GROUPS as an empty list, not [""]', () => {
    const config = loadPostConfirmationConfig({
      DEFAULT_TENANT_ID: 'default',
      DEFAULT_ROLE_ID: 'member',
      TENANTS_TABLE_NAME: 'tenants',
      ROLE_ASSIGNMENTS_TABLE_NAME: 'role-assignments',
      USER_POOL_ID: 'us-east-1_example',
    })

    expect(config.baselineGroups).toEqual([])
  })

  it('throws a clear error when a required variable is missing', () => {
    expect(() =>
      loadPostConfirmationConfig({
        DEFAULT_ROLE_ID: 'member',
        TENANTS_TABLE_NAME: 'tenants',
        ROLE_ASSIGNMENTS_TABLE_NAME: 'role-assignments',
        USER_POOL_ID: 'us-east-1_example',
      }),
    ).toThrow(/DEFAULT_TENANT_ID/)
  })
})
