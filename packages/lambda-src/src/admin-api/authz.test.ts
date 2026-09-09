import { describe, expect, it } from 'vitest'
import {
  assertTenantAccess,
  callerHasPrivilege,
  extractCallerContext,
  ForbiddenError,
  resolveCallerTenantScope,
} from './authz'

describe('extractCallerContext', () => {
  it('splits the space-delimited scope claim into a scope list', () => {
    const caller = extractCallerContext({
      scope: 'read:acme-corp:admin/users write:acme-corp:admin/users',
    })

    expect(caller).toEqual({
      scopes: ['read:acme-corp:admin/users', 'write:acme-corp:admin/users'],
    })
  })

  it('handles a missing scope claim as an empty scope list', () => {
    const caller = extractCallerContext({})
    expect(caller.scopes).toEqual([])
  })

  it('handles a present-but-empty scope claim as an empty scope list', () => {
    expect(extractCallerContext({ scope: '' }).scopes).toEqual([])
  })

  it('ignores any other claims, including a bare tenantId', () => {
    // The token's tenant is carried in each scope itself
    // (verb:tenant-id:resource-glob), not read from a separate claim -- there
    // is exactly one source of truth here, nothing to reconcile it against.
    const caller = extractCallerContext({
      tenantId: 'acme-corp',
      scope: 'read:acme-corp:admin/users',
    })
    expect(caller).toEqual({ scopes: ['read:acme-corp:admin/users'] })
  })
})

describe('callerHasPrivilege', () => {
  it('is true when a scope matches verb, tenant and resource', () => {
    expect(
      callerHasPrivilege(
        { scopes: ['read:acme-corp:admin/users'] },
        { verb: 'read', resource: 'admin/users', tenantId: 'acme-corp' },
      ),
    ).toBe(true)
  })

  it('is false when the caller holds no matching scope', () => {
    expect(
      callerHasPrivilege(
        { scopes: [] },
        { verb: 'read', resource: 'admin/users', tenantId: 'acme-corp' },
      ),
    ).toBe(false)
  })
})

describe('resolveCallerTenantScope', () => {
  it('returns "global" when the caller holds a tenant-wildcard scope', () => {
    const granted = resolveCallerTenantScope(
      { scopes: ['read:*:admin/users'] },
      { verb: 'read', resource: 'admin/users' },
    )
    expect(granted).toEqual({ scope: 'global' })
  })

  it('returns the concrete tenant when the caller holds only a tenant-scoped scope', () => {
    const granted = resolveCallerTenantScope(
      { scopes: ['read:acme-corp:admin/users'] },
      { verb: 'read', resource: 'admin/users' },
    )
    expect(granted).toEqual({ scope: 'own', tenantIds: ['acme-corp'] })
  })

  it('returns "none" when the caller holds neither variant', () => {
    const granted = resolveCallerTenantScope(
      { scopes: ['read:acme-corp:admin/roles'] },
      { verb: 'read', resource: 'admin/users' },
    )
    expect(granted).toEqual({ scope: 'none' })
  })

  it('prefers "global" when the caller holds both variants', () => {
    const granted = resolveCallerTenantScope(
      { scopes: ['read:acme-corp:admin/users', 'read:*:admin/users'] },
      { verb: 'read', resource: 'admin/users' },
    )
    expect(granted).toEqual({ scope: 'global' })
  })
})

describe('assertTenantAccess', () => {
  it('allows a tenant-wildcard scope regardless of the target tenant', () => {
    expect(() =>
      assertTenantAccess(
        { scopes: ['read:*:admin/users'] },
        { verb: 'read', resource: 'admin/users' },
        'some-other-tenant',
      ),
    ).not.toThrow()
  })

  it('allows a tenant-scoped scope when the target tenant matches', () => {
    expect(() =>
      assertTenantAccess(
        { scopes: ['read:acme-corp:admin/users'] },
        { verb: 'read', resource: 'admin/users' },
        'acme-corp',
      ),
    ).not.toThrow()
  })

  it('rejects a tenant-scoped scope targeting a different tenant', () => {
    expect(() =>
      assertTenantAccess(
        { scopes: ['read:acme-corp:admin/users'] },
        { verb: 'read', resource: 'admin/users' },
        'some-other-tenant',
      ),
    ).toThrow(ForbiddenError)
  })

  it('rejects a caller with no matching scope at all', () => {
    expect(() =>
      assertTenantAccess({ scopes: [] }, { verb: 'read', resource: 'admin/users' }, 'acme-corp'),
    ).toThrow(ForbiddenError)
  })

  it('rejects a caller holding only the wrong verb', () => {
    expect(() =>
      assertTenantAccess(
        { scopes: ['write:acme-corp:admin/users'] },
        { verb: 'read', resource: 'admin/users' },
        'acme-corp',
      ),
    ).toThrow(ForbiddenError)
  })
})
