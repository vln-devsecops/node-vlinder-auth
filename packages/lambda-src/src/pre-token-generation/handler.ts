import type { PreTokenGenerationV2TriggerEvent } from 'aws-lambda'
import { getDdbDocClient } from '../shared/ddb-client'
import { invokeOptionalHook } from '../shared/hook'
import { resolvePrivilegesForUser } from '../shared/privileges'
import { loadPreTokenGenerationConfig } from './config'

/**
 * Cognito pre-token-generation trigger (V2 event shape, which V3_0 also
 * delivers for standard user-authentication trigger sources). Resolves the
 * caller's role assignments -- possibly across more than one tenant, for a
 * user logged in on several at once -- and injects the expanded *privilege*
 * list plus the authenticated tenant list as claims. The role name itself is
 * never added to the token, so downstream services only ever reason about
 * privileges.
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
    const claims = {
      scope: resolved.privileges.join(' '),
      tenants: resolved.tenants.join(' '),
    }

    // Cognito delivers claimsAndScopeOverrideDetails as null in the real V2
    // event -- the trigger is expected to construct the whole object, and
    // reading a property off it before doing so crashes the handler (caught
    // live: "Cannot read properties of null (reading 'idTokenGeneration')").
    const existing = event.response.claimsAndScopeOverrideDetails ?? {}
    event.response.claimsAndScopeOverrideDetails = {
      ...existing,
      idTokenGeneration: {
        ...existing.idTokenGeneration,
        claimsToAddOrOverride: claims,
      },
      accessTokenGeneration: {
        ...existing.accessTokenGeneration,
        claimsToAddOrOverride: claims,
      },
    }
  }

  await invokeOptionalHook(config.hookModulePath, event, {
    tenants: resolved.tenants,
    roleIds: resolved.roleIds,
    privileges: resolved.privileges,
  })

  return event
}
