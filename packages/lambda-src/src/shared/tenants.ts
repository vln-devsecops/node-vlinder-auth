import { GetCommand, QueryCommand, type DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb'
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

export class UnknownClientError extends Error {}

export interface ResolveTenantIdForClientConfig {
  /**
   * The auth application's own tenant -- resolved when a request carries no
   * `client_id` at all (e.g. the admin panel, or any other surface reached
   * directly at `auth.<zone>`), never as a fallback for an unrecognized one.
   */
  authAppTenantId: string
  tenantsTableName: string
}

export interface ResolveTenantIdForClientParams {
  clientId: string | undefined
  config: ResolveTenantIdForClientConfig
  ddbDocClient: DynamoDBDocumentClient
}

/**
 * Resolves the tenant a request belongs to from the calling application's
 * `client_id` -- the first of the two lookups tenancy relies on (the second,
 * {@link resolveIdentityProviderForDomain}, happens within the tenant this
 * resolves). An absent `client_id` resolves to the auth application's own
 * tenant; a `client_id` that doesn't match any registered client throws
 * rather than silently falling back to some tenant it was never granted --
 * an unrecognized client is a request to reject, not a guess to make.
 */
export async function resolveTenantIdForClient(
  params: ResolveTenantIdForClientParams,
): Promise<string> {
  const { clientId, config, ddbDocClient } = params

  if (!clientId) {
    return config.authAppTenantId
  }

  const result = await ddbDocClient.send(
    new QueryCommand({
      TableName: config.tenantsTableName,
      IndexName: 'clientId-index',
      KeyConditionExpression: 'clientId = :c',
      ExpressionAttributeValues: { ':c': clientId },
      Limit: 1,
    }),
  )

  const tenantId = result.Items?.[0]?.tenantId as string | undefined
  if (!tenantId) {
    throw new UnknownClientError(`No tenant is registered for client_id ${clientId}`)
  }
  return tenantId
}

export interface ResolveIdentityProviderForDomainParams {
  /** The tenant already resolved via {@link resolveTenantIdForClient} -- the lookup below is scoped to it. */
  tenantId: string
  email: string
  tenantsTableName: string
  ddbDocClient: DynamoDBDocumentClient
}

/**
 * Resolves the identity provider, if any, a tenant's domain owner has pinned
 * the given email's domain to -- the second of the two tenancy lookups (see
 * {@link resolveTenantIdForClient}). `undefined` means no provider is pinned
 * for this domain *in this tenant*, either because none was ever registered
 * or because the domain is registered to a different tenant: either way, the
 * caller falls back to the tenant's defaults (local signup, any offered
 * social providers), never to a provider pinned somewhere else.
 */
export async function resolveIdentityProviderForDomain(
  params: ResolveIdentityProviderForDomainParams,
): Promise<string | undefined> {
  const { tenantId, email, tenantsTableName, ddbDocClient } = params

  const domain = email.split('@')[1]?.toLowerCase()
  if (!domain) {
    return undefined
  }

  const result = await ddbDocClient.send(
    new GetCommand({
      TableName: tenantsTableName,
      Key: { tenantId, sk: `DOMAIN#${domain}` },
    }),
  )

  return result.Item?.identityProviderId as string | undefined
}
