export type TenancyMode = 'single' | 'multi'

export type RoleScope = 'tenant' | 'global'

export interface RoleDefinition {
  roleId: string
  privileges: string[]
  tenantScope: RoleScope
}

/**
 * Whether a held role is active the moment the user logs in (`default`) or is
 * held but contributes no privileges until a deliberate sudo step-up
 * (`elevated`). The login token unions only the `default` roles; elevation
 * widens toward the `elevated` ones (the elevation flow itself is future work).
 */
export type RoleActivation = 'default' | 'elevated'

/** A role a user holds, with how it activates. */
export interface AssignedRole {
  roleId: string
  activation: RoleActivation
}

/** One row of the assignments table: a single (user, tenant, role) grant. */
export interface RoleAssignment {
  userId: string
  tenantId: string
  roleId: string
  activation: RoleActivation
}

/** A user's roles within one tenant. */
export interface TenantRoles {
  tenantId: string
  roles: AssignedRole[]
}

/**
 * A user's full set of roles, grouped by tenant. A user may hold several
 * roles per tenant and may hold assignments in more than one tenant at
 * once (a user logged in on more than one tenant simultaneously); their
 * effective (login) privileges are the union, per tenant, of the `default`
 * ones -- see resolveUserRoleAssignments and resolvePrivilegesForUser.
 */
export interface UserRoleAssignments {
  userId: string
  tenants: TenantRoles[]
}
