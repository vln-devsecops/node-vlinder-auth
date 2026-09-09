import { describe, expect, it } from 'vitest'
import { hasPrivilege, parsePrivilege, resolveGrantedTenant } from './privilegeMatch'

describe('parsePrivilege', () => {
  it('parses the full verb:tenant-id:resource-glob form', () => {
    expect(parsePrivilege('refund:acme-corp:orders/**')).toEqual({
      verb: 'refund',
      tenantId: 'acme-corp',
      resource: 'orders/**',
    })
  })

  it('treats a two-part verb:resource-glob as tenant-irrelevant', () => {
    expect(parsePrivilege('admin:federation')).toEqual({
      verb: 'admin',
      tenantId: undefined,
      resource: 'federation',
    })
  })

  it('treats an empty middle segment (verb::resource-glob) as tenant-irrelevant', () => {
    expect(parsePrivilege('admin::federation')).toEqual({
      verb: 'admin',
      tenantId: undefined,
      resource: 'federation',
    })
  })

  it('treats an explicit wildcard tenant (verb:*:resource-glob) as tenant-irrelevant', () => {
    expect(parsePrivilege('admin:*:federation')).toEqual({
      verb: 'admin',
      tenantId: undefined,
      resource: 'federation',
    })
  })

  it('rejects a bare verb with no resource', () => {
    expect(parsePrivilege('admin')).toBeUndefined()
  })

  it('rejects an empty string', () => {
    expect(parsePrivilege('')).toBeUndefined()
  })

  it('rejects an empty verb', () => {
    expect(parsePrivilege(':acme-corp:orders/**')).toBeUndefined()
  })

  it('rejects an empty resource in the three-part form', () => {
    expect(parsePrivilege('refund:acme-corp:')).toBeUndefined()
  })

  it('rejects an empty resource in the two-part form', () => {
    expect(parsePrivilege('refund:')).toBeUndefined()
  })

  it('rejects more than three colon-separated segments', () => {
    expect(parsePrivilege('refund:acme-corp:orders:extra')).toBeUndefined()
  })
})

describe('hasPrivilege - resource glob matching', () => {
  it('matches an exact literal resource', () => {
    expect(hasPrivilege(['read:acme-corp:orders'], { verb: 'read', resource: 'orders' })).toBe(
      true,
    )
  })

  it('does not match a different literal resource', () => {
    expect(hasPrivilege(['read:acme-corp:orders'], { verb: 'read', resource: 'invoices' })).toBe(
      false,
    )
  })

  it('matches "*" against a single path segment', () => {
    expect(
      hasPrivilege(['read:acme-corp:orders/*'], { verb: 'read', resource: 'orders/123' }),
    ).toBe(true)
  })

  it('does not let "*" cross a segment boundary', () => {
    expect(
      hasPrivilege(['read:acme-corp:orders/*'], { verb: 'read', resource: 'orders/123/items' }),
    ).toBe(false)
  })

  it('does not let "*" match a missing segment', () => {
    expect(hasPrivilege(['read:acme-corp:orders/*'], { verb: 'read', resource: 'orders' })).toBe(
      false,
    )
  })

  it('matches "*" mid-pattern against partial segment text', () => {
    expect(
      hasPrivilege(['read:acme-corp:ord*rs'], { verb: 'read', resource: 'orders' }),
    ).toBe(true)
  })

  it('lets "**" traverse zero segments', () => {
    expect(hasPrivilege(['read:acme-corp:orders/**'], { verb: 'read', resource: 'orders' })).toBe(
      true,
    )
  })

  it('lets "**" traverse one segment', () => {
    expect(
      hasPrivilege(['read:acme-corp:orders/**'], { verb: 'read', resource: 'orders/123' }),
    ).toBe(true)
  })

  it('lets "**" traverse many segments', () => {
    expect(
      hasPrivilege(['read:acme-corp:orders/**'], {
        verb: 'read',
        resource: 'orders/123/items/456',
      }),
    ).toBe(true)
  })

  it('lets "**" traverse segments in the middle of a pattern', () => {
    expect(
      hasPrivilege(['read:acme-corp:orders/**/items'], {
        verb: 'read',
        resource: 'orders/123/456/items',
      }),
    ).toBe(true)
  })

  it('does not let "**" alone skip a required literal suffix', () => {
    expect(
      hasPrivilege(['read:acme-corp:orders/**/items'], {
        verb: 'read',
        resource: 'orders/123',
      }),
    ).toBe(false)
  })

  it('a bare "**" matches every resource, including the empty one', () => {
    expect(hasPrivilege(['read:acme-corp:**'], { verb: 'read', resource: '' })).toBe(true)
    expect(
      hasPrivilege(['read:acme-corp:**'], { verb: 'read', resource: 'anything/at/all' }),
    ).toBe(true)
  })

  it('does not let a literal segment match extra trailing segments without "**"', () => {
    expect(
      hasPrivilege(['read:acme-corp:orders/123'], { verb: 'read', resource: 'orders/123/456' }),
    ).toBe(false)
  })

  it('treats regex metacharacters in the pattern as literal text', () => {
    expect(
      hasPrivilege(['read:acme-corp:orders.v1'], { verb: 'read', resource: 'orders.v1' }),
    ).toBe(true)
    expect(
      hasPrivilege(['read:acme-corp:orders.v1'], { verb: 'read', resource: 'ordersXv1' }),
    ).toBe(false)
  })

  it('is case-sensitive', () => {
    expect(hasPrivilege(['read:acme-corp:Orders'], { verb: 'read', resource: 'orders' })).toBe(
      false,
    )
  })
})

