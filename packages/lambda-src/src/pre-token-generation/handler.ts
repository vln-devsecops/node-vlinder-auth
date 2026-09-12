import type { PreTokenGenerationV2TriggerEvent } from 'aws-lambda'
import { getDdbDocClient } from '../shared/ddb-client'
import { invokeOptionalHook } from '../shared/hook'
import { resolvePrivilegesForUser } from '../shared/privileges'
import { loadPreTokenGenerationConfig } from './config'

/**
 * Cognito pre-token-generation trigger (V2 event shape, which V3_0 also
 * delivers for standard user-authentication trigger sources). Resolves the
 * caller's role assignments -- possibly across more than one tenant, for a
 * user logged in on several at once -- and injects claims on *both* tokens.
 * The `tenants` claim (which tenants the session is authenticated against) is
 * identical on both -- it doesn't depend on activation state. The `scope`
 * claim (privileges) deliberately diverges: the ID token gets the
 * held-plus-active set (every role the user holds, so it accurately
 * describes the account) and the access token gets the active-only set
 * (only what the token, as a bearer credential, is allowed to grant right
 * now) -- see `resolvePrivilegesForUser`'s doc comment for why. The role
 * name itself is never added to either token, so downstream services only
 * ever reason about privileges.
 */
export async function handler(
  event: PreTokenGenerationV2TriggerEvent,
): Promise<PreTokenGenerationV2TriggerEvent> {
  const config = loadPreTokenGenerationConfig(process.env)
  const ddbDocClient = getDdbDocClient()

  const userId = event.request.userAttributes.sub

  const resolved = await resolvePrivilegesForUser({
    userId,
    roleAssignmentsTableName: config.roleAssignmentsTableName,
    rolesTableName: config.rolesTableName,
    ddbDocClient,
  })

  if (resolved.tenants.length > 0) {
    const tenants = resolved.tenants.join(' ')

    // Cognito delivers claimsAndScopeOverrideDetails as null in the real V2
    // event -- the trigger is expected to construct the whole object, and
    // reading a property off it before doing so crashes the handler (caught
    // live: "Cannot read properties of null (reading 'idTokenGeneration')").
    const existing = event.response.claimsAndScopeOverrideDetails ?? {}
    event.response.claimsAndScopeOverrideDetails = {
      ...existing,
      idTokenGeneration: {
        ...existing.idTokenGeneration,
        claimsToAddOrOverride: {
          scope: resolved.idTokenPrivileges.join(' '),
          tenants,
        },
      },
      accessTokenGeneration: {
        ...existing.accessTokenGeneration,
        claimsToAddOrOverride: {
          scope: resolved.accessTokenPrivileges.join(' '),
          tenants,
        },
      },
    }
  }

  // The optional hook is app-specific and vendored outside this package's
  // control; its existing fixture/consumers expect a single `privileges`
  // list, from before the split. Pass the access-token (active-only) set
  // under that name -- it's the narrower, more conservative of the two, and
  // matches what a hook reacting to "what can this session actually do
  // right now" (e.g. provisioning side effects gated on an active grant)
  // should see. A hook that specifically needs the held-plus-active set can
  // be extended to read `idTokenPrivileges` once such a need exists.
  await invokeOptionalHook(config.hookModulePath, event, {
    tenants: resolved.tenants,
    roleIds: resolved.roleIds,
    privileges: resolved.accessTokenPrivileges,
  })

  return event
}
