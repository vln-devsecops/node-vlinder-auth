import { QueryCommand, type DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb'
import type { RoleActivation } from '../shared/types'

export class NotFoundError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'NotFoundError'
  }
}

export interface TargetAssignmentRow {
  userId: string
  tenantId: string
  roleId: string
  activation?: RoleActivation
}

/**
 * Looks up a target user's role-assignment rows and the single tenant they
 * all belong to. Every admin-api action that operates on one target user
 * assumes this -- and this function enforces it -- because none of them
 * take a tenant parameter to disambiguate: the caller says "this user", not
 * "this user in this tenant". The data model formally allows a user to hold
 * assignments in more than one tenant (the same multi-tenant-login support
 * `resolvePrivilegesForUser` has for the *caller* side), even though no
 * admin-api action creates that for a target user today. Rather than
 * silently picking one tenant and acting on it -- or, worse, silently
 * dropping the other tenants' role data -- this throws loudly so the
 * ambiguity surfaces instead of producing a plausible-looking wrong answer.
 *
 * Nothing in the table's key schema (partition key `userId`, sort key
 * `<tenantId>#<roleId>`) or its `tenantId-index` GSI stops a user from
 * holding rows in more than one tenant -- the schema is intentionally the
 * same one the *caller* side's multi-tenant login relies on. No DynamoDB
 * uniqueness constraint or write path enforces "one tenant per target user";
 * it's an application-level convention today, upheld only because
 * `assignRole` always re-derives the tenant via this same function before
 * writing. This function is the actual enforcement point -- it re-checks the
 * assumption against every row on every read rather than trusting the
 * convention held.
 */
export async function loadTargetUsersSoleTenant(
  ddbDocClient: DynamoDBDocumentClient,
  tableName: string,
  targetUserId: string,
): Promise<{ tenantId: string; rows: TargetAssignmentRow[] }> {
  const result = await ddbDocClient.send(
    new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: 'userId = :u',
      ExpressionAttributeValues: { ':u': targetUserId },
    }),
  )

  const rows = (result.Items ?? []) as TargetAssignmentRow[]
  if (rows.length === 0) {
    throw new NotFoundError(`No user found with id ${targetUserId}`)
  }

  const tenantIds = new Set(rows.map((row) => row.tenantId))
  if (tenantIds.size > 1) {
    throw new Error(
      `User ${targetUserId} holds role assignments in more than one tenant ` +
        `(${[...tenantIds].join(', ')}); single-target admin actions don't support this yet`,
    )
  }

  return { tenantId: rows[0].tenantId, rows }
}
