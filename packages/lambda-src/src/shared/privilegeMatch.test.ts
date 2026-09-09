import { describe, expect, it } from 'vitest'
import { hasPrivilege, matchesResourceGlob, parsePrivilege, resolveGrantedTenant } from './privilegeMatch'

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

describe('hasPrivilege - resource glob matching (tenant-irrelevant checks)', () => {
  it('matches an exact literal resource', () => {
    expect(hasPrivilege(['read:acme-corp:orders'], { verb: 'read', resource: 'orders' }, [])).toBe(
      true,
    )
  })

  it('does not match a different literal resource', () => {
    expect(
      hasPrivilege(['read:acme-corp:orders'], { verb: 'read', resource: 'invoices' }, []),
    ).toBe(false)
  })

  it('matches "*" against a single path segment', () => {
    expect(
      hasPrivilege(['read:acme-corp:orders/*'], { verb: 'read', resource: 'orders/123' }, []),
    ).toBe(true)
  })

  it('does not let "*" cross a segment boundary', () => {
    expect(
      hasPrivilege(
        ['read:acme-corp:orders/*'],
        { verb: 'read', resource: 'orders/123/items' },
        [],
      ),
    ).toBe(false)
  })

  it('does not let "*" match a missing segment', () => {
    expect(
      hasPrivilege(['read:acme-corp:orders/*'], { verb: 'read', resource: 'orders' }, []),
    ).toBe(false)
  })

  it('matches "*" mid-pattern against partial segment text', () => {
    expect(hasPrivilege(['read:acme-corp:ord*rs'], { verb: 'read', resource: 'orders' }, [])).toBe(
      true,
    )
  })

  it('lets "**" traverse zero segments', () => {
    expect(
      hasPrivilege(['read:acme-corp:orders/**'], { verb: 'read', resource: 'orders' }, []),
    ).toBe(true)
  })

  it('lets "**" traverse one segment', () => {
    expect(
      hasPrivilege(['read:acme-corp:orders/**'], { verb: 'read', resource: 'orders/123' }, []),
    ).toBe(true)
  })

  it('lets "**" traverse many segments', () => {
    expect(
      hasPrivilege(
        ['read:acme-corp:orders/**'],
        { verb: 'read', resource: 'orders/123/items/456' },
        [],
      ),
    ).toBe(true)
  })

  it('lets "**" traverse segments in the middle of a pattern', () => {
    expect(
      hasPrivilege(
        ['read:acme-corp:orders/**/items'],
        { verb: 'read', resource: 'orders/123/456/items' },
        [],
      ),
    ).toBe(true)
  })

  it('does not let "**" alone skip a required literal suffix', () => {
    expect(
      hasPrivilege(
        ['read:acme-corp:orders/**/items'],
        { verb: 'read', resource: 'orders/123' },
        [],
      ),
    ).toBe(false)
  })

  it('stays fast against many non-adjacent "**" segments (no unmemoized backtracking blowup)', () => {
    const pattern = Array.from({ length: 12 }, (_, i) => `**/seg${i}`).join('/')
    const resource = Array.from({ length: 40 }, (_, i) => `noise${i}`).join('/')

    const start = performance.now()
    const result = matchesResourceGlob(pattern, resource)
    const elapsedMs = performance.now() - start

    expect(result).toBe(false)
    expect(elapsedMs).toBeLessThan(500)
  })

  it('a bare "**" matches every resource, including the empty one', () => {
    expect(hasPrivilege(['read:acme-corp:**'], { verb: 'read', resource: '' }, [])).toBe(true)
    expect(
      hasPrivilege(['read:acme-corp:**'], { verb: 'read', resource: 'anything/at/all' }, []),
    ).toBe(true)
  })

  it('does not let a literal segment match extra trailing segments without "**"', () => {
    expect(
      hasPrivilege(
        ['read:acme-corp:orders/123'],
        { verb: 'read', resource: 'orders/123/456' },
        [],
      ),
    ).toBe(false)
  })

  it('treats regex metacharacters in the pattern as literal text', () => {
    expect(
      hasPrivilege(['read:acme-corp:orders.v1'], { verb: 'read', resource: 'orders.v1' }, []),
    ).toBe(true)
    expect(
      hasPrivilege(['read:acme-corp:orders.v1'], { verb: 'read', resource: 'ordersXv1' }, []),
    ).toBe(false)
  })

  it('is case-sensitive', () => {
    expect(hasPrivilege(['read:acme-corp:Orders'], { verb: 'read', resource: 'orders' }, [])).toBe(
      false,
    )
  })
})

