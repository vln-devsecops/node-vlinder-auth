export interface PreTokenGenerationConfig {
  roleAssignmentsTableName: string
  rolesTableName: string
  hookModulePath?: string
}

const REQUIRED_KEYS = ['ROLE_ASSIGNMENTS_TABLE_NAME', 'ROLES_TABLE_NAME'] as const

export function loadPreTokenGenerationConfig(
  env: Partial<Record<string, string>>,
): PreTokenGenerationConfig {
  for (const key of REQUIRED_KEYS) {
    if (!env[key]) {
      throw new Error(`Missing required environment variable: ${key}`)
    }
  }

  return {
    roleAssignmentsTableName: env.ROLE_ASSIGNMENTS_TABLE_NAME!,
    rolesTableName: env.ROLES_TABLE_NAME!,
    hookModulePath: env.HOOK_MODULE_PATH,
  }
}
