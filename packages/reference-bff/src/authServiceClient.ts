// Thin fetch wrapper around auth.<zone>'s `/api/v1/auth` surface (see
// doc/vendor-neutral-auth.md's API contract). Deliberately dumb: it does not
// interpret response bodies beyond parsing JSON, and never swallows a
// non-2xx into a generic error -- callers (routes/*.ts) decide what a given
// status means for their own endpoint.

export interface UpstreamResponse<T = unknown> {
  status: number
  body: T
}

async function parseJsonBody(response: Response): Promise<unknown> {
  const text = await response.text()
  if (!text) {
    return {}
  }
  try {
    return JSON.parse(text)
  } catch {
    return { raw: text }
  }
}

export interface TokenExchangeResponseBody {
  accessToken: string
  idToken: string
  refreshToken: string
  expiresAt: number
}

/** POST /api/v1/auth/token -- exchanges the one-time token + PKCE verifier for real tokens. */
export async function exchangeToken(
  baseUrl: string,
  params: { token: string; code_verifier: string },
): Promise<UpstreamResponse<TokenExchangeResponseBody>> {
  const response = await fetch(`${baseUrl}/api/v1/auth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(params),
  })
  return { status: response.status, body: (await parseJsonBody(response)) as TokenExchangeResponseBody }
}

export interface RefreshResponseBody {
  accessToken: string
  idToken: string
  refreshToken: string
  expiresAt: number
}

/** POST /api/v1/auth/refresh -- forwards the BFF's opaque refresh-token JWE unmodified. */
export async function refresh(
  baseUrl: string,
  params: { refresh_token: string },
): Promise<UpstreamResponse<RefreshResponseBody>> {
  const response = await fetch(`${baseUrl}/api/v1/auth/refresh`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(params),
  })
  return { status: response.status, body: (await parseJsonBody(response)) as RefreshResponseBody }
}

export interface RelayParams {
  method: 'GET' | 'POST'
  /** Authorization header value to attach, e.g. "Bearer <accessToken>". Omitted if undefined. */
  authorization?: string
  /** JSON-serializable request body; only sent for methods that carry one. */
  body?: unknown
}

/** Generic passthrough for /sudo, /whoami, /logout -- relays method, auth header and body verbatim. */
export async function relay(baseUrl: string, path: string, params: RelayParams): Promise<UpstreamResponse> {
  const headers: Record<string, string> = {}
  if (params.authorization) {
    headers.authorization = params.authorization
  }
  const init: RequestInit = { method: params.method, headers }
  if (params.body !== undefined && params.method !== 'GET') {
    headers['content-type'] = 'application/json'
    init.body = JSON.stringify(params.body)
  }
  const response = await fetch(`${baseUrl}${path}`, init)
  return { status: response.status, body: await parseJsonBody(response) }
}
