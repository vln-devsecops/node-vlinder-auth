/**
 * Not built on `globby`/`fast-glob`/`minimatch`: those match glob patterns
 * against the filesystem (or, for `minimatch`, against path-like strings)
 * and are optimized and audited for that job, not for authorization
 * decisions on arbitrary resource identifiers. Concretely: `globby`/
 * `fast-glob` are async and walk a real directory tree -- there is no
 * directory tree here, `resource-glob` segments are DB-modeled resource
 * names, not paths on disk. `minimatch` fits the string-matching shape
 * better, but its brace/extglob/negation surface (`{a,b}`, `!(...)`, `?()`)
 * is far beyond what `doc/plan.md`'s spec calls for -- `*` within a segment,
 * `**` across segments -- and every one of those extra features is
 * additional attack surface to reason about in a security-critical matcher
 * with no corresponding benefit here. Implementing exactly the two
 * operators the spec needs, with an explicit recursive segment walk and
 * memoized backtracking (see `matchesResourceGlob` below), keeps the whole
 * matching surface auditable in one file instead of trusting a
 * general-purpose library's much larger feature set to not have a
 * privilege-escalating edge case in a corner nothing here exercises.
 */

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
  // Built once per call, not per backtrack -- a pattern's segments are fixed
  // for the whole walk, so compiling each segment's regex on every retry
  // through a "**" would be pure waste.
  const segmentRegexes = patternSegments.map((segment) =>
    segment === '**' ? undefined : new RegExp(`^${segmentToRegexSource(segment)}$`),
  )

  // Memoized on (patternIndex, resourceIndex): without this, a pattern with
  // several non-adjacent "**" segments backtracks combinatorially -- each one
  // retries every remaining split point, and splits compound across several
  // "**"s. Memoizing collapses that back to one evaluation per pair, i.e.
  // O(patternSegments x resourceSegments) instead of exponential.
  const memo = new Map<string, boolean>()

  function matchFrom(patternIndex: number, resourceIndex: number): boolean {
    if (patternIndex === patternSegments.length) {
      return resourceIndex === resourceSegments.length
    }

    const key = `${patternIndex},${resourceIndex}`
    const cached = memo.get(key)
    if (cached !== undefined) {
      return cached
    }

    const result = matchSegmentFrom(patternIndex, resourceIndex)
    memo.set(key, result)
    return result
  }

  function matchSegmentFrom(patternIndex: number, resourceIndex: number): boolean {
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

    const regex = segmentRegexes[patternIndex]!
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
   * grant's own tenant segment or the caller's authenticated tenants.
   * Provide it to require both that the grant covers this tenant (exactly,
   * or via a tenant-wildcard) *and* that the caller is currently
   * authenticated against it -- see `authenticatedTenants` on
   * {@link hasPrivilege} and {@link resolveGrantedTenant}.
   */
  tenantId?: string
}

/** A privilege check with no tenant opinion of its own -- see {@link RequiredPrivilege.tenantId}. */
export type TenantAgnosticPrivilege = Omit<RequiredPrivilege, 'tenantId'>

function grantSatisfies(
  grant: ParsedPrivilege,
  required: RequiredPrivilege,
  authenticatedTenants: string[],
): boolean {
  if (grant.verb !== required.verb) {
    return false
  }
  if (required.tenantId !== undefined) {
    // A caller can be authenticated against several tenants at once (see the
    // `tenants` claim). A grant -- wildcard or not -- can never reach a
    // tenant outside that set: a tenant-wildcard privilege means "every
    // tenant I'm authenticated against", not "every tenant that exists",
    // since the identity provider backing a tenant the caller never
    // authenticated to may not even agree the caller is who they say they
    // are. This also nets a stale or mismatched concrete grant (naming a
    // tenant the caller no longer holds a session for).
    if (!authenticatedTenants.includes(required.tenantId)) {
      return false
    }
    if (grant.tenantId !== undefined && grant.tenantId !== required.tenantId) {
      return false
    }
  }
  return matchesResourceGlob(grant.resource, required.resource)
}

/**
 * Whether any grant in the list satisfies the required privilege.
 * `authenticatedTenants` is the caller's own `tenants` claim -- the set of
 * tenants their current session is actually authenticated against; see
 * {@link RequiredPrivilege.tenantId}.
 */
export function hasPrivilege(
  grants: string[],
  required: RequiredPrivilege,
  authenticatedTenants: string[],
): boolean {
  return grants.some((raw) => {
    const parsed = parsePrivilege(raw)
    return parsed !== undefined && grantSatisfies(parsed, required, authenticatedTenants)
  })
}

export type GrantedTenantScope = { scope: 'granted'; tenantIds: string[] } | { scope: 'none' }

/**
 * For listing-style checks that need to know *which* tenant(s) a caller may
 * see, not just whether they may see one in particular. A tenant-wildcard
 * grant resolves to every tenant in `authenticatedTenants` (never more --
 * see {@link RequiredPrivilege.tenantId}); a tenant-scoped grant contributes
 * its own tenant only if it's also in `authenticatedTenants`. A caller can
 * hold several tenant-scoped grants at once (e.g. distinct roles in
 * distinct tenants), so the result collects every matching tenant rather
 * than keeping only the last one seen.
 */
export function resolveGrantedTenant(
  grants: string[],
  required: TenantAgnosticPrivilege,
  authenticatedTenants: string[],
): GrantedTenantScope {
  const tenantIds = new Set<string>()

  for (const raw of grants) {
    const parsed = parsePrivilege(raw)
    if (parsed === undefined) {
      continue
    }
    if (parsed.verb !== required.verb || !matchesResourceGlob(parsed.resource, required.resource)) {
      continue
    }
    if (parsed.tenantId === undefined) {
      for (const tenantId of authenticatedTenants) {
        tenantIds.add(tenantId)
      }
    } else if (authenticatedTenants.includes(parsed.tenantId)) {
      tenantIds.add(parsed.tenantId)
    }
  }

  return tenantIds.size === 0 ? { scope: 'none' } : { scope: 'granted', tenantIds: [...tenantIds] }
}
