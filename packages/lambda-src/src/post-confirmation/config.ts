import type { TenancyMode } from '../shared/types'

export interface PostConfirmationConfig {
  tenancyMode: TenancyMode
  defaultTenantId: string
  defaultRoleId: string
  tenantsTableName: string
  roleAssignmentsTableName: string
  baselineGroups: string[]
  hookModulePath?: string
}

const REQUIRED_KEYS = [
  'DEFAULT_TENANT_ID',
  'DEFAULT_ROLE_ID',
  'TENANTS_TABLE_NAME',
  'ROLE_ASSIGNMENTS_TABLE_NAME',
] as const

export function loadPostConfirmationConfig(
  env: Partial<Record<string, string>>,
): PostConfirmationConfig {
  for (const key of REQUIRED_KEYS) {
    if (!env[key]) {
      throw new Error(`Missing required environment variable: ${key}`)
    }
  }

  const tenancyMode = (env.TENANCY_MODE ?? 'single') as TenancyMode

  return {
    tenancyMode,
    defaultTenantId: env.DEFAULT_TENANT_ID!,
    defaultRoleId: env.DEFAULT_ROLE_ID!,
    tenantsTableName: env.TENANTS_TABLE_NAME!,
    roleAssignmentsTableName: env.ROLE_ASSIGNMENTS_TABLE_NAME!,
    baselineGroups: env.BASELINE_GROUPS
      ? env.BASELINE_GROUPS.split(',').map((group) => group.trim()).filter(Boolean)
      : [],
    hookModulePath: env.HOOK_MODULE_PATH,
  }
}
