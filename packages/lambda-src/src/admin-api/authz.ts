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
  tenantId?: string
  /**
   * The token's `scope` claim, space-delimited per OAuth convention and
   * split here. The token is authoritative -- there is no separate role or
   * "permissions" input to reconcile this against.
   */
  scopes: string[]
}

/**
 * Reconstructs the caller's tenant and granted scopes from the JWT claims
 * API Gateway's JWT authorizer forwards through. This is the defense-in-depth
 * check: the authorizer already verified the token's signature/issuer, but
 * each handler independently re-derives and re-checks access rather than
 * trusting the authorizer's mere presence.
 */
export function extractCallerContext(claims: Record<string, string | undefined>): CallerContext {
  return {
    tenantId: claims.tenantId,
    scopes: claims.scope ? claims.scope.split(' ').filter(Boolean) : [],
  }
}

export type { RequiredPrivilege }

/** Whether the caller holds a privilege matching `required`, tenant included if given. */
export function callerHasPrivilege(caller: CallerContext, required: RequiredPrivilege): boolean {
  return hasPrivilege(caller.scopes, required)
}

/** Which tenant(s), if any, the caller's scopes grant `required` access to. */
export function resolveCallerTenantScope(
  caller: CallerContext,
  required: { verb: string; resource: string },
): GrantedTenantScope {
  return resolveGrantedTenant(caller.scopes, required)
}

/** Throws ForbiddenError unless the caller holds `required` for targetTenantId. */
export function assertTenantAccess(
  caller: CallerContext,
  required: { verb: string; resource: string },
  targetTenantId: string,
): void {
  if (!callerHasPrivilege(caller, { ...required, tenantId: targetTenantId })) {
    throw new ForbiddenError(
      `Missing privilege ${required.verb}:${targetTenantId}:${required.resource} (or a tenant-wildcard grant)`,
    )
  }
}
