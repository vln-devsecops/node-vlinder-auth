import { describe, expect, it } from 'vitest'
import { assertTenantAccess, extractCallerContext, ForbiddenError, resolveAccessScope } from './authz'

describe('extractCallerContext', () => {
  it('splits the comma-joined permissions claim into a privilege list', () => {
    const caller = extractCallerContext({
      tenantId: 'acme-corp',
      permissions: 'admin:users:read:own,admin:users:write:own',
    })

    expect(caller).toEqual({
      tenantId: 'acme-corp',
      privileges: ['admin:users:read:own', 'admin:users:write:own'],
    })
  })

  it('handles a missing permissions claim as an empty privilege list', () => {
    const caller = extractCallerContext({ tenantId: 'acme-corp' })
    expect(caller.privileges).toEqual([])
  })
})

describe('resolveAccessScope', () => {
  it('returns "global" when the caller holds the wildcard privilege', () => {
    const scope = resolveAccessScope(
      { tenantId: 'acme-corp', privileges: ['admin:users:read:*'] },
      'admin:users:read',
    )
    expect(scope).toBe('global')
  })

  it('returns "own" when the caller holds only the tenant-scoped privilege', () => {
    const scope = resolveAccessScope(
      { tenantId: 'acme-corp', privileges: ['admin:users:read:own'] },
      'admin:users:read',
    )
    expect(scope).toBe('own')
  })

  it('returns "none" when the caller holds neither variant', () => {
    const scope = resolveAccessScope(
      { tenantId: 'acme-corp', privileges: ['admin:roles:read'] },
      'admin:users:read',
    )
    expect(scope).toBe('none')
  })

  it('prefers "global" when the caller somehow holds both variants', () => {
    const scope = resolveAccessScope(
      { tenantId: 'acme-corp', privileges: ['admin:users:read:own', 'admin:users:read:*'] },
      'admin:users:read',
    )
    expect(scope).toBe('global')
  })
})

describe('assertTenantAccess', () => {
  it('allows a global-scoped caller regardless of the target tenant', () => {
    expect(() =>
      assertTenantAccess(
        { tenantId: 'acme-corp', privileges: ['admin:users:read:*'] },
        'admin:users:read',
        'some-other-tenant',
      ),
    ).not.toThrow()
  })

  it('allows an own-scoped caller when the target tenant matches their own', () => {
    expect(() =>
      assertTenantAccess(
        { tenantId: 'acme-corp', privileges: ['admin:users:read:own'] },
        'admin:users:read',
        'acme-corp',
      ),
    ).not.toThrow()
  })

  it('rejects an own-scoped caller targeting a different tenant', () => {
    expect(() =>
      assertTenantAccess(
        { tenantId: 'acme-corp', privileges: ['admin:users:read:own'] },
        'admin:users:read',
        'some-other-tenant',
      ),
    ).toThrow(ForbiddenError)
  })

  it('rejects a caller with neither privilege variant', () => {
    expect(() =>
      assertTenantAccess({ tenantId: 'acme-corp', privileges: [] }, 'admin:users:read', 'acme-corp'),
    ).toThrow(ForbiddenError)
  })
})
