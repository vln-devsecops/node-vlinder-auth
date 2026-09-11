import { DynamoDBDocumentClient, GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb'
import { mockClient } from 'aws-sdk-client-mock'
import { beforeEach, describe, expect, it } from 'vitest'
import { UnknownClientError } from '../../shared/tenants'
import { verifySession } from '../session'
import { identify, InvalidIdentifierError } from './identify'

const KEY = 'test-signing-key-000000000000000000000000'
const ddbMock = mockClient(DynamoDBDocumentClient)
const config = { authAppTenantId: 'auth', tenantsTableName: 'tenants-table' }

beforeEach(() => {
  ddbMock.reset()
  ddbMock.on(GetCommand).resolves({})
})

describe('identify', () => {
  it('resolves to local password and issues an identify session carrying the identifier and tenant', async () => {
    const result = await identify({
      identifier: 'jane@example.com',
      clientId: undefined,
      signingKey: KEY,
      config,
      ddbDocClient: ddbMock as unknown as DynamoDBDocumentClient,
    })
    expect(result).toEqual({ method: 'password', tenantId: 'auth', identifySession: expect.any(String) })
    const payload = await verifySession(result.identifySession, KEY)
    expect(payload).toMatchObject({ identifier: 'jane@example.com', method: 'password', tenantId: 'auth' })
  })

  it('trims surrounding whitespace from the identifier', async () => {
    const result = await identify({
      identifier: '  jane@example.com  ',
      clientId: undefined,
      signingKey: KEY,
      config,
      ddbDocClient: ddbMock as unknown as DynamoDBDocumentClient,
    })
    expect(await verifySession(result.identifySession, KEY)).toMatchObject({
      identifier: 'jane@example.com',
    })
  })

  it('rejects an empty identifier', async () => {
    await expect(
      identify({
        identifier: '   ',
        clientId: undefined,
        signingKey: KEY,
        config,
        ddbDocClient: ddbMock as unknown as DynamoDBDocumentClient,
      }),
    ).rejects.toThrow(InvalidIdentifierError)
  })

  it('resolves the tenant from client_id when given', async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [{ tenantId: 'acme-corp' }] })

    const result = await identify({
      identifier: 'jane@acme.com',
      clientId: 'client-abc',
      signingKey: KEY,
      config,
      ddbDocClient: ddbMock as unknown as DynamoDBDocumentClient,
    })

    expect(result.tenantId).toBe('acme-corp')
  })

  it('rejects an unrecognized client_id', async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [] })

    await expect(
      identify({
        identifier: 'jane@example.com',
        clientId: 'someone-elses-client',
        signingKey: KEY,
        config,
        ddbDocClient: ddbMock as unknown as DynamoDBDocumentClient,
      }),
    ).rejects.toThrow(UnknownClientError)
  })

  it('resolves to a redirect at /federation when the domain is pinned in the resolved tenant', async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [{ tenantId: 'acme-corp' }] })
    ddbMock.on(GetCommand).resolves({ Item: { identityProviderId: 'okta-acme' } })

    const result = await identify({
      identifier: 'jane@acme.com',
      clientId: 'client-abc',
      signingKey: KEY,
      config,
      ddbDocClient: ddbMock as unknown as DynamoDBDocumentClient,
    })

    expect(result).toEqual({
      method: 'redirect',
      tenantId: 'acme-corp',
      location: '/federation?provider=okta-acme&action=start',
      identifySession: expect.any(String),
    })
    const payload = await verifySession(result.identifySession, KEY)
    expect(payload).toMatchObject({ method: 'redirect', tenantId: 'acme-corp', provider: 'okta-acme' })
  })
})
