import {
  hasPrivilege,
  resolveGrantedTenant,
  type GrantedTenantScope,
  type RequiredPrivilege,
} from '../shared/privilegeMatch'

export class ForbiddenError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ForbiddenError'
  }
}

export interface CallerContext {
  /**
   * The token's `scope` claim, space-delimited per OAuth convention and
   * split here. The token is authoritative -- there is no separate role,
   * "permissions", or tenant-id input to reconcile this against. Every
   * tenant a caller may act on is named by their scopes themselves
   * (`verb:tenant-id:resource-glob`); a bare `tenantId` claim is not
   * consulted here, so there is exactly one source of truth to read and
   * nothing to silently prefer over something else.
   */
  scopes: string[]
}

/**
 * Reconstructs the caller's granted scopes from the JWT claims API Gateway's
 * JWT authorizer forwards through. This is the defense-in-depth check: the
 * authorizer already verified the token's signature/issuer, but each handler
 * independently re-derives and re-checks access rather than trusting the
 * authorizer's mere presence.
 */
export function extractCallerContext(claims: Record<string, string | undefined>): CallerContext {
  return {
    scopes: claims.scope ? claims.scope.split(' ').filter(Boolean) : [],
  }
}

export type { RequiredPrivilege }

/** A privilege check with no tenant opinion of its own -- see {@link RequiredPrivilege.tenantId}. */
export type TenantAgnosticPrivilege = Omit<RequiredPrivilege, 'tenantId'>

/** Whether the caller holds a privilege matching `required`, tenant included if given. */
export function callerHasPrivilege(caller: CallerContext, required: RequiredPrivilege): boolean {
  return hasPrivilege(caller.scopes, required)
}

/** Which tenant(s), if any, the caller's scopes grant `required` access to. */
export function resolveCallerTenantScope(
  caller: CallerContext,
  required: TenantAgnosticPrivilege,
): GrantedTenantScope {
  return resolveGrantedTenant(caller.scopes, required)
}

/** Throws ForbiddenError unless the caller holds `required` for targetTenantId. */
export function assertTenantAccess(
  caller: CallerContext,
  required: TenantAgnosticPrivilege,
  targetTenantId: string,
): void {
  if (!callerHasPrivilege(caller, { ...required, tenantId: targetTenantId })) {
    throw new ForbiddenError(
      `Missing privilege ${required.verb}:${targetTenantId}:${required.resource} (or a tenant-wildcard grant)`,
    )
  }
}
