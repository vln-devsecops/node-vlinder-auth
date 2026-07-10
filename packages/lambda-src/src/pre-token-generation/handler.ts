import type { PreTokenGenerationV2TriggerEvent } from 'aws-lambda'
import { getDdbDocClient } from '../shared/ddb-client'
import { invokeOptionalHook } from '../shared/hook'
import { resolvePrivilegesForUser } from '../shared/privileges'
import { loadPreTokenGenerationConfig } from './config'

/**
 * Cognito pre-token-generation trigger (V2 event shape, which V3_0 also
 * delivers for standard user-authentication trigger sources). Resolves the
 * caller's role assignment and injects the expanded *privilege* list plus
 * tenantId as claims -- the role name itself is never added to the token, so
 * downstream services only ever reason about privileges.
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

  if (resolved.tenantId !== undefined) {
    const claims = {
      permissions: resolved.privileges.join(','),
      tenantId: resolved.tenantId,
    }

    event.response.claimsAndScopeOverrideDetails.idTokenGeneration = {
      ...event.response.claimsAndScopeOverrideDetails.idTokenGeneration,
      claimsToAddOrOverride: claims,
    }
    event.response.claimsAndScopeOverrideDetails.accessTokenGeneration = {
      ...event.response.claimsAndScopeOverrideDetails.accessTokenGeneration,
      claimsToAddOrOverride: claims,
    }
  }

  await invokeOptionalHook(config.hookModulePath, event, {
    tenantId: resolved.tenantId,
    roleId: resolved.roleId,
    privileges: resolved.privileges,
  })

  return event
}
