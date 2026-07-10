import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb'
import { mockClient } from 'aws-sdk-client-mock'
import { beforeEach, describe, expect, it } from 'vitest'
import { resolveTenantForNewUser } from './tenants'

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
