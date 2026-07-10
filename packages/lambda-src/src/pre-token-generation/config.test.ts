import { describe, expect, it } from 'vitest'
import { loadPreTokenGenerationConfig } from './config'

describe('loadPreTokenGenerationConfig', () => {
  it('reads the required table names', () => {
    const config = loadPreTokenGenerationConfig({
      ROLE_ASSIGNMENTS_TABLE_NAME: 'role-assignments',
      ROLES_TABLE_NAME: 'roles',
    })

    expect(config).toEqual({
      roleAssignmentsTableName: 'role-assignments',
      rolesTableName: 'roles',
      hookModulePath: undefined,
    })
  })

  it('reads an optional hook module path', () => {
    const config = loadPreTokenGenerationConfig({
      ROLE_ASSIGNMENTS_TABLE_NAME: 'role-assignments',
      ROLES_TABLE_NAME: 'roles',
      HOOK_MODULE_PATH: '/opt/hooks/on-token.js',
    })

    expect(config.hookModulePath).toBe('/opt/hooks/on-token.js')
  })

  it('throws a clear error when a required variable is missing', () => {
    expect(() =>
      loadPreTokenGenerationConfig({ ROLE_ASSIGNMENTS_TABLE_NAME: 'role-assignments' }),
    ).toThrow(/ROLES_TABLE_NAME/)
  })
})