describe('hasPrivilege - verb and tenant matching', () => {
  it('requires the verb to match exactly', () => {
    expect(
      hasPrivilege(['read:acme-corp:orders'], { verb: 'write', resource: 'orders' }, []),
    ).toBe(false)
  })

  it('a wildcard-tenant grant matches a required tenant the caller is authenticated against', () => {
    expect(
      hasPrivilege(
        ['read:*:orders'],
        { verb: 'read', resource: 'orders', tenantId: 'acme-corp' },
        ['acme-corp'],
      ),
    ).toBe(true)
  })

  it('a wildcard-tenant grant does not reach a tenant the caller is not authenticated against', () => {
    // The core new-model guarantee: a super-admin-style wildcard grant does
    // not let a caller act on a tenant they never actually authenticated to
    // (e.g. its identity provider has different settings than the one they
    // did authenticate against).
    expect(
      hasPrivilege(
        ['read:*:orders'],
        { verb: 'read', resource: 'orders', tenantId: 'never-logged-in-co' },
        ['acme-corp', 'globex'],
      ),
    ).toBe(false)
  })

  it('a tenant-scoped grant matches its own tenant when the caller is authenticated against it', () => {
    expect(
      hasPrivilege(
        ['read:acme-corp:orders'],
        { verb: 'read', resource: 'orders', tenantId: 'acme-corp' },
        ['acme-corp'],
      ),
    ).toBe(true)
  })

  it('a tenant-scoped grant does not leak access to a different tenant', () => {
    expect(
      hasPrivilege(
        ['read:acme-corp:orders'],
        { verb: 'read', resource: 'orders', tenantId: 'other-co' },
        ['acme-corp', 'other-co'],
      ),
    ).toBe(false)
  })

  it('a concrete grant naming a tenant the caller is no longer authenticated against does not match', () => {
    // Defense in depth: even though the grant string itself names the right
    // tenant, a caller whose session no longer covers it (stale grant,
    // session narrowed, etc.) must not be let through.
    expect(
      hasPrivilege(
        ['read:acme-corp:orders'],
        { verb: 'read', resource: 'orders', tenantId: 'acme-corp' },
        ['globex'],
      ),
    ).toBe(false)
  })

  it('a tenant-scoped grant satisfies a tenant-irrelevant check regardless of authenticated tenants', () => {
    expect(
      hasPrivilege(['read:acme-corp:orders'], { verb: 'read', resource: 'orders' }, []),
    ).toBe(true)
  })

  it('ignores malformed grants rather than throwing', () => {
    expect(
      hasPrivilege(['not-a-privilege', 'also:'], { verb: 'read', resource: 'orders' }, []),
    ).toBe(false)
  })

  it('an empty grant list never matches', () => {
    expect(hasPrivilege([], { verb: 'read', resource: 'orders' }, ['acme-corp'])).toBe(false)
  })
})

describe('resolveGrantedTenant', () => {
  it('returns "none" when nothing matches', () => {
    expect(
      resolveGrantedTenant([], { verb: 'read', resource: 'admin/users' }, ['acme-corp']),
    ).toEqual({ scope: 'none' })
  })

  it('returns the concrete tenant for a tenant-scoped grant the caller is authenticated against', () => {
    expect(
      resolveGrantedTenant(['read:acme-corp:admin/users'], { verb: 'read', resource: 'admin/users' }, [
        'acme-corp',
      ]),
    ).toEqual({ scope: 'granted', tenantIds: ['acme-corp'] })
  })

  it('excludes a tenant-scoped grant for a tenant the caller is not authenticated against', () => {
    expect(
      resolveGrantedTenant(['read:acme-corp:admin/users'], { verb: 'read', resource: 'admin/users' }, [
        'globex',
      ]),
    ).toEqual({ scope: 'none' })
  })

  it('collects every distinct authenticated tenant when the caller holds several tenant-scoped grants', () => {
    expect(
      resolveGrantedTenant(
        ['read:acme-corp:admin/users', 'read:globex:admin/users'],
        { verb: 'read', resource: 'admin/users' },
        ['acme-corp', 'globex'],
      ),
    ).toEqual({ scope: 'granted', tenantIds: ['acme-corp', 'globex'] })
  })

  it('dedupes a tenant granted by more than one matching privilege', () => {
    expect(
      resolveGrantedTenant(
        ['read:acme-corp:admin/users', 'read:acme-corp:admin/**'],
        { verb: 'read', resource: 'admin/users' },
        ['acme-corp'],
      ),
    ).toEqual({ scope: 'granted', tenantIds: ['acme-corp'] })
  })

  it('caps a wildcard-tenant grant to exactly the caller\'s authenticated tenants', () => {
    expect(
      resolveGrantedTenant(['read:*:admin/users'], { verb: 'read', resource: 'admin/users' }, [
        'acme-corp',
        'globex',
      ]),
    ).toEqual({ scope: 'granted', tenantIds: ['acme-corp', 'globex'] })
  })

  it('a wildcard-tenant grant resolves to "none" for a caller authenticated against no tenant', () => {
    expect(
      resolveGrantedTenant(['read:*:admin/users'], { verb: 'read', resource: 'admin/users' }, []),
    ).toEqual({ scope: 'none' })
  })

  it('merges a wildcard grant with tenant-scoped grants without duplicates', () => {
    expect(
      resolveGrantedTenant(
        ['read:acme-corp:admin/users', 'read:*:admin/users'],
        { verb: 'read', resource: 'admin/users' },
        ['acme-corp', 'globex'],
      ),
    ).toEqual({ scope: 'granted', tenantIds: ['acme-corp', 'globex'] })
  })

  it('ignores grants for a different verb or resource', () => {
    expect(
      resolveGrantedTenant(
        ['write:acme-corp:admin/users', 'read:acme-corp:admin/roles'],
        { verb: 'read', resource: 'admin/users' },
        ['acme-corp'],
      ),
    ).toEqual({ scope: 'none' })
  })
})
