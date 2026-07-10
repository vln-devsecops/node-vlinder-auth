import { ScanCommand, type DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb'
import { ForbiddenError, type CallerContext } from '../authz'
import type { RoleDefinition } from '../../shared/types'

const REQUIRED_PRIVILEGE = 'admin:roles:read'

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

  if (!caller.privileges.includes(REQUIRED_PRIVILEGE)) {
    throw new ForbiddenError(`Missing privilege ${REQUIRED_PRIVILEGE}`)
  }

  const result = await ddbDocClient.send(new ScanCommand({ TableName: rolesTableName }))

  return { roles: (result.Items ?? []) as RoleDefinition[] }
}
