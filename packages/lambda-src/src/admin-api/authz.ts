export class ForbiddenError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ForbiddenError'
  }
}

export interface CallerContext {
  tenantId?: string
  /** The privileges the caller's role grants ("permissions" claim). */
  privileges: string[]
  /**
   * The scopes this particular token is granted ("scope" claim), same
   * privilege shape as {@link privileges}. `undefined` means the token carries
   * no scope claim at all -- i.e. no downscoping, so the role governs (see
   * {@link resolveAccessScope}). An empty array means a scope claim was
   * present but granted nothing.
   */
  scopes?: string[]
}

/**
 * Reconstructs the caller's tenant, role privileges, and token scopes from the
 * JWT claims API Gateway's JWT authorizer forwards through. This is the
 * defense-in-depth check: the authorizer already verified the token's
 * signature/issuer, but each handler independently re-derives and re-checks
 * access rather than trusting the authorizer's mere presence.
 */
export function extractCallerContext(claims: Record<string, string | undefined>): CallerContext {
  return {
    tenantId: claims.tenantId,
    privileges: claims.permissions ? claims.permissions.split(',').filter(Boolean) : [],
    // OAuth-style space-delimited scope claim. Absent (undefined) is distinct
    // from present-but-empty: absent = no downscoping, empty = grants nothing.
    scopes: claims.scope !== undefined ? claims.scope.split(' ').filter(Boolean) : undefined,
  }
}

export type AccessScope = 'own' | 'global' | 'none'

const SCOPE_RANK: Record<AccessScope, number> = { none: 0, own: 1, global: 2 }

/**
 * The tenant-scope a set of grants confers for one privilege family. Scope is
 * encoded in the grant string itself: `${family}:*` (all tenants) > `${family}:own`
 * (same tenant only) > absent (none). This is the concrete privilege-naming
 * convention this package's own admin API commits to; it is not imposed on
 * other downstream consumers.
 */
function grantedScope(grants: string[], privilegeFamily: string): AccessScope {
  if (grants.includes(`${privilegeFamily}:*`)) {
    return 'global'
  }
  if (grants.includes(`${privilegeFamily}:own`)) {
    return 'own'
  }
  return 'none'
}

/**
 * Effective access for a privilege family is the **intersection** of two
 * inputs: the caller's role privileges and this token's granted scopes -- the
 * narrower of the two wins. A token can therefore be *downscoped* below the
 * role, never above it (standard OAuth downscoping).
 *
 * When the token carries no `scope` claim at all (`caller.scopes` undefined),
 * there is no downscoping and the role governs -- absence of a scope means full
 * subject authority, so existing tokens keep their role's full reach.
 */
export function resolveAccessScope(caller: CallerContext, privilegeFamily: string): AccessScope {
  const roleScope = grantedScope(caller.privileges, privilegeFamily)
  const tokenScope =
    caller.scopes === undefined ? 'global' : grantedScope(caller.scopes, privilegeFamily)
  return SCOPE_RANK[roleScope] <= SCOPE_RANK[tokenScope] ? roleScope : tokenScope
}

/** Throws ForbiddenError unless the caller may act on targetTenantId for privilegeFamily. */
export function assertTenantAccess(
  caller: CallerContext,
  privilegeFamily: string,
  targetTenantId: string,
): void {
  const scope = resolveAccessScope(caller, privilegeFamily)

  if (scope === 'global') {
    return
  }
  if (scope === 'own' && caller.tenantId === targetTenantId) {
    return
  }

  throw new ForbiddenError(
    `Missing privilege ${privilegeFamily}:(own|*) for tenant ${targetTenantId}`,
  )
}
