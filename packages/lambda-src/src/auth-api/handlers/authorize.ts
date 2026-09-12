import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb'
import {
  assertRegisteredRedirectUri,
  resolveTenantIdForClient,
  type ResolveTenantIdForClientConfig,
} from '../../shared/tenants'

// The RP handoff's entry point (see doc/vendor-neutral-auth.md's "Login"
// sequence diagram): an RP's back-end 302s its front-end here with the
// standard OAuth authorize-endpoint parameters. This validates the request
// and, on success, forwards the browser to the SPA's own root so it can drive
// /identify and /password with the RP's parameters in hand.
//
// Deliberate simplification: unlike a full OAuth AS, this never redirects
// back to redirect_uri with `?error=...` on a validation failure -- every
// failure here returns a direct JSON error response instead. Building
// error-redirect support correctly (which failures are safe to redirect,
// with what information) is meaningful extra complexity and open-redirect
// risk for no consumer of this API that currently needs it; if a future step
// needs it, add it deliberately rather than as an afterthought here.
//
// `scope` is accepted in the query string (the doc's diagram lists it) but
// never validated, stored, or forwarded: privileges come from this system's
// own role assignments, never from an RP-requested scope.

export interface AuthorizeParams {
  clientId: string
  redirectUri: string
  responseType: string
  codeChallenge: string
  codeChallengeMethod: string
  state: string
  config: ResolveTenantIdForClientConfig
  ddbDocClient: DynamoDBDocumentClient
}

export interface AuthorizeResult {
  location: string
}

export async function authorize(params: AuthorizeParams): Promise<AuthorizeResult> {
  const { clientId, redirectUri, responseType, codeChallenge, codeChallengeMethod, state, config, ddbDocClient } =
    params

  // 0. client_id, redirect_uri and code_challenge are all required -- fail
  // fast on a malformed request before any DB round-trip. Without this, an
  // empty code_challenge would sail through every other check here and only
  // surface later as a confusing silent fallback at /password (which treats
  // a missing codeChallenge as "not an RP handoff at all"). state is
  // genuinely optional (RFC 6749's own posture: RECOMMENDED, not REQUIRED).
  if (!clientId || !redirectUri || !codeChallenge) {
    throw new InvalidAuthorizeRequestError(
      'client_id, redirect_uri and code_challenge are all required',
    )
  }

  // 1 & 2. client_id -> tenant (throws UnknownClientError for an
  // unregistered client), and redirect_uri must be an exact-string match in
  // that client's registered allowlist -- no prefix/wildcard matching, no
  // query-string-insensitive comparison. This is the open-redirect guard.
  // Independent of each other (neither uses the other's result), so run
  // concurrently rather than paying two sequential DynamoDB round trips.
  await Promise.all([
    resolveTenantIdForClient({ clientId, config, ddbDocClient }),
    assertRegisteredRedirectUri(clientId, redirectUri, config, ddbDocClient),
  ])

  // 3. Only the authorization_code flow is supported.
  if (responseType !== 'code') {
    throw new UnsupportedResponseTypeError(`Unsupported response_type: ${responseType}`)
  }

  // 4. Only PKCE's S256 method is supported -- plain (unhashed) PKCE is
  // deliberately not offered (see pkce.ts).
  if (codeChallengeMethod !== 'S256') {
    throw new UnsupportedCodeChallengeMethodError(
      `Unsupported code_challenge_method: ${codeChallengeMethod}`,
    )
  }

  // Every check passed -- forward to the SPA's own root (same-origin), which
  // reads these off its URL and carries them into /identify and /password.
  const query = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    code_challenge: codeChallenge,
    state,
  })
  return { location: `/?${query.toString()}` }
}

export class InvalidAuthorizeRequestError extends Error {}
export class UnsupportedResponseTypeError extends Error {}
export class UnsupportedCodeChallengeMethodError extends Error {}
export { UnregisteredRedirectUriError } from '../../shared/tenants'
