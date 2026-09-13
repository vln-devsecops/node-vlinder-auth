import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb'
import {
  assertRegisteredRedirectUri,
  resolveIdentityProviderForDomain,
  resolveTenantIdForClient,
  type ResolveTenantIdForClientConfig,
} from '../../shared/tenants'
import { signSession } from '../session'

// Step 1 of the identifier-first flow: the user submits an identifier
// (username or email) and the backend decides how they authenticate.
//
// Which tenant the request belongs to (from `client_id`) and, within that
// tenant, whether the identifier's email domain is pinned to an external IdP
// are both resolved here. Actually driving a federated sign-in (the redirect
// and callback handshake) is later work -- see doc/plan.md step 11 -- this
// only determines which method applies. The result carries a signed
// "identify session" that threads the identifier, tenant and (if federated)
// provider to the subsequent step, so the client never re-sends them.

export const IDENTIFY_SESSION_TTL_SECONDS = 300

export interface IdentifyParams {
  identifier: string
  /** The calling application's OAuth client_id, absent for auth.<zone>'s own surfaces (e.g. the admin panel). */
  clientId: string | undefined
  signingKey: string
  config: ResolveTenantIdForClientConfig
  ddbDocClient: DynamoDBDocumentClient
  now?: number
  /**
   * Present only when this /identify call originated from the RP handoff's
   * /authorize redirect (see doc/vendor-neutral-auth.md's "Login" sequence
   * diagram): the SPA reads these off its own URL (as forwarded by
   * handlers/authorize.ts) and threads them through here so the eventual
   * /password step can complete the handoff without the client re-sending
   * them. All three normally arrive together, but each is embedded
   * independently if present -- this doesn't assume the caller always groups
   * them correctly.
   */
  redirectUri?: string
  codeChallenge?: string
  state?: string
}

export type IdentifyResult =
  | { method: 'password'; tenantId: string; identifySession: string }
  | { method: 'redirect'; tenantId: string; location: string; identifySession: string }

export async function identify({
  identifier,
  clientId,
  signingKey,
  config,
  ddbDocClient,
  now,
  redirectUri,
  codeChallenge,
  state,
}: IdentifyParams): Promise<IdentifyResult> {
  const trimmed = identifier.trim()
  if (!trimmed) {
    throw new InvalidIdentifierError('An identifier is required.')
  }

  const tenantId = await resolveTenantIdForClient({ clientId, config, ddbDocClient })
  const provider = await resolveIdentityProviderForDomain({
    tenantId,
    email: trimmed,
    tenantsTableName: config.tenantsTableName,
    ddbDocClient,
  })

  // /authorize (handlers/authorize.ts) already validates redirect_uri
  // against the calling client's registered allowlist -- but that check
  // must not be the *only* place it happens: a caller can reach /identify
  // directly, skipping /authorize entirely, and inject an arbitrary
  // redirect_uri that /password would later 302 to unchecked. Re-derive and
  // re-check here independently (same defense-in-depth posture as
  // admin-api/authz.ts's per-handler tenant checks) rather than trust that
  // whatever called this already went through /authorize.
  if (redirectUri !== undefined) {
    // Without a client_id, there is no registered allowlist to check
    // against at all -- and no RP handoff can have started without one,
    // since /authorize always requires it. Without a code_challenge, a
    // /password step later couldn't complete PKCE either. Either gap means
    // this isn't a genuine RP-handoff request; refuse to carry the
    // redirect_uri forward rather than guess what the caller meant. Its own
    // error class, distinct from UnregisteredRedirectUriError: that one
    // means "this redirect_uri was checked against the allowlist and
    // rejected" (the open-redirect signal worth alerting on), which is a
    // different failure than "the request didn't even have enough context
    // to check" -- collapsing the two would make it impossible to tell an
    // open-redirect probe from an ordinary client integration bug.
    if (!clientId || !codeChallenge) {
      throw new IncompleteRpHandoffContextError(
        'redirect_uri requires both a client_id and a code_challenge.',
      )
    }
    await assertRegisteredRedirectUri(clientId, redirectUri, config, ddbDocClient)
  }

  // Only defined when actually provided, so an ordinary direct-login call
  // (none of these three present) produces exactly the same session payload
  // as before this field existed.
  const rpHandoffClaims = {
    ...(redirectUri !== undefined ? { redirectUri } : {}),
    ...(codeChallenge !== undefined ? { codeChallenge } : {}),
    ...(state !== undefined ? { state } : {}),
  }

  if (provider) {
    // Same-origin: the SPA never speaks to the IdP directly. The actual
    // /federation endpoint (GET, ?provider=&action=start|callback) is step
    // 11's job -- this only determines that a redirect is due and where to.
    const location = `/federation?provider=${encodeURIComponent(provider)}&action=start`
    const identifySession = await signSession(
      { identifier: trimmed, method: 'redirect', tenantId, provider, ...rpHandoffClaims },
      signingKey,
      IDENTIFY_SESSION_TTL_SECONDS,
      now,
    )
    return { method: 'redirect', tenantId, location, identifySession }
  }

  const identifySession = await signSession(
    { identifier: trimmed, method: 'password', tenantId, ...rpHandoffClaims },
    signingKey,
    IDENTIFY_SESSION_TTL_SECONDS,
    now,
  )
  return { method: 'password', tenantId, identifySession }
}

export class InvalidIdentifierError extends Error {}
export class IncompleteRpHandoffContextError extends Error {}
