import type { PostConfirmationTriggerEvent } from 'aws-lambda'
import { getCognitoClient } from '../shared/cognito-client'
import { assignBaselineGroups } from '../shared/cognitoGroups'
import { getDdbDocClient } from '../shared/ddb-client'
import { invokeOptionalHook } from '../shared/hook'
import { createInitialRoleAssignment } from '../shared/roleAssignments'
import { resolveTenantForNewUser } from '../shared/tenants'
import { loadPostConfirmationConfig } from './config'

/**
 * Cognito post-confirmation trigger. Only acts on new-signup confirmations --
 * Cognito also invokes this trigger source for other flows (e.g. forgot-
 * password confirmation), which must pass through untouched.
 */
export async function handler(
  event: PostConfirmationTriggerEvent,
): Promise<PostConfirmationTriggerEvent> {
  if (event.triggerSource !== 'PostConfirmation_ConfirmSignUp') {
    return event
  }

  const config = loadPostConfirmationConfig(process.env)
  const ddbDocClient = getDdbDocClient()
  const cognitoClient = getCognitoClient()

  const email = event.request.userAttributes.email
  const userId = event.request.userAttributes.sub
  const username = event.userName

  const tenantId = await resolveTenantForNewUser({
    email,
    config,
    ddbDocClient,
  })

  await createInitialRoleAssignment({
    userId,
    tenantId,
    roleId: config.defaultRoleId,
    tableName: config.roleAssignmentsTableName,
    ddbDocClient,
  })

  await assignBaselineGroups({
    // Cognito always includes userPoolId on the trigger event itself, so
    // there's no need for a USER_POOL_ID env var here -- deliberately, since
    // that would create a circular Terraform dependency (the pool's
    // lambda_config needs this function's ARN, and this function would need
    // the pool's ID).
    userPoolId: event.userPoolId,
    username,
    groups: config.baselineGroups,
    cognitoClient,
  })

  await invokeOptionalHook(config.hookModulePath, event, {
    tenantId,
    roleId: config.defaultRoleId,
  })

  return event
}
