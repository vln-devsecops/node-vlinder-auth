import type {
  APIGatewayProxyEventV2WithJWTAuthorizer,
  APIGatewayProxyStructuredResultV2,
} from 'aws-lambda'
import { getCognitoClient } from '../shared/cognito-client'
import { getDdbDocClient } from '../shared/ddb-client'
import { assignRole } from './handlers/assignRole'
import { extractCallerContext, ForbiddenError } from './authz'
import { getUser, NotFoundError } from './handlers/getUser'
import { listRoles } from './handlers/listRoles'
import { listUsers } from './handlers/listUsers'
import { revokeRole } from './handlers/revokeRole'
import { setUserEnabled } from './handlers/setUserEnabled'

function requireEnv(key: string): string {
  const value = process.env[key]
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`)
  }
  return value
}

function jsonResponse(statusCode: number, body?: unknown): APIGatewayProxyStructuredResultV2 {
  return {
    statusCode,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }
}

/**
 * Single Lambda behind the admin API's http_api module call, routing on
 * routeKey. Each route delegates to a handler in ./handlers, which performs
 * its own tenant-scope check independent of the JWT authorizer that already
 * validated the token.
 */
export async function handler(
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
): Promise<APIGatewayProxyStructuredResultV2> {
  const ddbDocClient = getDdbDocClient()
  const cognitoClient = getCognitoClient()
  const roleAssignmentsTableName = requireEnv('ROLE_ASSIGNMENTS_TABLE_NAME')
  const rolesTableName = requireEnv('ROLES_TABLE_NAME')
  const userPoolId = requireEnv('USER_POOL_ID')

  // Our own claims (tenantId, permissions) are always strings; the aws-lambda
  // types model the general JWT-claims case more broadly than that.
  const caller = extractCallerContext(
    event.requestContext.authorizer.jwt.claims as Record<string, string | undefined>,
  )
  const targetUserId = event.pathParameters?.userId
  const targetRoleId = event.pathParameters?.roleId
  const body = event.body ? (JSON.parse(event.body) as Record<string, unknown>) : {}

  try {
    switch (event.routeKey) {
      case 'GET /users': {
        const result = await listUsers({
          caller,
          ddbDocClient,
          cognitoClient,
          roleAssignmentsTableName,
          userPoolId,
        })
        return jsonResponse(200, result)
      }

      case 'GET /users/{userId}': {
        const result = await getUser({
          caller,
          targetUserId: targetUserId!,
          ddbDocClient,
          cognitoClient,
          roleAssignmentsTableName,
          userPoolId,
        })
        return jsonResponse(200, result)
      }

      case 'PATCH /users/{userId}/enabled': {
        await setUserEnabled({
          caller,
          targetUserId: targetUserId!,
          enabled: Boolean(body.enabled),
          ddbDocClient,
          cognitoClient,
          roleAssignmentsTableName,
          userPoolId,
        })
        return jsonResponse(204)
      }

      case 'GET /roles': {
        const result = await listRoles({ caller, ddbDocClient, rolesTableName })
        return jsonResponse(200, result)
      }

      case 'PUT /users/{userId}/roles/{roleId}': {
        await assignRole({
          caller,
          targetUserId: targetUserId!,
          roleId: targetRoleId!,
          ddbDocClient,
          roleAssignmentsTableName,
        })
        return jsonResponse(204)
      }

      case 'DELETE /users/{userId}/roles/{roleId}': {
        await revokeRole({
          caller,
          targetUserId: targetUserId!,
          roleId: targetRoleId!,
          ddbDocClient,
          roleAssignmentsTableName,
        })
        return jsonResponse(204)
      }

      default:
        return jsonResponse(404, { error: `Unrecognized route: ${event.routeKey}` })
    }
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return jsonResponse(403, { error: error.message })
    }
    if (error instanceof NotFoundError) {
      return jsonResponse(404, { error: error.message })
    }
    throw error
  }
}
