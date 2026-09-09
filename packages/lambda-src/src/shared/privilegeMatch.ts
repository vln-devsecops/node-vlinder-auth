/**
 * A privilege written as `verb:tenant-id:resource-glob`. `tenantId` is
 * `undefined` when the grant is not tied to any one tenant -- the
 * `verb:resource-glob`, `verb::resource-glob` and `verb:*:resource-glob`
 * spellings are all equivalent ways of saying that.
 */
export interface ParsedPrivilege {
  verb: string
  tenantId: string | undefined
  resource: string
}

/**
 * Parses one privilege string. Returns `undefined` for anything malformed
 * (bare verb, empty verb/resource, more than three colon-separated segments)
 * so a bad grant is silently ignored rather than crashing or -- worse --
 * being coerced into matching more than it should.
 */
export function parsePrivilege(privilege: string): ParsedPrivilege | undefined {
  const parts = privilege.split(':')

  if (parts.length === 2) {
    const [verb, resource] = parts
    if (!verb || !resource) {
      return undefined
    }
    return { verb, tenantId: undefined, resource }
  }

  if (parts.length === 3) {
    const [verb, tenant, resource] = parts
    if (!verb || !resource) {
      return undefined
    }
    return { verb, tenantId: tenant === '' || tenant === '*' ? undefined : tenant, resource }
  }

  return undefined
}

/**
 * Converts one gitignore-style resource-glob segment (no `/`) to a regex
 * fragment. `*` matches any run of non-`/` characters, including none;
 * everything else is escaped so regex metacharacters in a literal resource
 * name (`.`, `+`, etc.) are matched literally rather than interpreted.
 */
function segmentToRegexSource(segment: string): string {
  return segment
    .split('*')
    .map((literal) => literal.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`))
    .join('[^/]*')
}

/**
 * Matches a gitignore-style resource-glob against a concrete resource path.
 * `*` matches within one `/`-separated segment; `**` matches zero or more
 * whole segments, crossing `/` boundaries -- this is the traversal-boundary
 * logic step 1 calls out as the place a subtle bug grants access it
 * shouldn't, so it's implemented as an explicit recursive segment walk
 * rather than a single hand-rolled regex.
 */
export function matchesResourceGlob(pattern: string, resource: string): boolean {
  const patternSegments = pattern.split('/')
  const resourceSegments = resource.split('/')

  function matchFrom(patternIndex: number, resourceIndex: number): boolean {
    if (patternIndex === patternSegments.length) {
      return resourceIndex === resourceSegments.length
    }

    const segment = patternSegments[patternIndex]

    if (segment === '**') {
      // Try consuming zero resource segments here, then one, then two, ...
      for (let skip = resourceIndex; skip <= resourceSegments.length; skip++) {
        if (matchFrom(patternIndex + 1, skip)) {
          return true
        }
      }
      return false
    }

    if (resourceIndex === resourceSegments.length) {
      return false
    }

    const regex = new RegExp(`^${segmentToRegexSource(segment)}$`)
    return regex.test(resourceSegments[resourceIndex]) && matchFrom(patternIndex + 1, resourceIndex + 1)
  }

  return matchFrom(0, 0)
}

export interface RequiredPrivilege {
  verb: string
  resource: string
  /**
   * Omit when the check is not tied to any one tenant (e.g. reference data
   * every tenant shares) -- any grant satisfies it regardless of the
   * grant's own tenant segment. Provide it to require the grant be either
   * tenant-wildcard or scoped to this exact tenant.
   */
  tenantId?: string
}

function grantSatisfies(grant: ParsedPrivilege, required: RequiredPrivilege): boolean {
  if (grant.verb !== required.verb) {
    return false
  }
  if (required.tenantId !== undefined && grant.tenantId !== undefined) {
    if (grant.tenantId !== required.tenantId) {
      return false
    }
  }
  return matchesResourceGlob(grant.resource, required.resource)
}

/** Whether any grant in the list satisfies the required privilege. */
export function hasPrivilege(grants: string[], required: RequiredPrivilege): boolean {
  return grants.some((raw) => {
    const parsed = parsePrivilege(raw)
    return parsed !== undefined && grantSatisfies(parsed, required)
  })
}

export type GrantedTenantScope = { scope: 'global' } | { scope: 'own'; tenantId: string } | { scope: 'none' }

/**
 * For listing-style checks that need to know *which* tenant(s) a caller may
 * see, not just whether they may see one in particular. Prefers `global`
 * (a tenant-wildcard grant) even when a same-caller own-tenant grant also
 * matches, since global strictly subsumes it.
 */
export function resolveGrantedTenant(
  grants: string[],
  required: { verb: string; resource: string },
): GrantedTenantScope {
  let ownTenantId: string | undefined

  for (const raw of grants) {
    const parsed = parsePrivilege(raw)
    if (parsed === undefined) {
      continue
    }
    if (parsed.verb !== required.verb || !matchesResourceGlob(parsed.resource, required.resource)) {
      continue
    }
    if (parsed.tenantId === undefined) {
      return { scope: 'global' }
    }
    ownTenantId = parsed.tenantId
  }

  return ownTenantId === undefined ? { scope: 'none' } : { scope: 'own', tenantId: ownTenantId }
}
