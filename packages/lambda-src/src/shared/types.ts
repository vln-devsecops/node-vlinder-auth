export type TenancyMode = 'single' | 'multi'

export type RoleScope = 'tenant' | 'global'

export interface RoleDefinition {
  roleId: string
  privileges: string[]
  tenantScope: RoleScope
}

/** One row of the assignments table: a single (user, tenant, role) grant. */
export interface RoleAssignment {
  userId: string
  tenantId: string
  roleId: string
}

/**
 * A user's full set of roles within their tenant. A user may hold several
 * roles per tenant; their effective privileges are the union across all of
 * them (v1 keeps a user in a single tenant -- see resolveUserRoleAssignments).
 */
export interface UserRoleAssignments {
  userId: string
  tenantId: string
  roleIds: string[]
}
