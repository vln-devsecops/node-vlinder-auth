import { QueryCommand, type DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb'
import type { TenancyMode } from './types'

export interface ResolveTenantConfig {
  tenancyMode: TenancyMode
  defaultTenantId: string
  tenantsTableName: string
}

export interface ResolveTenantForNewUserParams {
  email: string
  config: ResolveTenantConfig
  ddbDocClient: DynamoDBDocumentClient
}

/**
 * Resolves which tenant a newly-confirmed user belongs to. In single-tenant
 * mode this is always the configured default tenant, with no DynamoDB call.
 * In multi-tenant mode, the tenant is looked up by the user's email domain;
 * an unmapped domain falls back to the default tenant rather than failing
 * signup outright.
 */
export async function resolveTenantForNewUser(
  params: ResolveTenantForNewUserParams,
): Promise<string> {
  const { email, config, ddbDocClient } = params

  if (config.tenancyMode === 'single') {
    return config.defaultTenantId
  }

  const domain = email.split('@')[1]?.toLowerCase()
  if (!domain) {
    return config.defaultTenantId
  }

  const result = await ddbDocClient.send(
    new QueryCommand({
      TableName: config.tenantsTableName,
      IndexName: 'emailDomain-index',
      KeyConditionExpression: 'emailDomain = :d',
      ExpressionAttributeValues: { ':d': domain },
      Limit: 1,
    }),
  )

  const tenantId = result.Items?.[0]?.tenantId as string | undefined
  return tenantId ?? config.defaultTenantId
}
