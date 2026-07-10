export class ForbiddenError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ForbiddenError'
  }
}

export interface CallerContext {
  tenantId?: string
  privileges: string[]
}

/**
 * Reconstructs the caller's tenant + privilege list from the JWT claims API
 * Gateway's JWT authorizer forwards through. This is the defense-in-depth
 * check: the authorizer already verified the token's signature/issuer, but
 * each handler independently re-derives and re-checks privileges rather than
 * trusting the authorizer's mere presence.
 */
export function extractCallerContext(claims: Record<string, string | undefined>): CallerContext {
  return {
    tenantId: claims.tenantId,
    privileges: claims.permissions ? claims.permissions.split(',').filter(Boolean) : [],
  }
}

export type AccessScope = 'own' | 'global' | 'none'

/**
 * A privilege family (e.g. "admin:users:read") has no separate "scope" claim
 * in the token -- scope is encoded directly in the privilege string itself,
 * as either `${family}:own` (same tenant only) or `${family}:*` (all
 * tenants). This is the concrete privilege-naming convention this package's
 * own admin API commits to; it is not imposed on other downstream consumers.
 */
export function resolveAccessScope(caller: CallerContext, privilegeFamily: string): AccessScope {
  if (caller.privileges.includes(`${privilegeFamily}:*`)) {
    return 'global'
  }
  if (caller.privileges.includes(`${privilegeFamily}:own`)) {
    return 'own'
  }
  return 'none'
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
