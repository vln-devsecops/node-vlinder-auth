import { DynamoDBDocumentClient, GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb'
import { mockClient } from 'aws-sdk-client-mock'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  resolveIdentityProviderForDomain,
  resolveTenantForNewUser,
  resolveTenantIdForClient,
  UnknownClientError,
} from './tenants'

const ddbMock = mockClient(DynamoDBDocumentClient)

beforeEach(() => {
  ddbMock.reset()
})

describe('resolveTenantForNewUser', () => {
  it('returns the configured default tenant with no lookup in single-tenant mode', async () => {
    const tenantId = await resolveTenantForNewUser({
      email: 'someone@example.com',
      config: {
        tenancyMode: 'single',
        defaultTenantId: 'default',
        tenantsTableName: 'tenants-table',
      },
      ddbDocClient: ddbMock as unknown as DynamoDBDocumentClient,
    })

    expect(tenantId).toBe('default')
    expect(ddbMock.calls()).toHaveLength(0)
  })

  it('resolves the tenant via the email-domain lookup in multi-tenant mode', async () => {
    ddbMock.on(QueryCommand).resolves({
      Items: [{ tenantId: 'acme-corp', emailDomain: 'acme.com' }],
    })

    const tenantId = await resolveTenantForNewUser({
      email: 'jane@acme.com',
      config: {
        tenancyMode: 'multi',
        defaultTenantId: 'default',
        tenantsTableName: 'tenants-table',
      },
      ddbDocClient: ddbMock as unknown as DynamoDBDocumentClient,
    })

    expect(tenantId).toBe('acme-corp')
    const queryCall = ddbMock.commandCalls(QueryCommand)[0]
    expect(queryCall.args[0].input).toMatchObject({
      TableName: 'tenants-table',
      IndexName: 'emailDomain-index',
      ExpressionAttributeValues: { ':d': 'acme.com' },
    })
  })

  it('falls back to the default tenant in multi-tenant mode when no domain mapping exists', async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [] })

    const tenantId = await resolveTenantForNewUser({
      email: 'jane@unmapped.com',
      config: {
        tenancyMode: 'multi',
        defaultTenantId: 'default',
        tenantsTableName: 'tenants-table',
      },
      ddbDocClient: ddbMock as unknown as DynamoDBDocumentClient,
    })

    expect(tenantId).toBe('default')
  })
})

describe('resolveTenantIdForClient', () => {
  it('resolves the auth application\'s own tenant when no client_id is given', async () => {
    const tenantId = await resolveTenantIdForClient({
      clientId: undefined,
      config: { authAppTenantId: 'auth', tenantsTableName: 'tenants-table' },
      ddbDocClient: ddbMock as unknown as DynamoDBDocumentClient,
    })

    expect(tenantId).toBe('auth')
    expect(ddbMock.calls()).toHaveLength(0)
  })

  it('resolves the registered tenant for a known client_id via the clientId-index', async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [{ tenantId: 'acme-corp', clientId: 'client-abc' }] })

    const tenantId = await resolveTenantIdForClient({
      clientId: 'client-abc',
      config: { authAppTenantId: 'auth', tenantsTableName: 'tenants-table' },
      ddbDocClient: ddbMock as unknown as DynamoDBDocumentClient,
    })

    expect(tenantId).toBe('acme-corp')
    const queryCall = ddbMock.commandCalls(QueryCommand)[0]
    expect(queryCall.args[0].input).toMatchObject({
      TableName: 'tenants-table',
      IndexName: 'clientId-index',
      ExpressionAttributeValues: { ':c': 'client-abc' },
    })
  })

  it('throws UnknownClientError for a client_id with no registered tenant, rather than guessing one', async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [] })

    await expect(
      resolveTenantIdForClient({
        clientId: 'someone-elses-client',
        config: { authAppTenantId: 'auth', tenantsTableName: 'tenants-table' },
        ddbDocClient: ddbMock as unknown as DynamoDBDocumentClient,
      }),
    ).rejects.toThrow(UnknownClientError)
  })
})

describe('resolveIdentityProviderForDomain', () => {
  it('returns the pinned identity provider for a domain registered to this tenant', async () => {
    ddbMock.on(GetCommand).resolves({
      Item: { tenantId: 'acme-corp', sk: 'DOMAIN#acme.com', domain: 'acme.com', identityProviderId: 'okta-acme' },
    })

    const providerId = await resolveIdentityProviderForDomain({
      tenantId: 'acme-corp',
      email: 'jane@acme.com',
      tenantsTableName: 'tenants-table',
      ddbDocClient: ddbMock as unknown as DynamoDBDocumentClient,
    })

    expect(providerId).toBe('okta-acme')
    const getCall = ddbMock.commandCalls(GetCommand)[0]
    expect(getCall.args[0].input).toMatchObject({
      TableName: 'tenants-table',
      Key: { tenantId: 'acme-corp', sk: 'DOMAIN#acme.com' },
    })
  })

  it('is case-insensitive on the domain', async () => {
    ddbMock.on(GetCommand).resolves({
      Item: { tenantId: 'acme-corp', sk: 'DOMAIN#acme.com', domain: 'acme.com', identityProviderId: 'okta-acme' },
    })

    await resolveIdentityProviderForDomain({
      tenantId: 'acme-corp',
      email: 'Jane@ACME.com',
      tenantsTableName: 'tenants-table',
      ddbDocClient: ddbMock as unknown as DynamoDBDocumentClient,
    })

    const getCall = ddbMock.commandCalls(GetCommand)[0]
    expect(getCall.args[0].input).toMatchObject({ Key: { tenantId: 'acme-corp', sk: 'DOMAIN#acme.com' } })
  })

  it('returns undefined when the domain has no pinning in this tenant -- the tenant defaults apply', async () => {
    ddbMock.on(GetCommand).resolves({})

    const providerId = await resolveIdentityProviderForDomain({
      tenantId: 'acme-corp',
      email: 'jane@unpinned.com',
      tenantsTableName: 'tenants-table',
      ddbDocClient: ddbMock as unknown as DynamoDBDocumentClient,
    })

    expect(providerId).toBeUndefined()
  })

  it('returns undefined when the identifier carries no email domain', async () => {
    const providerId = await resolveIdentityProviderForDomain({
      tenantId: 'acme-corp',
      email: 'not-an-email',
      tenantsTableName: 'tenants-table',
      ddbDocClient: ddbMock as unknown as DynamoDBDocumentClient,
    })

    expect(providerId).toBeUndefined()
    expect(ddbMock.calls()).toHaveLength(0)
  })
})
