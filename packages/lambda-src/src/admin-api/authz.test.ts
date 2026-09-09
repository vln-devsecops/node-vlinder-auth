import { describe, expect, it } from 'vitest'
import {
  assertTenantAccess,
  callerHasPrivilege,
  extractCallerContext,
  ForbiddenError,
  resolveCallerTenantScope,
} from './authz'

describe('extractCallerContext', () => {
  it('splits the space-delimited tenants and scope claims', () => {
    const caller = extractCallerContext({
      tenants: 'acme-corp globex',
      scope: 'read:acme-corp:admin/users write:acme-corp:admin/users',
    })

    expect(caller).toEqual({
      tenants: ['acme-corp', 'globex'],
      scopes: ['read:acme-corp:admin/users', 'write:acme-corp:admin/users'],
    })
  })

  it('handles a missing tenants claim as no authenticated tenants', () => {
    expect(extractCallerContext({}).tenants).toEqual([])
  })

  it('handles a missing scope claim as an empty scope list', () => {
    expect(extractCallerContext({}).scopes).toEqual([])
  })

  it('handles a present-but-empty tenants or scope claim as empty', () => {
    expect(extractCallerContext({ tenants: '', scope: '' })).toEqual({ tenants: [], scopes: [] })
  })
})

describe('callerHasPrivilege', () => {
  it('is true when a scope matches verb, tenant and resource, and the tenant is authenticated', () => {
    expect(
      callerHasPrivilege(
        { tenants: ['acme-corp'], scopes: ['read:acme-corp:admin/users'] },
        { verb: 'read', resource: 'admin/users', tenantId: 'acme-corp' },
      ),
    ).toBe(true)
  })

  it('is false when the caller holds no matching scope', () => {
    expect(
      callerHasPrivilege(
        { tenants: ['acme-corp'], scopes: [] },
        { verb: 'read', resource: 'admin/users', tenantId: 'acme-corp' },
      ),
    ).toBe(false)
  })

  it('is false when the matching scope is for a tenant the caller is not authenticated against', () => {
    expect(
      callerHasPrivilege(
        { tenants: ['globex'], scopes: ['read:*:admin/users'] },
        { verb: 'read', resource: 'admin/users', tenantId: 'acme-corp' },
      ),
    ).toBe(false)
  })
})

describe('resolveCallerTenantScope', () => {
  it('caps a tenant-wildcard scope to the caller\'s authenticated tenants', () => {
    const granted = resolveCallerTenantScope(
      { tenants: ['acme-corp', 'globex'], scopes: ['read:*:admin/users'] },
      { verb: 'read', resource: 'admin/users' },
    )
    expect(granted).toEqual({ scope: 'granted', tenantIds: ['acme-corp', 'globex'] })
  })

  it('returns the concrete tenant when the caller holds only a tenant-scoped scope', () => {
    const granted = resolveCallerTenantScope(
      { tenants: ['acme-corp'], scopes: ['read:acme-corp:admin/users'] },
      { verb: 'read', resource: 'admin/users' },
    )
    expect(granted).toEqual({ scope: 'granted', tenantIds: ['acme-corp'] })
  })

  it('returns "none" when the caller holds neither variant', () => {
    const granted = resolveCallerTenantScope(
      { tenants: ['acme-corp'], scopes: ['read:acme-corp:admin/roles'] },
      { verb: 'read', resource: 'admin/users' },
    )
    expect(granted).toEqual({ scope: 'none' })
  })

  it('returns "none" for a tenant-scoped grant naming a tenant the caller is not authenticated against', () => {
    const granted = resolveCallerTenantScope(
      { tenants: ['globex'], scopes: ['read:acme-corp:admin/users'] },
      { verb: 'read', resource: 'admin/users' },
    )
    expect(granted).toEqual({ scope: 'none' })
  })
})

describe('assertTenantAccess', () => {
  it('allows a tenant-wildcard scope when the target tenant is authenticated', () => {
    expect(() =>
      assertTenantAccess(
        { tenants: ['acme-corp'], scopes: ['read:*:admin/users'] },
        { verb: 'read', resource: 'admin/users' },
        'acme-corp',
      ),
    ).not.toThrow()
  })

  it('rejects a tenant-wildcard scope for a target tenant the caller never authenticated against', () => {
    expect(() =>
      assertTenantAccess(
        { tenants: ['acme-corp'], scopes: ['read:*:admin/users'] },
        { verb: 'read', resource: 'admin/users' },
        'some-other-tenant',
      ),
    ).toThrow(ForbiddenError)
  })

  it('allows a tenant-scoped scope when the target tenant matches and is authenticated', () => {
    expect(() =>
      assertTenantAccess(
        { tenants: ['acme-corp'], scopes: ['read:acme-corp:admin/users'] },
        { verb: 'read', resource: 'admin/users' },
        'acme-corp',
      ),
    ).not.toThrow()
  })

  it('rejects a tenant-scoped scope targeting a different tenant', () => {
    expect(() =>
      assertTenantAccess(
        { tenants: ['acme-corp', 'some-other-tenant'], scopes: ['read:acme-corp:admin/users'] },
        { verb: 'read', resource: 'admin/users' },
        'some-other-tenant',
      ),
    ).toThrow(ForbiddenError)
  })

  it('rejects a caller with no matching scope at all', () => {
    expect(() =>
      assertTenantAccess(
        { tenants: ['acme-corp'], scopes: [] },
        { verb: 'read', resource: 'admin/users' },
        'acme-corp',
      ),
    ).toThrow(ForbiddenError)
  })

  it('rejects a caller holding only the wrong verb', () => {
    expect(() =>
      assertTenantAccess(
        { tenants: ['acme-corp'], scopes: ['write:acme-corp:admin/users'] },
        { verb: 'read', resource: 'admin/users' },
        'acme-corp',
      ),
    ).toThrow(ForbiddenError)
  })
})
