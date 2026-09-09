import { ScanCommand, type DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb'
import { callerHasPrivilege, ForbiddenError, type CallerContext } from '../authz'
import { ADMIN_ROLES_READ } from '../privileges'
import type { RoleDefinition } from '../../shared/types'

export interface ListRolesParams {
  caller: CallerContext
  ddbDocClient: DynamoDBDocumentClient
  rolesTableName: string
}

export interface ListRolesResult {
  roles: RoleDefinition[]
}

/**
 * Returns the Terraform-seeded role catalog. Unlike user listings, this is
 * not tenant-scoped -- the catalog itself is reference data, not tenant
 * data -- so it's a plain privilege check rather than assertTenantAccess.
 */
export async function listRoles(params: ListRolesParams): Promise<ListRolesResult> {
  const { caller, ddbDocClient, rolesTableName } = params

  if (!callerHasPrivilege(caller, ADMIN_ROLES_READ)) {
    throw new ForbiddenError(
      `Missing privilege ${ADMIN_ROLES_READ.verb}:${ADMIN_ROLES_READ.resource}`,
    )
  }

  const result = await ddbDocClient.send(new ScanCommand({ TableName: rolesTableName }))

  return { roles: (result.Items ?? []) as RoleDefinition[] }
}
