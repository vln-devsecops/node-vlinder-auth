export type TenancyMode = 'single' | 'multi'

export type RoleScope = 'tenant' | 'global'

export interface RoleDefinition {
  roleId: string
  privileges: string[]
  tenantScope: RoleScope
}

export interface RoleAssignment {
  userId: string
  tenantId: string
  roleId: string
}
