// Browser-safe client helper -- the package's "./client" export. Zero
// Node-only imports (no `express`, no `node:*` modules): only the Fetch API
// and standard JS, so a front-end bundler resolving this path directly never
// pulls in server-side code. See doc/vendor-neutral-auth.md's "Consuming
// front-ends must single-flight refreshes" and doc/rationale.md's
// "Refresh tokens rotate" for why the coalescing below is a requirement, not
// an optimization: several parallel 401s each triggering their own refresh
// would race, trip Cognito's reuse detection, and revoke the user's whole
// token family.

export interface RefreshClientOptions {
  /** This BFF's own /refresh endpoint, e.g. "/refresh". */
  refreshUrl: string
  /** Header the CSRF cookie value is echoed back in. Defaults to 'X-Vln-Csrf-Token'. */
  csrfHeaderName?: string
  /** Name of the JS-readable double-submit CSRF cookie. Defaults to 'vln_auth_csrf'. */
  csrfCookieName?: string
}

export interface RefreshResult {
  idToken: string
  accessToken?: string
  expiresAt: number
}

export interface RefreshClient {
  refresh: () => Promise<RefreshResult>
}

/** Reads a single cookie's value out of `document.cookie` with no dependency. */
function readCookie(name: string): string | undefined {
  const cookies = document.cookie ? document.cookie.split('; ') : []
  for (const cookie of cookies) {
    const eq = cookie.indexOf('=')
    if (eq < 0) {
      continue
    }
    if (decodeURIComponent(cookie.slice(0, eq)) === name) {
      return decodeURIComponent(cookie.slice(eq + 1))
    }
  }
  return undefined
}

/**
 * Creates a single-flighting refresh client. Concurrent `refresh()` calls
 * made before the first resolves are coalesced into the one in-flight
 * `fetch` -- every caller receives the same promise/result -- and the
 * in-flight promise is cleared once it settles, so the next call after that
 * starts a fresh request.
 */
export function createRefreshClient(options: RefreshClientOptions): RefreshClient {
  const csrfHeaderName = options.csrfHeaderName ?? 'X-Vln-Csrf-Token'
  const csrfCookieName = options.csrfCookieName ?? 'vln_auth_csrf'

  let inFlight: Promise<RefreshResult> | null = null

  async function doRefresh(): Promise<RefreshResult> {
    const csrfToken = readCookie(csrfCookieName)
    const response = await fetch(options.refreshUrl, {
      method: 'POST',
      credentials: 'include',
      headers: csrfToken ? { [csrfHeaderName]: csrfToken } : {},
    })
    if (!response.ok) {
      throw new Error(`Refresh failed with status ${response.status}`)
    }
    return (await response.json()) as RefreshResult
  }

  function refresh(): Promise<RefreshResult> {
    if (!inFlight) {
      inFlight = doRefresh().finally(() => {
        inFlight = null
      })
    }
    return inFlight
  }

  return { refresh }
}
