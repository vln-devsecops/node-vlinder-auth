import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb'
import {
  resolveClientRedirectUris,
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

  // 1. client_id -> tenant. Throws UnknownClientError for an unregistered client.
  await resolveTenantIdForClient({ clientId, config, ddbDocClient })

  // 2. redirect_uri must be an exact-string match in that client's registered
  // allowlist -- no prefix/wildcard matching, no query-string-insensitive
  // comparison. This is the open-redirect guard.
  const redirectUris = await resolveClientRedirectUris(clientId, config, ddbDocClient)
  if (!redirectUris.includes(redirectUri)) {
    throw new UnregisteredRedirectUriError(
      `redirect_uri is not registered for client_id ${clientId}`,
    )
  }

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

export class UnregisteredRedirectUriError extends Error {}
export class UnsupportedResponseTypeError extends Error {}
export class UnsupportedCodeChallengeMethodError extends Error {}