describe('hasPrivilege - verb and tenant matching', () => {
  it('requires the verb to match exactly', () => {
    expect(hasPrivilege(['read:acme-corp:orders'], { verb: 'write', resource: 'orders' })).toBe(
      false,
    )
  })

  it('a wildcard-tenant grant matches any required tenant', () => {
    expect(
      hasPrivilege(['read:*:orders'], { verb: 'read', resource: 'orders', tenantId: 'acme-corp' }),
    ).toBe(true)
    expect(
      hasPrivilege(['read:*:orders'], { verb: 'read', resource: 'orders', tenantId: 'other-co' }),
    ).toBe(true)
  })

  it('a tenant-scoped grant matches only its own tenant', () => {
    expect(
      hasPrivilege(['read:acme-corp:orders'], {
        verb: 'read',
        resource: 'orders',
        tenantId: 'acme-corp',
      }),
    ).toBe(true)
  })

  it('a tenant-scoped grant does not leak access to a different tenant', () => {
    expect(
      hasPrivilege(['read:acme-corp:orders'], {
        verb: 'read',
        resource: 'orders',
        tenantId: 'other-co',
      }),
    ).toBe(false)
  })

  it('a tenant-scoped grant satisfies a tenant-irrelevant check (no tenantId required)', () => {
    expect(hasPrivilege(['read:acme-corp:orders'], { verb: 'read', resource: 'orders' })).toBe(
      true,
    )
  })

  it('ignores malformed grants rather than throwing', () => {
    expect(hasPrivilege(['not-a-privilege', 'also:'], { verb: 'read', resource: 'orders' })).toBe(
      false,
    )
  })

  it('an empty grant list never matches', () => {
    expect(hasPrivilege([], { verb: 'read', resource: 'orders' })).toBe(false)
  })
})

describe('resolveGrantedTenant', () => {
  it('returns "none" when nothing matches', () => {
    expect(resolveGrantedTenant([], { verb: 'read', resource: 'admin/users' })).toEqual({
      scope: 'none',
    })
  })

  it('returns the concrete tenant for a tenant-scoped grant', () => {
    expect(
      resolveGrantedTenant(['read:acme-corp:admin/users'], {
        verb: 'read',
        resource: 'admin/users',
      }),
    ).toEqual({ scope: 'own', tenantId: 'acme-corp' })
  })

  it('returns "global" for a wildcard-tenant grant', () => {
    expect(
      resolveGrantedTenant(['read:*:admin/users'], { verb: 'read', resource: 'admin/users' }),
    ).toEqual({ scope: 'global' })
  })

  it('prefers "global" even when an own-tenant grant is also present', () => {
    expect(
      resolveGrantedTenant(['read:acme-corp:admin/users', 'read:*:admin/users'], {
        verb: 'read',
        resource: 'admin/users',
      }),
    ).toEqual({ scope: 'global' })
  })

  it('ignores grants for a different verb or resource', () => {
    expect(
      resolveGrantedTenant(['write:acme-corp:admin/users', 'read:acme-corp:admin/roles'], {
        verb: 'read',
        resource: 'admin/users',
      }),
    ).toEqual({ scope: 'none' })
  })
})
